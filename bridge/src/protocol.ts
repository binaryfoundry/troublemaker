/**
 * Wire types shared by the bridge, the CLI and the Live Remote Script.
 *
 * The bridge <-> Live link is newline-delimited JSON over loopback TCP; the
 * client <-> bridge link is HTTP and WebSocket. Both carry the same envelope
 * so a request can be traced end to end by its id.
 */

export interface LiveRequest {
  id: string;
  command: string;
  args: Record<string, unknown>;
}

export interface LiveErrorPayload {
  code: string;
  message: string;
  /** Recovery hints: available_tracks, available_parameters, and friends. */
  [detail: string]: unknown;
}

export type LiveResponse =
  | { id: string | null; ok: true; result: unknown }
  | { id: string | null; ok: false; error: LiveErrorPayload };

export interface CommandEnvelope {
  command: string;
  args?: Record<string, unknown>;
  /** Report what would happen without touching the Live Set. */
  dry_run?: boolean;
}

export interface TransactionEnvelope {
  command: 'transaction';
  args: {
    commands: CommandEnvelope[];
    /** Snapshot every clip the batch touches, and roll back on failure. */
    atomic?: boolean;
  };
  dry_run?: boolean;
}

export interface ConnectionStatus {
  connected: boolean;
  host: string;
  port: number;
  /** Round-trip time of the most recent heartbeat, in milliseconds. */
  latencyMs: number | null;
  lastError: string | null;
  reconnectAttempts: number;
  commandsSent: number;
}

/** A note as it crosses every boundary in this system. Time is in beats. */
export interface Note {
  note_id?: number | null;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  mute?: boolean;
  probability?: number;
}

export interface NoteUpdate {
  note_id: number;
  pitch?: number;
  start?: number;
  duration?: number;
  velocity?: number;
  mute?: boolean;
  probability?: number;
}

export const PITCH_MIN = 0;
export const PITCH_MAX = 127;
export const VELOCITY_MIN = 0;
export const VELOCITY_MAX = 127;
