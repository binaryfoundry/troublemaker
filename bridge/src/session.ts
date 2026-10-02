/**
 * Everything the bridge owns that Live does not: snapshots, transactions,
 * dry-run, and the handful of composite commands built from primitives.
 *
 * Live's own undo stack is available too (live.undo), but it is global and
 * the user shares it. A snapshot is narrower and safer: it captures exactly
 * the clip an edit is about to overwrite, so a bad generation can be undone
 * without disturbing anything else the user did.
 */

import { randomUUID } from 'node:crypto';

import { BridgeError, SnapshotNotFoundError } from './errors.js';
import type { Note } from './protocol.js';
import type { LiveTransport } from './transport.js';
import type { Logger } from './logger.js';
import { isKnownCommand, validateArgs, type CommandName } from './validation.js';

export interface ClipSnapshot {
  snapshot_id: string;
  label: string | null;
  created_at: string;
  track_id: number;
  track_name: string;
  clip_slot: number;
  clip_name: string;
  length_beats: number;
  loop_start: number;
  loop_end: number;
  looping: boolean;
  notes: Note[];
}

/** How many snapshots to keep before discarding the oldest. */
const SNAPSHOT_LIMIT = 100;

export class Session {
  private snapshots = new Map<string, ClipSnapshot>();

  constructor(
    private readonly transport: LiveTransport,
    private readonly log: Logger,
  ) {}

  // -- snapshots ----------------------------------------------------------

  async snapshotClip(trackId: number, clipSlot: number, label?: string): Promise<ClipSnapshot> {
    const clip = (await this.transport.send('live.get_clip', {
      track_id: trackId,
      clip_slot: clipSlot,
    })) as Record<string, unknown>;

    const notesResult = clip.is_midi_clip
      ? ((await this.transport.send('live.get_notes', {
          track_id: trackId,
          clip_slot: clipSlot,
        })) as { notes: Note[] })
      : { notes: [] };

    const track = (await this.transport.send('live.get_track', {
      track_id: trackId,
    })) as { name?: string };

    const snapshot: ClipSnapshot = {
      snapshot_id: randomUUID(),
      label: label ?? null,
      created_at: new Date().toISOString(),
      track_id: trackId,
      track_name: track.name ?? '?',
      clip_slot: clipSlot,
      clip_name: String(clip.name ?? ''),
      length_beats: Number(clip.length_beats ?? 0),
      loop_start: Number(clip.loop_start ?? 0),
      loop_end: Number(clip.loop_end ?? 0),
      looping: Boolean(clip.looping),
      notes: notesResult.notes ?? [],
    };

    this.snapshots.set(snapshot.snapshot_id, snapshot);
    this.evictOldest();
    this.log.debug(
      `snapshot ${snapshot.snapshot_id} of '${snapshot.clip_name}' (${snapshot.notes.length} notes)`,
    );
    return snapshot;
  }

  private evictOldest(): void {
    while (this.snapshots.size > SNAPSHOT_LIMIT) {
      const oldest = this.snapshots.keys().next();
      if (oldest.done) return;
      this.snapshots.delete(oldest.value);
    }
  }

  listSnapshots(): Array<Omit<ClipSnapshot, 'notes'> & { note_count: number }> {
    return [...this.snapshots.values()].map(({ notes, ...rest }) => ({
      ...rest,
      note_count: notes.length,
    }));
  }

  async restoreClip(snapshotId: string): Promise<Record<string, unknown>> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new SnapshotNotFoundError(snapshotId);

    await this.ensureClipExists(snapshot.track_id, snapshot.clip_slot, snapshot.length_beats);

