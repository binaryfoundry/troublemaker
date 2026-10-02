/**
 * A stand-in for the Remote Script speaking the real newline-delimited JSON
 * protocol, with a scriptable command table.
 */

import net from 'node:net';

export type Handler = (command: string, args: Record<string, unknown>) => unknown;

/** A stand-in for the Remote Script, with a scriptable command table. */
export class FakeLive {
  private server: net.Server;
  private sockets = new Set<net.Socket>();
  port = 0;
  received: Array<{ command: string; args: Record<string, unknown> }> = [];
  handlers = new Map<string, Handler>();
  /** Stop answering, to simulate a wedged Live. */
  silent = false;

  constructor() {
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) this.onLine(socket, line);
          newline = buffer.indexOf('\n');
        }
      });
      socket.on('error', () => this.sockets.delete(socket));
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  private onLine(socket: net.Socket, line: string): void {
    const request = JSON.parse(line) as {
      id: string;
      command: string;
      args: Record<string, unknown>;
    };
    if (request.command !== 'ping') this.received.push(request);
    if (this.silent) return;

    const handler = this.handlers.get(request.command);
    let response: unknown;
    if (request.command === 'ping') {
      response = { id: request.id, ok: true, result: { pong: true } };
    } else if (!handler) {
      response = {
        id: request.id,
        ok: false,
        error: { code: 'UNKNOWN_COMMAND', message: `no such command ${request.command}` },
      };
    } else {
      try {
        response = { id: request.id, ok: true, result: handler(request.command, request.args) };
      } catch (error) {
        response = {
          id: request.id,
          ok: false,
          error: { code: 'LIVE_ERROR', message: (error as Error).message },
        };
      }
    }
    socket.write(`${JSON.stringify(response)}\n`);
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  /** Drop every client, as Live does when the Remote Script reloads. */
  dropClients(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async close(): Promise<void> {
    this.dropClients();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

