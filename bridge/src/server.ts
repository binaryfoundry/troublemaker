/**
 * The local bridge server.
 *
 * Binds to loopback only. Exposes a small HTTP surface plus a WebSocket for
 * clients that want connection events pushed to them. Every request is
 * validated here before anything reaches Live.
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

import { BridgeError, UnknownCommandError, httpStatusFor, toPayload } from './errors.js';
import { Session } from './session.js';
import { LiveTransport } from './transport.js';
import { Logger } from './logger.js';
import { isKnownCommand, validateArgs, type CommandName } from './validation.js';
import { BRIDGE_SIDE_COMMANDS, COMMANDS, MUTATING_COMMANDS } from './commands/registry.js';
import { MasterChain } from './mastering/chain.js';

export interface BridgeOptions {
  host?: string;
  port?: number;
  liveHost?: string;
  livePort?: number;
  logger: Logger;
  /** Where decision logs and checkpoints are written. */
  dataDir?: string;
}

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export class Bridge {
  readonly transport: LiveTransport;
  readonly session: Session;
  readonly master: MasterChain;

  private readonly host: string;
  private readonly port: number;
  private readonly log: Logger;
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  constructor(options: BridgeOptions) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 8765;
    this.log = options.logger;

    this.transport = new LiveTransport({
      host: options.liveHost ?? '127.0.0.1',
      port: options.livePort ?? 9877,
      logger: this.log,
    });
    this.session = new Session(this.transport, this.log);
    this.master = new MasterChain(this.transport, options.dataDir);

    this.http = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        this.log.info(`unhandled HTTP error: ${String(error)}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ ok: false, error: toPayload(error) }));
      });
    });

    this.wss = new WebSocketServer({ server: this.http, path: '/ws' });
    this.wss.on('connection', (socket) => this.handleSocket(socket));

    this.transport.on('connected', (status) => this.broadcast({ type: 'connected', status }));
    this.transport.on('disconnected', (status) =>
      this.broadcast({ type: 'disconnected', status }),
    );
  }

  async start(): Promise<void> {
    this.transport.start();
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      // Loopback only. Exposing this to the LAN would hand anyone on the
      // network write access to the user's project.
      this.http.listen(this.port, this.host, () => {
        this.http.removeListener('error', reject);
        resolve();
      });
    });
    this.log.info(`bridge listening on http://${this.host}:${this.port}`);
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
    await this.transport.stop();
  }

  // -- command execution --------------------------------------------------

  /**
   * Validate and run one command. This is the single funnel: HTTP, WebSocket
   * and the CLI all arrive here, so nothing can skip validation.
   */
  async execute(
    rawCommand: unknown,
    rawArgs: unknown,
    options: { dryRun?: boolean } = {},
  ): Promise<unknown> {
    const id = randomUUID().slice(0, 8);

    if (typeof rawCommand !== 'string' || rawCommand.length === 0) {
      throw new BridgeError('BAD_REQUEST', "Request needs a non-empty 'command' string.");
    }

    if (rawCommand === 'transaction') {
      const args = (rawArgs ?? {}) as { commands?: unknown; atomic?: boolean };
      if (!Array.isArray(args.commands)) {
        throw new BridgeError(
          'VALIDATION_FAILED',
          "transaction needs an array of commands in args.commands.",
        );
      }
      this.log.command(id, 'transaction', { commands: args.commands });
      const startedAt = Date.now();
      const result = await this.session.runTransaction(
        args.commands as Array<{ command: string; args?: Record<string, unknown> }>,
        { atomic: args.atomic === true, dryRun: options.dryRun === true },
      );
      this.log.result(id, 'transaction', Date.now() - startedAt, true, result);
      return result;
    }

    if (!isKnownCommand(rawCommand)) {
      throw new UnknownCommandError(
        rawCommand,
        COMMANDS.map((c) => c.name),
      );
    }

    const command = rawCommand as CommandName;
    const args = validateArgs(command, rawArgs ?? {});
    this.log.command(id, command, args);

    if (options.dryRun) {
      // Nothing is sent to Live; the caller sees exactly what would be.
      const result = {
        dry_run: true,
        applied: false,
        mutates: MUTATING_COMMANDS.has(command),
        operations: [{ command, args }],
      };
      this.log.result(id, command, 0, true, result);
      return result;
    }

    const startedAt = Date.now();
    try {
      const result = BRIDGE_SIDE_COMMANDS.has(command)
        ? await this.executeBridgeSide(command, args)
        : await this.transport.send(command, args);
      this.log.result(id, command, Date.now() - startedAt, true, result);
      return result;
    } catch (error) {
      const payload = toPayload(error);
      this.log.failure(id, command, String(payload.code), String(payload.message));
      throw error;
    }
  }

  private async executeBridgeSide(
    command: CommandName,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (command) {
      case 'bridge.status':
        return this.status();
      case 'bridge.get_commands':
        return { commands: COMMANDS };
      case 'live.snapshot_clip': {
        const snapshot = await this.session.snapshotClip(
          args.track_id as number,
          args.clip_slot as number,
          args.label as string | undefined,
        );
        const { notes, ...rest } = snapshot;
        return { ...rest, note_count: notes.length };
      }
      case 'live.restore_clip':
        return this.session.restoreClip(args.snapshot_id as string);
      case 'live.list_snapshots':
        return { snapshots: this.session.listSnapshots() };
      case 'master.inspect_chain':
        return this.master.inspect(args.track_id as number | undefined);
      case 'master.set':
        return this.master.set(args as unknown as Parameters<MasterChain['set']>[0]);
      case 'master.decisions':
        return { decisions: this.master.listDecisions(args.role as string | undefined) };
      case 'master.reset_decisions':
        return this.master.resetDecisions(args.label as string | undefined);
      case 'master.checkpoint': {
        const { parameters, ...rest } = await this.master.checkpoint(
          args.label as string,
          args.track_id as number | undefined,
        );
        return { ...rest, parameter_count: parameters.length };
      }
      case 'master.restore_checkpoint':
        return this.master.restore(args.checkpoint_id as string);
      case 'master.list_checkpoints':
        return { checkpoints: this.master.listCheckpoints() };
      case 'master.build_chain':
        return this.master.buildChain({
          trackId: args.track_id as number | undefined,
          preset: args.preset as string | null | undefined,
        });
      case 'master.apply_preset':
        return this.master.applyPreset(args.preset as string, args.track_id as number | undefined);
      case 'master.meters':
        return this.master.meters(
          (args.seconds as number | undefined) ?? 3,
          args.track_id as number | undefined,
        );
      case 'live.duplicate_clip':
        return this.session.duplicateClip(
          args as unknown as Parameters<Session['duplicateClip']>[0],
        );
      default:
        throw new BridgeError(
          'INTERNAL_ERROR',
          `Command '${command}' is marked bridge-side but has no implementation.`,
          {},
          500,
        );
    }
  }

  status(): Record<string, unknown> {
    return {
      bridge: { host: this.host, port: this.port, websocket_clients: this.sockets.size },
      live: this.transport.status(),
      command_count: COMMANDS.length,
      snapshots: this.session.listSnapshots().length,
    };
  }

  // -- HTTP ---------------------------------------------------------------

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, connected: this.transport.isConnected });
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      return send(res, 200, { ok: true, result: this.status() });
    }

    if (req.method === 'GET' && url.pathname === '/commands') {
      return send(res, 200, { ok: true, result: { commands: COMMANDS } });
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      // The smoke-test endpoint from the plan's first prototype.
      try {
        const state = (await this.execute('live.get_project_state', {
          include_devices: false,
        })) as { tempo: number; tracks: Array<{ name: string }> };
        return send(res, 200, {
          connected: true,
          tempo: state.tempo,
          tracks: state.tracks.map((t) => t.name),
        });
      } catch (error) {
        return send(res, httpStatusFor(error), {
          connected: this.transport.isConnected,
          ok: false,
          error: toPayload(error),
        });
      }
    }

    if (req.method === 'POST' && url.pathname === '/command') {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return send(res, 400, { ok: false, error: toPayload(error) });
      }
      const payload = (body ?? {}) as {
        command?: unknown;
        args?: unknown;
        dry_run?: unknown;
      };
      try {
        const result = await this.execute(payload.command, payload.args, {
          dryRun: payload.dry_run === true,
        });
        return send(res, 200, { ok: true, result });
      } catch (error) {
        return send(res, httpStatusFor(error), { ok: false, error: toPayload(error) });
      }
    }

    send(res, 404, {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${req.method} ${url.pathname}.`,
        routes: ['GET /health', 'GET /status', 'GET /state', 'GET /commands', 'POST /command'],
      },
    });
  }

  // -- WebSocket ----------------------------------------------------------

  private handleSocket(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify({ type: 'status', status: this.transport.status() }));

    socket.on('message', async (raw) => {
      let message: { id?: unknown; command?: unknown; args?: unknown; dry_run?: unknown };
      try {
        message = JSON.parse(String(raw));
      } catch {
        socket.send(
          JSON.stringify({
            id: null,
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'Message was not valid JSON.' },
          }),
        );
        return;
      }
      const id = typeof message.id === 'string' ? message.id : null;
      try {
        const result = await this.execute(message.command, message.args, {
          dryRun: message.dry_run === true,
        });
        socket.send(JSON.stringify({ id, ok: true, result }));
      } catch (error) {
        socket.send(JSON.stringify({ id, ok: false, error: toPayload(error) }));
      }
    });

    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BridgeError('PAYLOAD_TOO_LARGE', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(
          new BridgeError('BAD_REQUEST', `Request body is not valid JSON: ${String(error)}`),
        );
      }
    });
    req.on('error', reject);
  });
}
