import net from 'node:net';

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function probeTcpConnect(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });

    let done = false;
    const finish = (/** @type {{ ok: boolean, error?: string }} */ r) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish({ ok: true }));
    sock.once('timeout', () => finish({ ok: false, error: '连接超时' }));
    sock.once('error', (e) =>
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  });
}
