/**
 * Bridge-side errors.
 *
 * Every failure the agent can see carries a stable `code` plus, where it
 * helps the agent retry without asking the user, the valid alternatives.
 */

import type { LiveErrorPayload } from './protocol.js';

export class BridgeError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    httpStatus = 400,
  ) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }

  toPayload(): LiveErrorPayload {
    return { code: this.code, message: this.message, ...this.details };
  }
}

export class NotConnectedError extends BridgeError {
  constructor(detail: string) {
    super(
      'NOT_CONNECTED',
      `The bridge is not connected to Ableton Live: ${detail}. Check that Live is ` +
        'running and that TroubleMaker is selected as a Control Surface in ' +
        'Preferences > Link/Tempo/MIDI.',
      {},
      503,
    );
  }
}

export class TimeoutError extends BridgeError {
  constructor(command: string, ms: number) {
    super(
      'TIMEOUT',
      `Live did not answer '${command}' within ${ms} ms. The Set may be very large, ` +
        'or Live may be busy loading a device.',
      { command, timeout_ms: ms },
      504,
    );
  }
}

export class ValidationError extends BridgeError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('VALIDATION_FAILED', message, details, 400);
  }
}

export class UnknownCommandError extends BridgeError {
  constructor(command: string, available: string[]) {
    super('UNKNOWN_COMMAND', `No such command: ${command}`, {
      available_commands: available,
    });
  }
}

export class SnapshotNotFoundError extends BridgeError {
  constructor(id: string) {
    super('SNAPSHOT_NOT_FOUND', `No snapshot with id '${id}'.`, { snapshot_id: id }, 404);
  }
}

/** An error returned by Live itself, re-wrapped so callers see one shape. */
export class LiveSideError extends BridgeError {
  constructor(payload: LiveErrorPayload) {
    const { code, message, ...details } = payload;
    super(code ?? 'LIVE_ERROR', message ?? 'Live reported an error.', details, 400);
    this.name = 'LiveSideError';
  }
}

export function toPayload(error: unknown): LiveErrorPayload {
  if (error instanceof BridgeError) return error.toPayload();
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: String(error) };
}

export function httpStatusFor(error: unknown): number {
  return error instanceof BridgeError ? error.httpStatus : 500;
}
