import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import started from 'electron-squirrel-startup';
import { app, BrowserWindow, ipcMain } from 'electron';

import * as settings from './settings-store.js';
import * as desktopPrefs from './preferences-store.js';
import { probeTcpConnect } from './tcp-probe.js';
import { openReverseTunnel } from './ssh-tunnel.js';
import { connectSshClient, endSshClient } from './ssh-connect.js';
import {
  probeRemoteForwardPort,
  releaseRemoteForwardPort,
} from './remote-port.js';
import {
  applyClaudeCodeProxySettings,
  removeClaudeCodeProxyEnvKeys,
} from './remote-config.js';
import { setupTray, destroyTray } from './tray.js';

if (started) {
  app.quit();
}

/** 禁止多开：避免关窗进托盘后再次 npm start 留下旧隧道占用远端端口 */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** Windows：点关闭时先藏到托盘，真正退出托盘菜单设为 true */
let appQuitting = false;

/** @type {Map<string, { ssh: Awaited<ReturnType<typeof openReverseTunnel>>, record: object, log: string[], closing?: boolean }>} */
const active = new Map();

/** before-quit 异步清理隧道时避免重复进入 */
let tunnelCleanupInProgress = false;

function sendTunnelLog(serverId, line) {
  const entry = active.get(serverId);
  if (entry) {
    entry.log.push(`[${new Date().toISOString()}] ${line}`);
    if (entry.log.length > 600) entry.log.splice(0, entry.log.length - 400);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tunnel:log', { serverId, line });
  }
}

function broadcastState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('tunnel:state', {
    tunnels: [...active.entries()].map(([serverId, v]) => ({
      serverId,
      host: v.record.host,
      remotePort: v.record.remotePort,
    })),
  });
}

function attachTunnelDropHandler(serverId, entry) {
  entry.ssh.client.once('close', () => {
    if (entry.closing) return;
    sendTunnelLog(
      serverId,
      'SSH 连接已断开（可能是 WiFi/网络中断）。若重连失败，请先断开或托盘退出，再点击「释放远端端口」。',
    );
    active.delete(serverId);
    broadcastState();
  });
}

async function closeActiveTunnel(serverId, entry) {
  entry.closing = true;
  try {
    await entry.ssh.close();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendTunnelLog(serverId, `断开时出错: ${msg}`);
    try {
      entry.ssh.client.destroy();
    } catch {
      /* */
    }
  }
}

async function closeAllActiveTunnels() {
  const tasks = [...active.entries()].map(([serverId, entry]) =>
    closeActiveTunnel(serverId, entry),
  );
  await Promise.all(tasks);
  active.clear();
  broadcastState();
}

