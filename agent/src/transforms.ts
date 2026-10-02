/**
 * Transformations of material that already exists in a clip.
 *
 * This is where "make it more syncopated" and "make the drums less busy"
 * actually live. Every function takes the notes read back from Live and
 * returns an EditPlan - a diff - rather than a replacement pattern, because
 * the whole point is that the part stays recognisably itself: the same
 * pitches, in the same order, with the rhythm or dynamics moved.
 *
 * Nothing here talks to Live. The agent applies an EditPlan with
 * live.update_notes / live.add_notes / live.remove_notes.
 */

import {
  FOUR_FOUR,
  beatsPerBar,
  clampVelocity,
  makeRandom,
  round6,
  snapToScale,
  type TimeSignature,
} from './music-theory.js';
import type { Note, NoteUpdate } from '../../bridge/src/protocol.js';

export interface EditPlan {
  updates: NoteUpdate[];
  additions: Note[];
  /** note_ids to delete. */
  removals: number[];
  /** Human-readable lines for the agent's report back to the user. */
  summary: string[];
}

export const EMPTY_PLAN: EditPlan = { updates: [], additions: [], removals: [], summary: [] };

export interface TransformContext {
  lengthBeats: number;
  signature?: TimeSignature;
  seed?: number;
  /** Leave the first and last bar untouched so the loop still joins up. */
  preserveEdges?: boolean;
}

function ctx(context: TransformContext) {
  const signature = context.signature ?? FOUR_FOUR;
  return {
    signature,
    perBar: beatsPerBar(signature),
    random: makeRandom(context.seed ?? 1),
    lengthBeats: context.lengthBeats,
    preserveEdges: context.preserveEdges ?? false,
  };
}

function requireIds(notes: Note[], operation: string): void {
  if (notes.some((note) => typeof note.note_id !== 'number')) {
    throw new Error(
      `${operation} needs note ids. Read the clip with live.get_notes against Live 11 ` +
        'or newer, or rewrite the clip with live.replace_notes instead.',
    );
  }
}

