/**
 * The loopback TCP link to the TroubleMaker Remote Script running in Live.
 *
 * Responsibilities: one connection, automatic reconnect with backoff, a
 * heartbeat that detects a Live that has gone away without closing the
 * socket, request/response correlation by id, and per-request timeouts so a
 * wedged Live never leaves a caller hanging forever.
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { NotConnectedError, TimeoutError, LiveSideError } from './errors.js';
import type { ConnectionStatus, LiveRequest, LiveResponse } from './protocol.js';
import type { Logger } from './logger.js';

export interface TransportOptions {
  host?: string;
  port?: number;
  /** How long to wait for one command before giving up. */
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  logger: Logger;
}

interface Pending {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  startedAt: number;
}

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export class LiveTransport extends EventEmitter {
  readonly host: string;
  readonly port: number;

  private readonly requestTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly log: Logger;

  private socket: net.Socket | null = null;
  private buffer = '';
  private pending = new Map<string, Pending>();
  private connected = false;
  private closing = false;

  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private commandsSent = 0;
  private latencyMs: number | null = null;
  private lastError: string | null = null;

  constructor(options: TransportOptions) {
    super();
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 9877;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
    this.reconnectMinMs = options.reconnectMinMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
    this.log = options.logger;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  status(): ConnectionStatus {
    return {
      connected: this.connected,
      host: this.host,
      port: this.port,
      latencyMs: this.latencyMs,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      commandsSent: this.commandsSent,
    };
  }

  // -- lifecycle ----------------------------------------------------------

  start(): void {
    this.closing = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.clearTimers();
    this.failAllPending(new NotConnectedError('the bridge is shutting down'));
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  private connect(): void {
    if (this.closing || this.socket) return;
    const socket = new net.Socket();
    this.socket = socket;
    socket.setNoDelay(true);

    socket.once('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.buffer = '';
      this.log.info(`connected to Live at ${this.host}:${this.port}`);
      this.startHeartbeat();
      this.emit('connected', this.status());
    });

    socket.on('data', (chunk) => this.onData(chunk));

    socket.once('error', (error: Error) => {
      this.lastError = error.message;
      // 'close' always follows, and does the teardown.
      this.log.debug(`socket error: ${error.message}`);
    });

    socket.once('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.stopHeartbeat();
      this.failAllPending(
        new NotConnectedError(this.lastError ?? 'the connection to Live closed'),
      );
      if (wasConnected) {
        this.log.info('lost the connection to Live');
        this.emit('disconnected', this.status());
      }
      this.scheduleReconnect();
    });

    socket.connect(this.port, this.host);
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** Math.min(this.reconnectAttempts, 5),
    );
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts === 1 || this.reconnectAttempts % 10 === 0) {
      this.log.info(
        `reconnecting to Live in ${delay} ms (attempt ${this.reconnectAttempts})`,
      );
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const startedAt = Date.now();
      this.send('ping', {}, 3_000)
        .then(() => {
          this.latencyMs = Date.now() - startedAt;
        })
        .catch(() => {
          // A missed heartbeat means Live is wedged or gone; drop the socket
          // so the reconnect path runs rather than queueing dead requests.
          this.latencyMs = null;
          if (this.socket) {
            this.log.info('heartbeat failed - dropping the connection to Live');
            this.socket.destroy();
          }
        });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -- framing ------------------------------------------------------------

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.lastError = 'response exceeded the maximum buffer size';
      this.buffer = '';
      this.socket?.destroy();
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let response: LiveResponse;
    try {
      response = JSON.parse(line) as LiveResponse;
    } catch {
      this.log.debug(`unparseable line from Live: ${line.slice(0, 200)}`);
      return;
    }
    const id = response.id;
    if (typeof id !== 'string') {
      this.log.debug('response from Live had no request id; discarding');
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      // A late answer to a request that already timed out.
      this.log.debug(`unmatched response id ${id}`);
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new LiveSideError(response.error));
    }
  }

  // -- requests -----------------------------------------------------------

  send(command: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    if (!this.connected || !this.socket) {
      return Promise.reject(
        new NotConnectedError(this.lastError ?? 'no socket to the Remote Script'),
      );
    }
    const id = randomUUID();
    const request: LiveRequest = { id, command, args };
    let payload: string;
    try {
      payload = `${JSON.stringify(request)}\n`;
    } catch (error) {
      return Promise.reject(
        new TypeError(`Command '${command}' has arguments that cannot be serialized.`),
      );
    }

    const limit = timeoutMs ?? this.requestTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(command, limit));
      }, limit);
      timer.unref?.();

      this.pending.set(id, { command, resolve, reject, timer, startedAt: Date.now() });
      this.commandsSent += 1;
      this.socket!.write(payload, 'utf8', (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new NotConnectedError(error.message));
        }
      });
    });
  }

  private failAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Resolve once Live answers a ping, or reject after `timeoutMs`. */
  async waitUntilReady(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.connected) {
        try {
          await this.send('ping', {}, 2_000);
          return;
        } catch {
          // fall through and retry until the deadline
        }
      }
      if (Date.now() >= deadline) {
        throw new NotConnectedError(
          `no response from the Remote Script on ${this.host}:${this.port} within ${timeoutMs} ms`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
