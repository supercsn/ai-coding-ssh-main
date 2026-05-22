import { execCommand } from './ssh-exec.js';

function escapeShellSingle(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Read remote Claude Code settings (`~/.claude/settings.json`); missing ⇒ null。
 * @param {import('ssh2').Client} client
 * @returns {Promise<object|null>}
 */
export async function readRemoteClaudeSettingsJson(client) {
  const cmd =
    'if test -f "$HOME/.claude/settings.json"; then base64 "$HOME/.claude/settings.json" | tr -d "\\n"; fi';
  const r = await execCommand(client, cmd);
  if (r.code !== 0) {
    throw new Error(r.errOut || r.out || `readRemoteClaudeSettingsJson failed code=${r.code}`);
  }
  const b64 = (r.out || '').trim();
  if (!b64) return null;
  let raw = '';
  try {
    raw = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    throw new Error('无法解码远端 ~/.claude/settings.json（base64）');
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('远端 ~/.claude/settings.json 不是合法 JSON，请先手动修复后再试');
  }
}

/**
 * @param {object | null | undefined} existing
 * @param {number} remotePort
 */
export function mergeClaudeProxyEnv(existing, remotePort) {
  const base =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...existing }
      : {};
  /** @type {Record<string, string>} */
  const env =
    typeof base.env === 'object' && base.env !== null && !Array.isArray(base.env)
      ? { ...(/** @type {Record<string, string>} */ (base.env)) }
      : {};
  env.HTTP_PROXY = `http://127.0.0.1:${remotePort}`;
  env.HTTPS_PROXY = `http://127.0.0.1:${remotePort}`;
  env.NO_PROXY = 'localhost,127.0.0.1,::1';
  base.env = env;
  return base;
}

/**
 * @param {import('ssh2').Client} client
 * @param {object} obj
 */
export async function writeRemoteClaudeSettingsJson(client, obj) {
  const json = `${JSON.stringify(obj, null, 2)}\n`;
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const cmd = `mkdir -p ~/.claude && echo ${escapeShellSingle(b64)} | base64 -d > "$HOME/.claude/settings.json" && chmod 600 "$HOME/.claude/settings.json"`;
  const r = await execCommand(client, cmd);
  if (r.code !== 0) {
    throw new Error(r.errOut || r.out || `writeRemoteClaudeSettingsJson failed code=${r.code}`);
  }
}

/**
 * 合并写入 Claude Code CLI 读取的 ~/.claude/settings.json（注入 HTTP_PROXY / HTTPS_PROXY）。
 * @param {import('ssh2').Client} client
 * @param {{ remotePort: number }} opts
 */
export async function applyClaudeCodeProxySettings(client, opts) {
  const prev = await readRemoteClaudeSettingsJson(client);
  const next = mergeClaudeProxyEnv(prev, opts.remotePort);
  await writeRemoteClaudeSettingsJson(client, next);
}

/**
 * 从 ~/.claude/settings.json 删掉 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 三个键。
 * @param {import('ssh2').Client} client
 */
export async function removeClaudeCodeProxyEnvKeys(client) {
  const prev = await readRemoteClaudeSettingsJson(client);
  if (!prev) return;
  /** @type {Record<string, unknown>} */
  const base = typeof prev === 'object' && prev !== null ? { ...prev } : {};
  const envRaw = base.env;
  if (!(typeof envRaw === 'object' && envRaw !== null && !Array.isArray(envRaw))) {
    return;
  }
  /** @type {Record<string, unknown>} */
  const env = { ...envRaw };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.NO_PROXY;
  if (Object.keys(env).length > 0) {
    base.env = env;
  } else {
    delete base.env;
  }
  await writeRemoteClaudeSettingsJson(client, base);
}
