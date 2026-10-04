/**
 * POST JSON to the bridge and parse the JSON reply, with no response timeout.
 *
 * Node's fetch gives up after 300 s without response headers, and a long
 * master capture (a whole song is ~400 s) sends none until it finishes - the
 * client then reported "Cannot reach the bridge" while Live kept recording.
 * The bridge's own timeouts bound every command, so the client adds none.
 */

import { request } from 'node:http';

export function postJson(url: string, payload: unknown): Promise<unknown> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.end(body);
  });
}