    await this.transport.send('live.replace_notes', {
      track_id: snapshot.track_id,
      clip_slot: snapshot.clip_slot,
      notes: snapshot.notes.map(stripNoteId),
    });
    await this.transport.send('live.set_clip_loop', {
      track_id: snapshot.track_id,
      clip_slot: snapshot.clip_slot,
      start: snapshot.loop_start,
      end: snapshot.loop_end,
      looping: snapshot.looping,
    });
    if (snapshot.clip_name) {
      await this.transport.send('live.set_clip_name', {
        track_id: snapshot.track_id,
        clip_slot: snapshot.clip_slot,
        name: snapshot.clip_name,
      });
    }
    return {
      restored: true,
      snapshot_id: snapshotId,
      track_id: snapshot.track_id,
      clip_slot: snapshot.clip_slot,
      notes_restored: snapshot.notes.length,
    };
  }

  private async ensureClipExists(
    trackId: number,
    clipSlot: number,
    lengthBeats: number,
  ): Promise<void> {
    try {
      await this.transport.send('live.get_clip', { track_id: trackId, clip_slot: clipSlot });
    } catch (error) {
      if (error instanceof BridgeError && error.code === 'CLIP_NOT_FOUND') {
        // The clip was deleted since the snapshot; recreate it before writing.
        await this.transport.send('live.create_midi_clip', {
          track_id: trackId,
          clip_slot: clipSlot,
          length_beats: lengthBeats || 4,
        });
        return;
      }
      throw error;
    }
  }

  // -- composite commands -------------------------------------------------

  /**
   * Copy a clip's notes and loop settings into another slot.
   *
   * Live's duplicate_clip_slot always inserts directly after the source, so
   * it cannot honour an arbitrary target. Composing the copy from primitives
   * gives the agent the slot it actually asked for.
   */
  async duplicateClip(args: {
    track_id: number;
    clip_slot: number;
    target_slot: number;
    target_track_id?: number;
    replace_existing?: boolean;
  }): Promise<Record<string, unknown>> {
    const targetTrack = args.target_track_id ?? args.track_id;
    const clip = (await this.transport.send('live.get_clip', {
      track_id: args.track_id,
      clip_slot: args.clip_slot,
    })) as Record<string, unknown>;

    if (!clip.is_midi_clip) {
      throw new BridgeError(
        'UNSUPPORTED',
        'Only MIDI clips can be duplicated by the bridge; audio clip copying is not supported.',
      );
    }

    const { notes } = (await this.transport.send('live.get_notes', {
      track_id: args.track_id,
      clip_slot: args.clip_slot,
    })) as { notes: Note[] };

    await this.transport.send('live.create_midi_clip', {
      track_id: targetTrack,
      clip_slot: args.target_slot,
      length_beats: Number(clip.length_beats) || 4,
      replace_existing: args.replace_existing ?? false,
      ...(clip.name ? { name: String(clip.name) } : {}),
    });

    if (notes.length > 0) {
      await this.transport.send('live.add_notes', {
        track_id: targetTrack,
        clip_slot: args.target_slot,
        notes: notes.map(stripNoteId),
      });
    }

    await this.transport.send('live.set_clip_loop', {
      track_id: targetTrack,
      clip_slot: args.target_slot,
      start: Number(clip.loop_start) || 0,
      end: Number(clip.loop_end) || Number(clip.length_beats) || 4,
      looping: Boolean(clip.looping),
    });

    return {
      track_id: targetTrack,
      clip_slot: args.target_slot,
      source_slot: args.clip_slot,
      notes_copied: notes.length,
    };
  }

  // -- transactions -------------------------------------------------------

  /**
   * Run several commands as one logical edit.
   *
   * Live has no real transaction, so `atomic` is implemented by snapshotting
   * every clip the batch names before running it and restoring those clips
   * if a step fails. The response always says exactly how far the batch got -
   * a partially applied edit is reported, never hidden.
   */
  async runTransaction(
    commands: Array<{ command: string; args?: Record<string, unknown> }>,
    options: { atomic?: boolean; dryRun?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (commands.length === 0) {
      throw new BridgeError('VALIDATION_FAILED', 'A transaction needs at least one command.');
    }
    if (commands.length > 256) {
      throw new BridgeError(
        'VALIDATION_FAILED',
        `A transaction may hold at most 256 commands (got ${commands.length}).`,
      );
    }

    // Validate the whole batch up front so an invalid step never runs after a
    // valid one has already changed the Set.
    const validated = commands.map((entry, index) => {
      if (entry.command === 'transaction') {
        throw new BridgeError('VALIDATION_FAILED', 'Transactions cannot be nested.', { index });
      }
      if (!isKnownCommand(entry.command)) {
        throw new BridgeError(
          'UNKNOWN_COMMAND',
          `transaction.commands[${index}]: no such command '${entry.command}'.`,
          { index },
        );
      }
      return {
        command: entry.command as CommandName,
        args: validateArgs(entry.command as CommandName, entry.args ?? {}),
        index,
      };
    });

    if (options.dryRun) {
      return {
        dry_run: true,
        applied: false,
        operations: validated.map((v) => ({ command: v.command, args: v.args })),
      };
    }

    const rollbackSnapshots: ClipSnapshot[] = [];
    if (options.atomic) {
      for (const target of clipTargets(validated)) {
        try {
          rollbackSnapshots.push(
            await this.snapshotClip(target.track_id, target.clip_slot, 'transaction rollback'),
          );
        } catch {
          // A slot that holds no clip yet has nothing to roll back to; a
          // failure there leaves the slot empty, which is the prior state.
        }
      }
    }

    const results: unknown[] = [];
    for (const step of validated) {
      try {
        results.push(await this.transport.send(step.command, step.args));
      } catch (error) {
        const payload = error instanceof BridgeError ? error.toPayload() : { message: String(error) };
        let rolledBack = false;
        if (options.atomic && rollbackSnapshots.length > 0) {
          rolledBack = true;
          for (const snapshot of rollbackSnapshots) {
            try {
              await this.restoreClip(snapshot.snapshot_id);
            } catch (restoreError) {
              rolledBack = false;
              this.log.info(
                `rollback of snapshot ${snapshot.snapshot_id} failed: ${String(restoreError)}`,
              );
            }
          }
        }
        throw new BridgeError(
          'TRANSACTION_FAILED',
          `Transaction failed at command ${step.index} (${step.command}).` +
            (options.atomic
              ? rolledBack
                ? ' The affected clips were rolled back.'
                : ' Rollback did not fully succeed - inspect the Set.'
              : ` Commands 0-${step.index - 1} were applied and remain in effect.`),
          {
            failed_index: step.index,
            failed_command: step.command,
            commands_applied: step.index,
            rolled_back: options.atomic ? rolledBack : false,
            cause: payload,
            results,
          },
        );
      }
    }

    return { applied: true, command_count: validated.length, results };
  }
}

function stripNoteId(note: Note): Omit<Note, 'note_id'> {
  const { note_id: _ignored, ...rest } = note;
  return rest;
}

/** The distinct (track, slot) pairs a batch of commands writes to. */
function clipTargets(
  steps: Array<{ command: CommandName; args: Record<string, unknown> }>,
): Array<{ track_id: number; clip_slot: number }> {
  const seen = new Map<string, { track_id: number; clip_slot: number }>();
  for (const step of steps) {
    const trackId = step.args.track_id;
    const clipSlot = step.args.clip_slot;
    if (typeof trackId !== 'number' || typeof clipSlot !== 'number') continue;
    if (!MUTATES_CLIP_CONTENT.has(step.command)) continue;
    seen.set(`${trackId}:${clipSlot}`, { track_id: trackId, clip_slot: clipSlot });
  }
  return [...seen.values()];
}

const MUTATES_CLIP_CONTENT = new Set<string>([
  'live.add_notes',
  'live.replace_notes',
  'live.remove_notes',
  'live.update_notes',
  'live.delete_clip',
  'live.set_clip_loop',
  'live.set_clip_name',
  'live.set_automation',
  'live.clear_automation',
]);
