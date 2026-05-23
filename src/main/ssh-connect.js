import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { app } from 'electron';

/** @type {typeof import('ssh2').Client | null} */
let ClientClass = null;

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
      /* */
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
 * @param {(msg: string) => void} [cfg.onLog]
 * @returns {{ client: import('ssh2').Client, connectOpts: import('ssh2').ConnectConfig }}
 */
export function createSshClient(cfg) {
  const {
    host,
    port = 22,
    username,
    password,
    privateKey,
    passphrase,
    onLog = () => {},
  } = cfg;

  const Client = getClientConstructor();
  const client = new Client();

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
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    debug: (msg) => onLog(String(msg).slice(0, 500)),
  };
  if (password) connectOpts.password = password;
  if (keyMaterial) connectOpts.privateKey = keyMaterial;
  if (passphrase) connectOpts.passphrase = passphrase;

  const agentPath = resolveSshAgentPath();
  if (agentPath) {
    connectOpts.agent = agentPath;
  }

  const kb = password ? ['password', 'keyboard-interactive'] : [];
  if (keyMaterial) {
    connectOpts.authHandler = password
      ? ['publickey', 'agent', ...kb]
      : ['publickey', 'agent'];
  } else if (password) {
    connectOpts.authHandler = ['agent', ...kb];
  }

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

  client.on('error', (err) => {
    const lvl = /** @type {{ level?: string }} */ (err).level;
    if (lvl === 'agent') {
      onLog(`Agent: ${err.message}（继续尝试其它认证方式）`);
    }
  });

  return { client, connectOpts };
}

/**
 * @param {object} cfg
 * @param {(msg: string) => void} [cfg.onLog]
 * @returns {Promise<import('ssh2').Client>}
 */
export function connectSshClient(cfg) {
  const { onLog = () => {} } = cfg;
  const { client, connectOpts } = createSshClient(cfg);

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch {
        /* */
      }
      reject(err);
    };

    client.once('ready', () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });

    client.once('error', (err) => {
      const lvl = /** @type {{ level?: string }} */ (err).level;
      if (lvl === 'agent') return;
      fail(err);
    });

    client.connect(connectOpts);
  });
}

/**
 * @param {import('ssh2').Client} client
 */
export function endSshClient(client) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        client.destroy();
      } catch {
        /* */
      }
      finish();
    }, 5000);
    try {
      client.end();
      client.once('close', () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      try {
        client.destroy();
      } catch {
        /* */
      }
      finish();
    }
  });
}
