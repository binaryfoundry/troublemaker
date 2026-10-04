import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { postJson } from '../src/http-post.js';

describe('postJson', () => {
  it('sends JSON and parses the reply, however long the bridge takes to answer', async () => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Headers arrive only with the result, as they do for a long capture.
        setTimeout(() => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, result: JSON.parse(body) }));
        }, 50);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const reply = await postJson(`http://127.0.0.1:${port}/command`, { command: 'x', args: { n: 1 } });
      expect(reply).toEqual({ ok: true, result: { command: 'x', args: { n: 1 } } });
    } finally {
      server.close();
    }
  });

  it('rejects when nothing is listening', async () => {
    await expect(postJson('http://127.0.0.1:1/command', {})).rejects.toThrow();
  });
});
