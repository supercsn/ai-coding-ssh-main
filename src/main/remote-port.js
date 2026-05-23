import { execCommand } from './ssh-exec.js';

/**
 * @param {number} port
 * @param {string} [bindHost]
 */
function shellReleaseScript(port, bindHost = '127.0.0.1') {
  const p = Number(port);
  const b = String(bindHost).replace(/'/g, `'\\''`);
  return `
PORT=${p}
BIND='${b}'
if ! ss -tln 2>/dev/null | grep -q "${bindHost}:${p} "; then
  echo PORT_FREE
  exit 0
fi
PID=""
if command -v ss >/dev/null 2>&1; then
  LINE=$(sudo -n ss -tlnp 2>/dev/null | grep "${bindHost}:${p} " | head -1)
  if [ -z "$LINE" ]; then
    LINE=$(ss -tlnp 2>/dev/null | grep "${bindHost}:${p} " | head -1)
  fi
  PID=$(printf '%s' "$LINE" | sed -n 's/.*pid=\\([0-9]*\\).*/\\1/p' | head -1)
fi
if [ -n "$PID" ]; then
  echo "KILL pid=$PID"
  kill "$PID" 2>/dev/null || sudo -n kill "$PID" 2>/dev/null || true
  sleep 1
fi
if ss -tln 2>/dev/null | grep -q "${bindHost}:${p} "; then
  echo PORT_STILL_IN_USE
  exit 1
fi
echo PORT_RELEASED
exit 0
`.trim();
}

/**
 * @param {import('ssh2').Client} client
 * @param {number} remotePort
 * @param {string} [bindHost]
 */
export async function probeRemoteForwardPort(client, remotePort, bindHost = '127.0.0.1') {
  const p = Number(remotePort);
  const b = String(bindHost).replace(/'/g, `'\\''`);
  const cmd = `ss -tln 2>/dev/null | grep -q '${b}:${p} ' && echo IN_USE || echo FREE`;
  const r = await execCommand(client, cmd);
  const line = (r.out || r.errOut || '').trim().split('\n').pop() || '';
  const inUse = line.includes('IN_USE');
  let holder = '';
  if (inUse) {
    const detail = await execCommand(
      client,
      `sudo -n ss -tlnp 2>/dev/null | grep '${b}:${p} ' | head -1 || ss -tlnp 2>/dev/null | grep '${b}:${p} ' | head -1 || true`,
    );
    holder = (detail.out || detail.errOut || '').trim();
  }
  return {
    inUse,
    remotePort: p,
    bindHost,
    detail: holder || (inUse ? '端口监听中（未能解析占用进程，可能需要 sudo）' : ''),
  };
}

/**
 * 结束云主机上占用远端反向端口的残留 sshd 会话。
 * @param {import('ssh2').Client} client
 * @param {number} remotePort
 * @param {(msg: string) => void} [onLog]
 * @param {string} [bindHost]
 */
export async function releaseRemoteForwardPort(client, remotePort, onLog = () => {}, bindHost = '127.0.0.1') {
  const before = await probeRemoteForwardPort(client, remotePort, bindHost);
  if (!before.inUse) {
    onLog(`远端 ${bindHost}:${remotePort} 未被占用`);
    return { released: true, alreadyFree: true, detail: before.detail };
  }

  onLog(`远端 ${bindHost}:${remotePort} 已被占用，尝试结束残留会话…`);
  if (before.detail) onLog(before.detail);

  const r = await execCommand(client, shellReleaseScript(remotePort, bindHost));
  const output = `${r.out || ''}${r.errOut || ''}`.trim();
  for (const line of output.split('\n').filter(Boolean)) {
    onLog(line);
  }

  const after = await probeRemoteForwardPort(client, remotePort, bindHost);
  if (after.inUse) {
    throw new Error(
      `未能释放远端 ${bindHost}:${remotePort}。请在云主机执行：sudo ss -tlnp | grep ${remotePort}，手动结束对应 sshd 会话。`,
    );
  }

  onLog(`远端 ${bindHost}:${remotePort} 已释放`);
  return { released: true, alreadyFree: false, detail: after.detail };
}
