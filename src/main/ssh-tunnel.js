import net from 'node:net';
import { createSshClient } from './ssh-connect.js';

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

  const { client, connectOpts } = createSshClient({
    host,
    port,
    username,
    password,
    privateKey,
    passphrase,
    onLog,
  });

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
                `${msg}。远端 ${remoteBindHost}:${remotePort} 仍被占用：可点击「释放远端端口」或在连接前自动清理失败时，于云主机手动结束残留 sshd 会话。`,
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
      const lvl = /** @type {{ level?: string }} */ (err).level;
      if (lvl === 'agent') {
        onLog(`Agent: ${err.message}（继续尝试其它认证方式）`);
        return;
      }
      fail(err);
    });

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
