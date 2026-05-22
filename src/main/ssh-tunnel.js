import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { app } from 'electron';

/** @type {typeof import('ssh2').Client | null} */
let ClientClass = null;

/**
 * 打包后 ssh2 若在 app.asar 内，createRequire(应用 package.json) 在部分环境下无法解析到该依赖；
 * 原生模块还会被解压到 app.asar.unpacked，需在磁盘路径上定位包目录再 require。
 */
function resolveSsh2RootDir() {
  /** @type {string[]} */
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ssh2'),
    );
  }
  candidates.push(path.join(app.getAppPath(), 'node_modules', 'ssh2'));
  if (!app.isPackaged) {
    candidates.push(path.join(process.cwd(), 'node_modules', 'ssh2'));
  }
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    } catch {
      /* app.asar 路径上 existsSync 也可能抛错，继续尝试 */
    }
  }
  throw new Error(
    `找不到 ssh2 模块。请确认已安装依赖并重新打包。已检查路径：\n${candidates.join('\n')}`,
  );
}

function getClientConstructor() {
  if (!ClientClass) {
    const root = resolveSsh2RootDir();
    const pkgJsonPath = path.join(root, 'package.json');
    const req = createRequire(pkgJsonPath);
    const mod = req('./lib/index.js');
    ClientClass = mod.Client;
  }
  return ClientClass;
}

/**
 * OpenSSH ssh-agent：与本机 `ssh`/Pageant 已加载的密钥一致（ssh2 在 Win32 上需使用 //./pipe/... 才会走 OpenSSHAgent）。
 * @returns {string | null}
 */
function resolveSshAgentPath() {
  const sock = process.env.SSH_AUTH_SOCK;
  if (typeof sock === 'string' && sock.trim() !== '') {
    return sock.trim();
  }
  if (process.platform === 'win32') {
    return '//./pipe/openssh-ssh-agent';
  }
  return null;
}

/**
 * @param {object} cfg
 * @param {string} cfg.host
 * @param {number} [cfg.port]
 * @param {string} cfg.username
 * @param {string} [cfg.password]
 * @param {string|Buffer} [cfg.privateKey]
 * @param {string} [cfg.passphrase]
 * @param {string} [cfg.remoteBindHost]
 * @param {number} cfg.remotePort
 * @param {string} [cfg.localHost]
 * @param {number} cfg.localPort
 * @param {(msg: string) => void} [cfg.onLog]
 */
