/**
 * @param {import('ssh2').Client} client
 * @param {string} command
 * @returns {Promise<{ code: number, signal?: string, out: string, errOut: string }>}
 */
export function execCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('close', (code, signal) => {
        resolve({
          code: code ?? 0,
          signal,
          out,
          errOut,
        });
      });
      stream.on('data', (d) => {
        out += d.toString();
      });
      stream.stderr.on('data', (d) => {
        errOut += d.toString();
      });
    });
  });
}