function attachWindowsTrayHooks(win) {
  if (process.platform !== 'win32') return;
  win.on('minimize', () => win.hide());

  win.on('close', (e) => {
    if (!appQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApplicationCompletely() {
  appQuitting = true;
  destroyTray();
  app.quit();
}

function ensureWindowsTray(win) {
  if (process.platform !== 'win32') return;

  attachWindowsTrayHooks(win);
  setupTray({
    showMainWindow,
    quitApp: quitApplicationCompletely,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // eslint-disable-next-line no-undef
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // eslint-disable-next-line no-undef
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // eslint-disable-next-line no-undef
    const viteName = MAIN_WINDOW_VITE_NAME;
    mainWindow.loadFile(path.join(__dirname, `../renderer/${viteName}/index.html`));
  }

  ensureWindowsTray(mainWindow);
}

function expandUserPath(p) {
  if (!p || typeof p !== 'string') return '';
  const t = p.trim();
  if (t === '~') return homedir();
  if (t.startsWith('~/') || t.startsWith('~\\')) {
    return path.join(homedir(), t.slice(2));
  }
  return t;
}

async function buildAuthSecrets(rec, runtimeSecrets) {
  const disk = settings.loadSecrets(rec.id);
  /** @typedef {{ password?: string, privateKey?: string, passphrase?: string }} SshSecrets */
  /** @type {SshSecrets} */
  const sec = { ...disk, ...runtimeSecrets };

  const password =
    sec.password != null && String(sec.password).trim() !== ''
      ? String(sec.password).trim()
      : undefined;

  const passphrase =
    sec.passphrase != null && String(sec.passphrase).trim() !== ''
      ? String(sec.passphrase).trim()
      : undefined;

  let privateKey = '';
  let keySource = '';

  if (sec.privateKey != null && String(sec.privateKey).trim() !== '') {
    privateKey = String(sec.privateKey).trim().replace(/^\uFEFF/, '');
    keySource = '（已保存的私钥文本）';
  }
  let keyPath = rec.privateKeyPath != null ? String(rec.privateKeyPath).trim() : '';
  keyPath = keyPath.replace(/^["']+|["']+$/g, '').trim();
  if (!privateKey && keyPath) {
    const abs = expandUserPath(keyPath);
    try {
      privateKey = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
      keySource = abs;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`无法读取私钥文件：${abs}\n${msg}`);
    }
  }

  if (!privateKey && !keyPath) {
    for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
      const abs = path.join(homedir(), '.ssh', name);
      try {
        if (fs.existsSync(abs)) {
          privateKey = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
          keySource = abs;
          break;
        }
      } catch {
        /* continue */
      }
    }
  }

  /** @type {{ password?: string, privateKey?: string, passphrase?: string }} */
  const auth = {};
  if (password) auth.password = password;
  if (privateKey) {
    auth.privateKey = privateKey;
    if (passphrase) auth.passphrase = passphrase;
  }

  if (!auth.password && !auth.privateKey) {
    throw new Error(
      '未配置可用的 SSH 凭据：请填写密码，或填写私钥（粘贴 PEM / 私钥文件路径）。若命令行 ssh 能连上但未填私钥，多半是用了 ~/.ssh/id_ed25519 等默认密钥——可在本应用中填写相同私钥路径，或保证上述默认文件存在。',
    );
  }

  return { auth, keySource };
}

/**
 * @param {object} rec
 * @param {object} [runtimeSecrets]
 * @param {(msg: string) => void} onLog
 * @param {(client: import('ssh2').Client) => Promise<T>} fn
 * @template T
 */
async function withSshSession(rec, runtimeSecrets, onLog, fn) {
  const { auth } = await buildAuthSecrets(rec, runtimeSecrets || {});
  const client = await connectSshClient({
    host: typeof rec.host === 'string' ? rec.host.trim() : rec.host,
    port: rec.sshPort || 22,
    username: rec.username,
    password: auth.password,
    privateKey: auth.privateKey,
    passphrase: auth.passphrase,
    onLog,
  });
  try {
    return await fn(client);
  } finally {
    await endSshClient(client);
  }
}

async function precleanRemoteForwardPort(rec, runtimeSecrets, serverId) {
  const remotePort = rec.remotePort || 18080;
  const onLog = (msg) => sendTunnelLog(serverId, msg);
  await withSshSession(rec, runtimeSecrets, onLog, async (client) => {
    const status = await probeRemoteForwardPort(client, remotePort);
    if (!status.inUse) {
      onLog(`连接前检查：远端 127.0.0.1:${remotePort} 空闲`);
      return;
    }
    onLog(`连接前检查：远端 127.0.0.1:${remotePort} 已被占用，自动清理残留会话…`);
    await releaseRemoteForwardPort(client, remotePort, onLog);
  });
}

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('proxy:status', async () => {
    const prefs = desktopPrefs.loadDesktopPreferences();
    const probe = await probeTcpConnect(prefs.localProxyHost, prefs.localProxyPort);
    return {
      ok: probe.ok,
      prefs,
      forwardProbeError: probe.ok ? undefined : probe.error,
    };
  });

  ipcMain.handle('proxy:configure', async (_evt, opts) => {
    if (active.size > 0) {
      throw new Error('请先断开所有 SSH 隧道再修改本机 Clash / HTTP 出站地址');
    }

    desktopPrefs.saveDesktopPreferences({
      localProxyHost:
        opts.localProxyHost !== undefined ? String(opts.localProxyHost).trim() : undefined,
      localProxyPort:
        opts.localProxyPort !== undefined && Number(opts.localProxyPort) > 0
          ? Number(opts.localProxyPort)
          : undefined,
    });

    const prefs = desktopPrefs.loadDesktopPreferences();
    const probe = await probeTcpConnect(prefs.localProxyHost, prefs.localProxyPort);
    return {
      prefs,
      reachable: probe.ok,
      forwardProbeError: probe.ok ? undefined : probe.error,
    };
  });

  ipcMain.handle('crypto:encryptionAvailable', () => settings.encryptionAvailable());

  ipcMain.handle('servers:list', () => settings.listServers());

  ipcMain.handle('servers:save', async (_evt, payload) => {
    const record = payload.record || payload;
    const secrets = payload.secrets || {};
    const id = record.id || randomUUID();
    const { secrets: _drop, ...rest } = record;
    const toSave = { ...rest, id };
    settings.saveServerRecord(toSave);
    let secretsPersisted = true;
    if (Object.keys(secrets).length > 0) {
      secretsPersisted = settings.saveSecrets(id, secrets);
    }
    return { server: toSave, secretsPersisted };
  });

  ipcMain.handle('servers:delete', (_evt, id) => {
    if (active.has(id)) throw new Error('请先断开连接再删除');
    settings.deleteServerRecord(id);
    return { ok: true };
  });

  ipcMain.handle('tunnel:connect', async (_evt, { serverId, runtimeSecrets }) => {
    if (active.has(serverId)) throw new Error('该服务器已连接');
    const rec = settings.listServers().find((s) => s.id === serverId);
    if (!rec) throw new Error('找不到服务器');

    const prefs = desktopPrefs.loadDesktopPreferences();
    const localHost = prefs.localProxyHost;
    const localPort = prefs.localProxyPort;

    sendTunnelLog(
      serverId,
      `反向隧道 → 本机 CONNECT 出站 ${localHost}:${localPort}（请先启动 Clash 等监听该端口）`,
    );

    const { auth, keySource } = await buildAuthSecrets(rec, runtimeSecrets || {});

    if (auth.privateKey && keySource) {
      sendTunnelLog(serverId, `认证: 使用私钥 ${keySource}`);
    } else if (auth.privateKey) {
      sendTunnelLog(serverId, '认证: 使用已保存的私钥文本');
    }
    if (auth.password) {
      sendTunnelLog(serverId, '认证: 将尝试密码与 keyboard-interactive（若服务端需要）');
    }

    try {
      await precleanRemoteForwardPort(rec, runtimeSecrets, serverId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendTunnelLog(serverId, `连接前端口清理失败: ${msg}`);
      throw e;
    }

    const ssh = await openReverseTunnel({
      host: typeof rec.host === 'string' ? rec.host.trim() : rec.host,
      port: rec.sshPort || 22,
      username: rec.username,
      password: auth.password,
      privateKey: auth.privateKey,
      passphrase: auth.passphrase,
      remotePort: rec.remotePort || 18080,
      localHost,
      localPort,
      onLog: (msg) => sendTunnelLog(serverId, msg),
    });

    const entry = { ssh, record: rec, log: [], closing: false };
    attachTunnelDropHandler(serverId, entry);
    active.set(serverId, entry);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('tunnel:disconnect', async (_evt, serverId) => {
    const e = active.get(serverId);
    if (!e) return { ok: true };
    await closeActiveTunnel(serverId, e);
    active.delete(serverId);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('tunnel:list', () =>
    [...active.entries()].map(([serverId, v]) => ({
      serverId,
      host: v.record.host,
      remotePort: v.record.remotePort,
    })),
  );

  ipcMain.handle('tunnel:logs', (_evt, serverId) => active.get(serverId)?.log.slice(-300) ?? []);

  ipcMain.handle('tunnel:checkRemotePort', async (_evt, { serverId, runtimeSecrets }) => {
    const rec = settings.listServers().find((s) => s.id === serverId);
    if (!rec) throw new Error('找不到服务器');
    const remotePort = rec.remotePort || 18080;
    return withSshSession(rec, runtimeSecrets, (msg) => sendTunnelLog(serverId, msg), (client) =>
      probeRemoteForwardPort(client, remotePort),
    );
  });

  ipcMain.handle('tunnel:releaseRemotePort', async (_evt, { serverId, runtimeSecrets }) => {
    if (active.has(serverId)) {
      throw new Error('请先断开当前隧道，再释放远端端口');
    }
    const rec = settings.listServers().find((s) => s.id === serverId);
    if (!rec) throw new Error('找不到服务器');
    const remotePort = rec.remotePort || 18080;
    return withSshSession(rec, runtimeSecrets, (msg) => sendTunnelLog(serverId, msg), (client) =>
      releaseRemoteForwardPort(client, remotePort, (msg) => sendTunnelLog(serverId, msg)),
    );
  });

  ipcMain.handle('remote:applyClaudeSettings', async (_evt, serverId) => {
    const e = active.get(serverId);
    if (!e) throw new Error('请先建立 SSH 隧道');
    const remotePort = e.record.remotePort || 18080;
    await applyClaudeCodeProxySettings(e.ssh.client, { remotePort });
    sendTunnelLog(
      serverId,
      `已合并写入远端 ~/.claude/settings.json（HTTP_PROXY=http://127.0.0.1:${remotePort}）`,
    );
    return { ok: true };
  });

  ipcMain.handle('remote:removeClaudeSettings', async (_evt, serverId) => {
    const e = active.get(serverId);
    if (!e) throw new Error('请先建立 SSH 隧道才能清理远端配置');
    await removeClaudeCodeProxyEnvKeys(e.ssh.client);
    sendTunnelLog(serverId, '已从 ~/.claude/settings.json 移除 HTTP(S)_PROXY / NO_PROXY 键');
    return { ok: true };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // Windows：关闭主窗口会先 hide，托盘常驻；只有通过托盘退出才销毁窗口
  if (process.platform === 'win32') return;
  app.quit();
});

app.on('before-quit', (e) => {
  if (tunnelCleanupInProgress) return;
  appQuitting = true;
  destroyTray();
  if (active.size === 0) return;

  e.preventDefault();
  tunnelCleanupInProgress = true;
  void closeAllActiveTunnels().finally(() => {
    tunnelCleanupInProgress = false;
    app.quit();
  });
});