export function openReverseTunnel(cfg) {
  const {
    host,
    port = 22,
    username,
    password,
    privateKey,
    passphrase,
    remoteBindHost = '127.0.0.1',
    remotePort,
    localHost = '127.0.0.1',
    localPort,
    onLog = () => {},
  } = cfg;

  const Client = getClientConstructor();
  const client = new Client();

  return new Promise((resolve, reject) => {
    let finished = false;

    const fail = (err) => {
      if (finished) {
        onLog(`错误(已连接后): ${err.message}`);
        return;
      }
      finished = true;
      onLog(`错误: ${err.message}`);
      try {
        client.end();
      } catch {
        /* */
      }
      reject(err);
    };

    client.on('ready', () => {
      onLog('SSH 会话已建立');
      client.forwardIn(remoteBindHost, remotePort, (err) => {
        if (err) {
          const msg = err.message || String(err);
          if (/in use|already|bind|address/i.test(msg)) {
            return fail(
              new Error(
                `${msg}。远端 ${remoteBindHost}:${remotePort} 可能仍被旧 SSH 会话占用：请先在托盘右键「退出」结束本应用旧进程，或在云主机上结束残留 ssh 会话后再连。`,
              ),
            );
          }
          return fail(err);
        }
        onLog(`反向隧道就绪: 远端 ${remoteBindHost}:${remotePort} → 本机 ${localHost}:${localPort}`);
        finished = true;
        resolve({
          client,
          remoteBindHost,
          remotePort,
          close: () => closeTunnel(client, remoteBindHost, remotePort, onLog),
        });
      });
    });

    client.on('tcp connection', (info, accept /* , reject */) => {
      onLog(`远端 TCP 连接 ${info.srcIP}:${info.srcPort} → ${info.destIP}:${info.destPort}`);
      const stream = accept();
      const sock = net.connect({ host: localHost, port: localPort }, () => {
        stream.pipe(sock);
        sock.pipe(stream);
      });
      sock.on('error', (e) => {
        onLog(`本机转发 socket 错误: ${e.message}`);
        stream.destroy();
      });
      stream.on('error', (e) => {
        onLog(`SSH stream 错误: ${e.message}`);
        sock.destroy();
      });
    });

    client.on('error', (err) => {
      // ssh2 在 Agent 不可用或某把 agent 密钥签名失败时仍会尝试其它认证方式，
      // 但会先 emit('error')（err.level === 'agent'）。此处若直接 fail/end 会提前断开。
      const lvl = /** @type {{ level?: string }} */ (err).level;
      if (lvl === 'agent') {
        onLog(`Agent: ${err.message}（继续尝试其它认证方式）`);
        return;
      }
      fail(err);
    });

    /** normalize PEM / OpenSSH key: CRLF、首尾空白 */
    let keyMaterial = privateKey;
    if (privateKey != null) {
      keyMaterial =
        typeof privateKey === 'string'
          ? Buffer.from(privateKey.replace(/\r\n/g, '\n').trim(), 'utf8')
          : Buffer.isBuffer(privateKey)
            ? privateKey
            : Buffer.from(String(privateKey), 'utf8');
    }

    /** @type {import('ssh2').ConnectConfig} */
    const connectOpts = {
      host: typeof host === 'string' ? host.trim() : host,
      port,
      username: typeof username === 'string' ? username.trim() : username,
      readyTimeout: 30000,
      // WiFi 中断时尽快触发 close，避免 UI 长期显示「已连接」
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      // 便于对照 ssh -vvv；不含密钥内容
      debug: (msg) => onLog(String(msg).slice(0, 500)),
    };
    if (password) connectOpts.password = password;
    if (keyMaterial) connectOpts.privateKey = keyMaterial;
    if (passphrase) connectOpts.passphrase = passphrase;

    const agentPath = resolveSshAgentPath();
    if (agentPath) {
      connectOpts.agent = agentPath;
      onLog(
        `认证: 已启用 OpenSSH Agent（${agentPath}）。顺序：磁盘私钥 → Agent 内密钥${password ? ' → 密码' : ''}`,
      );
    }

    const kb = password ? ['password', 'keyboard-interactive'] : [];
    // 默认顺序是 none → password → publickey；错误密码会先占 Max AUTH 导致后续公钥没机会
    if (keyMaterial) {
      connectOpts.authHandler = password
        ? ['publickey', 'agent', ...kb]
        : ['publickey', 'agent'];
    } else if (password) {
      connectOpts.authHandler = ['agent', ...kb];
    }

    // 部分服务端用 keyboard-interactive 校验密码（PAM），与 ssh 行为对齐时需自动应答
    if (password) {
      connectOpts.tryKeyboard = true;
      client.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
        try {
          finish(prompts.map(() => password));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          onLog(`keyboard-interactive: ${msg}`);
        }
      });
    }

    client.connect(connectOpts);
  });
}

/** 网络中断时 unforwardIn 可能永不回调，需超时强制 destroy */
const DISCONNECT_TIMEOUT_MS = 8000;

/**
 * @param {import('ssh2').Client} client
 * @param {string} remoteBindHost
 * @param {number} remotePort
 * @param {(msg: string) => void} onLog
 */
function closeTunnel(client, remoteBindHost, remotePort, onLog) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timer = setTimeout(() => {
      onLog('断开 SSH 超时（可能网络已中断），强制关闭连接');
      try {
        client.destroy();
      } catch {
        /* */
      }
      done();
    }, DISCONNECT_TIMEOUT_MS);

    try {
      client.unforwardIn(remoteBindHost, remotePort, (err) => {
        clearTimeout(timer);
        if (err) onLog(`unforwardIn: ${err.message}`);
        try {
          client.end();
        } catch {
          try {
            client.destroy();
          } catch {
            /* */
          }
        }
        onLog('SSH 已断开');
        done();
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`断开失败: ${msg}`);
      try {
        client.destroy();
      } catch {
        /* */
      }
      done();
    }
  });
}