function sortedByStart(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** The next note at the same pitch, used to avoid writing overlaps. */
function nextAtPitch(notes: Note[], note: Note): Note | undefined {
  return sortedByStart(notes).find((other) => other.pitch === note.pitch && other.start > note.start);
}

function inProtectedEdge(note: Note, c: ReturnType<typeof ctx>): boolean {
  if (!c.preserveEdges) return false;
  return note.start < c.perBar || note.start >= c.lengthBeats - c.perBar;
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

export interface SyncopationOptions extends TransformContext {
  /** 0 = nothing moves, 1 = every eligible note moves. */
  amount?: number;
  /** Grid to push notes onto. 0.25 is a sixteenth. */
  grid?: number;
  /** Shorten displaced notes so the syncopation reads clearly. */
  shorten?: boolean;
}

/**
 * Push on-grid notes onto the following subdivision.
 *
 * Only notes that currently sit squarely on a beat or an eighth are
 * candidates - moving already-syncopated notes would just smear the rhythm.
 * Pitches are never touched, so the melody survives intact.
 */
export function makeMoreSyncopated(notes: Note[], options: SyncopationOptions): EditPlan {
  requireIds(notes, 'makeMoreSyncopated');
  const c = ctx(options);
  const amount = Math.min(1, Math.max(0, options.amount ?? 0.4));
  const grid = options.grid ?? 0.25;
  const shorten = options.shorten ?? true;

  const updates: NoteUpdate[] = [];
  let moved = 0;
  let shortened = 0;

  for (const note of sortedByStart(notes)) {
    if (inProtectedEdge(note, c)) continue;
    const onEighth = Math.abs(note.start / (grid * 2) - Math.round(note.start / (grid * 2))) < 1e-6;
    if (!onEighth) continue;
    if (c.random() > amount) continue;

    const target = round6(note.start + grid);
    if (target >= c.lengthBeats) continue;

    // Never let the shift run into the next note of the same pitch.
    const next = nextAtPitch(notes, note);
    const ceiling = next ? next.start : c.lengthBeats;
    if (target >= ceiling) continue;

    const update: NoteUpdate = { note_id: note.note_id as number, start: target };
    const maxDuration = round6(ceiling - target);
    if (shorten) {
      const wanted = Math.min(note.duration * 0.6, maxDuration);
      if (wanted > 0 && wanted < note.duration) {
        update.duration = round6(Math.max(grid / 2, wanted));
        shortened += 1;
      }
    } else if (note.duration > maxDuration && maxDuration > 0) {
      update.duration = maxDuration;
    }
    updates.push(update);
    moved += 1;
  }

  const summary: string[] = [];
  if (moved > 0) {
    summary.push(`shifted ${moved} note${moved === 1 ? '' : 's'} onto off-grid subdivisions`);
    if (shortened > 0) summary.push(`shortened ${shortened} of them`);
    summary.push('kept every pitch and the order they occur in');
  }
  return { updates, additions: [], removals: [], summary };
}

/** The inverse: pull notes back onto the grid. */
export function straighten(
  notes: Note[],
  options: TransformContext & { grid?: number; strength?: number },
): EditPlan {
  requireIds(notes, 'straighten');
  const c = ctx(options);
  const grid = options.grid ?? 0.25;
  const strength = Math.min(1, Math.max(0, options.strength ?? 1));
  const updates: NoteUpdate[] = [];

  for (const note of notes) {
    if (inProtectedEdge(note, c)) continue;
    const snapped = Math.round(note.start / grid) * grid;
    const target = round6(note.start + (snapped - note.start) * strength);
    if (Math.abs(target - note.start) > 1e-6) {
      updates.push({ note_id: note.note_id as number, start: target });
    }
  }
  return {
    updates,
    additions: [],
    removals: [],
    summary: updates.length ? [`quantized ${updates.length} notes to a ${grid}-beat grid`] : [],
  };
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

/**
 * Thin a part out.
 *
 * Notes are ranked by how structurally important they are - downbeats and
 * loud notes stay, quiet off-grid notes go first - so "less busy" does not
 * become "randomly broken".
 */
export function reduceDensity(
  notes: Note[],
  options: TransformContext & { amount?: number },
): EditPlan {
  requireIds(notes, 'reduceDensity');
  const c = ctx(options);
  const amount = Math.min(0.9, Math.max(0, options.amount ?? 0.3));
  const candidates = notes.filter((note) => !inProtectedEdge(note, c));
  const target = Math.floor(candidates.length * amount);
  if (target === 0) return { ...EMPTY_PLAN, summary: [] };

  const ranked = candidates
    .map((note) => ({ note, score: structuralImportance(note, c.perBar) }))
    .sort((a, b) => a.score - b.score || a.note.start - b.note.start);

  const removals = ranked.slice(0, target).map((entry) => entry.note.note_id as number);
  return {
    updates: [],
    additions: [],
    removals,
    summary: [
      `removed ${removals.length} of the least structural notes`,
      'kept the downbeats and the loudest hits',
    ],
  };
}

/** Higher means "more important to the groove". */
function structuralImportance(note: Note, perBar: number): number {
  const positionInBar = note.start % perBar;
  let score = note.velocity / 127;
  if (Math.abs(positionInBar) < 1e-6) score += 3; // bar downbeat
  else if (Math.abs(positionInBar % 1) < 1e-6) score += 2; // beat
  else if (Math.abs(positionInBar % 0.5) < 1e-6) score += 1; // eighth
  return score;
}

/**
 * Fill gaps with echoes of the surrounding notes.
 *
 * New notes copy the pitch of the note they follow and sit quieter, which
 * reads as the same part playing busier rather than as a new part.
 */
export function increaseDensity(
  notes: Note[],
  options: TransformContext & { amount?: number; grid?: number },
): EditPlan {
  const c = ctx(options);
  const amount = Math.min(1, Math.max(0, options.amount ?? 0.3));
  const grid = options.grid ?? 0.25;
  const ordered = sortedByStart(notes);
  const occupied = new Set(ordered.map((note) => `${note.pitch}:${round6(note.start)}`));

  const additions: Note[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const note = ordered[index]!;
    if (inProtectedEdge(note, c)) continue;
    if (c.random() > amount) continue;

    const slot = round6(note.start + grid);
    const next = ordered[index + 1];
    if (slot >= c.lengthBeats) continue;
    if (next && slot >= next.start - 1e-6) continue;
    if (occupied.has(`${note.pitch}:${slot}`)) continue;

    occupied.add(`${note.pitch}:${slot}`);
    additions.push({
      pitch: note.pitch,
      start: slot,
      duration: round6(Math.min(note.duration, grid * 0.8)),
      velocity: clampVelocity(note.velocity * 0.72),
    });
  }
  return {
    updates: [],
    additions,
    removals: [],
    summary: additions.length
      ? [`added ${additions.length} quieter echo notes between existing hits`]
      : [],
  };
}

// ---------------------------------------------------------------------------
// Dynamics and feel
// ---------------------------------------------------------------------------

export function humanizeVelocity(
  notes: Note[],
  options: TransformContext & { spread?: number; accentDownbeats?: boolean },
): EditPlan {
  requireIds(notes, 'humanizeVelocity');
  const c = ctx(options);
  const spread = options.spread ?? 12;
  const accent = options.accentDownbeats ?? true;

  const updates: NoteUpdate[] = [];
  let low = 127;
  let high = 1;
  for (const note of sortedByStart(notes)) {
    const jitter = (c.random() * 2 - 1) * spread;
    const bonus = accent && Math.abs(note.start % c.perBar) < 1e-6 ? spread * 0.6 : 0;
    const velocity = clampVelocity(note.velocity + jitter + bonus);
    if (velocity !== Math.round(note.velocity)) {
      updates.push({ note_id: note.note_id as number, velocity });
    }
    low = Math.min(low, velocity);
    high = Math.max(high, velocity);
  }
  return {
    updates,
    additions: [],
    removals: [],
    summary: updates.length ? [`varied velocity across ${low}-${high}`] : [],
  };
}

export function humanizeTiming(
  notes: Note[],
  options: TransformContext & { maxShiftBeats?: number },
): EditPlan {
  requireIds(notes, 'humanizeTiming');
  const c = ctx(options);
  const maxShift = options.maxShiftBeats ?? 0.015;

  const updates: NoteUpdate[] = [];
  for (const note of sortedByStart(notes)) {
    if (inProtectedEdge(note, c)) continue;
    const shift = (c.random() * 2 - 1) * maxShift;
    const start = round6(Math.max(0, Math.min(c.lengthBeats - 1e-6, note.start + shift)));
    if (Math.abs(start - note.start) > 1e-6) {
      updates.push({ note_id: note.note_id as number, start });
    }
  }
  return {
    updates,
    additions: [],
    removals: [],
    summary: updates.length
      ? [`nudged ${updates.length} notes by up to ${(maxShift * 1000).toFixed(0)}/1000 of a beat`]
      : [],
  };
}

/** Swing: delay every second subdivision. 0.5 is straight, 0.66 is triplet feel. */
export function applySwing(
  notes: Note[],
  options: TransformContext & { amount?: number; grid?: number },
): EditPlan {
  requireIds(notes, 'applySwing');
  const c = ctx(options);
  const amount = Math.min(0.75, Math.max(0.5, options.amount ?? 0.58));
  const grid = options.grid ?? 0.25;
  const offset = (amount - 0.5) * 2 * grid;

  const updates: NoteUpdate[] = [];
  for (const note of sortedByStart(notes)) {
    const index = Math.round(note.start / grid);
    if (Math.abs(note.start - index * grid) > 1e-6) continue;
    if (index % 2 === 0) continue;
    const start = round6(note.start + offset);
    if (start < c.lengthBeats) {
      updates.push({ note_id: note.note_id as number, start });
    }
  }
  return {
    updates,
    additions: [],
    removals: [],
    summary: updates.length ? [`swung ${updates.length} offbeat notes`] : [],
  };
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

export function transpose(notes: Note[], semitones: number): EditPlan {
  requireIds(notes, 'transpose');
  if (!Number.isInteger(semitones)) throw new RangeError('Transpose by whole semitones.');

  const updates: NoteUpdate[] = [];
  const dropped: number[] = [];
  for (const note of notes) {
    const pitch = note.pitch + semitones;
    if (pitch < 0 || pitch > 127) {
      dropped.push(note.pitch);
      continue;
    }
    updates.push({ note_id: note.note_id as number, pitch });
  }
  const summary = [`transposed ${updates.length} notes by ${semitones} semitones`];
  if (dropped.length) {
    summary.push(`left ${dropped.length} notes alone - transposing them would leave MIDI range`);
  }
  return { updates, additions: [], removals: [], summary };
}

/** Move every note to the nearest pitch in a key, leaving rhythm alone. */
export function conformToKey(
  notes: Note[],
  root: string | number,
  scale: string,
): EditPlan {
  requireIds(notes, 'conformToKey');
  const updates: NoteUpdate[] = [];
  for (const note of notes) {
    const pitch = snapToScale(note.pitch, root, scale);
    if (pitch !== note.pitch) updates.push({ note_id: note.note_id as number, pitch });
  }
  return {
    updates,
    additions: [],
    removals: [],
    summary: updates.length
      ? [`moved ${updates.length} out-of-key notes to the nearest ${scale} tone`]
      : ['every note was already in key'],
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * Introduce a difference every Nth bar so a long loop stops feeling static.
 *
 * The variation is drawn from what is already there: the last bar's notes get
 * nudged, dropped or accented rather than replaced with new material.
 */
export function varyEveryNthBar(
  notes: Note[],
  options: TransformContext & { everyBars?: number; intensity?: number },
): EditPlan {
  requireIds(notes, 'varyEveryNthBar');
  const c = ctx(options);
  const everyBars = options.everyBars ?? 4;
  const intensity = Math.min(1, Math.max(0, options.intensity ?? 0.4));
  if (everyBars < 1) throw new RangeError('everyBars must be >= 1.');

  const updates: NoteUpdate[] = [];
  const removals: number[] = [];
  const varied = new Set<number>();

  for (const note of sortedByStart(notes)) {
    const bar = Math.floor(note.start / c.perBar) + 1;
    if (bar % everyBars !== 0) continue;
    // Only the second half of the bar changes, so the bar still starts the same.
    if (note.start % c.perBar < c.perBar / 2) continue;

    const roll = c.random();
    if (roll < intensity * 0.35) {
      removals.push(note.note_id as number);
      varied.add(bar);
    } else if (roll < intensity * 0.7) {
      updates.push({
        note_id: note.note_id as number,
        velocity: clampVelocity(note.velocity * 1.18),
      });
      varied.add(bar);
    } else if (roll < intensity) {
      const start = round6(note.start + 0.25);
      if (start < c.lengthBeats) {
        updates.push({ note_id: note.note_id as number, start });
        varied.add(bar);
      }
    }
  }
  return {
    updates,
    additions: [],
    removals,
    summary: varied.size
      ? [`varied the back half of bar${varied.size === 1 ? '' : 's'} ${[...varied].join(', ')}`]
      : [],
  };
}

/** Combine plans, keeping at most one update per note. */
export function mergePlans(...plans: EditPlan[]): EditPlan {
  const updates = new Map<number, NoteUpdate>();
  const removals = new Set<number>();
  const additions: Note[] = [];
  const summary: string[] = [];

  for (const plan of plans) {
    for (const update of plan.updates) {
      updates.set(update.note_id, { ...updates.get(update.note_id), ...update });
    }
    for (const id of plan.removals) removals.add(id);
    additions.push(...plan.additions);
    summary.push(...plan.summary);
  }
  // A removed note must not also be updated.
  for (const id of removals) updates.delete(id);

  return { updates: [...updates.values()], additions, removals: [...removals], summary };
}

/** Turn a plan into the bridge commands that apply it, in a safe order. */
export function planToCommands(
  trackId: number,
  clipSlot: number,
  plan: EditPlan,
): Array<{ command: string; args: Record<string, unknown> }> {
  const commands: Array<{ command: string; args: Record<string, unknown> }> = [];
  // Remove first: it frees up the time slots that additions may want.
  if (plan.removals.length > 0) {
    commands.push({
      command: 'live.remove_notes',
      args: { track_id: trackId, clip_slot: clipSlot, note_ids: plan.removals },
    });
  }
  if (plan.updates.length > 0) {
    commands.push({
      command: 'live.update_notes',
      args: { track_id: trackId, clip_slot: clipSlot, updates: plan.updates },
    });
  }
  if (plan.additions.length > 0) {
    commands.push({
      command: 'live.add_notes',
      args: { track_id: trackId, clip_slot: clipSlot, notes: plan.additions },
    });
  }
  return commands;
}

/** Does the edit still look like the same part? Used to verify a write. */
export function compareMaterial(
  before: Note[],
  after: Note[],
): {
  pitchSequencePreserved: boolean;
  noteCountDelta: number;
  noteCountRatio: number;
  offGridNotes: number;
} {
  const pitchesBefore = sortedByStart(before).map((n) => n.pitch);
  const pitchesAfter = sortedByStart(after).map((n) => n.pitch);
  const offGrid = after.filter((n) => Math.abs(n.start % 0.5) > 1e-6).length;
  return {
    pitchSequencePreserved:
      pitchesBefore.length === pitchesAfter.length &&
      pitchesBefore.every((pitch, index) => pitch === pitchesAfter[index]),
    noteCountDelta: after.length - before.length,
    noteCountRatio: before.length === 0 ? 1 : after.length / before.length,
    offGridNotes: offGrid,
  };
}
