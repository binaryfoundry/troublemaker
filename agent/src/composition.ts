/**
 * Composition operations: higher-level musical moves expressed as ordinary
 * primitive commands.
 *
 * Nothing here is a new bridge capability. Each function returns a list of
 * {command, args} the agent can hand to `transaction`, which keeps the Live
 * side free of musical opinion and makes every operation inspectable with
 * dry_run before it touches the Set.
 */

import {
  FOUR_FOUR,
  barToBeat,
  barsToBeats,
  seedFrom,
  type TimeSignature,
} from './music-theory.js';
import {
  DRUMS,
  backbeatSnare,
  chordProgression,
  fourOnTheFloorKick,
  mergePatterns,
  offbeatHat,
  repeatPattern,
  rollingBass,
  sixteenthHats,
  snareRoll,
  toNotes,
  type Pattern,
} from './patterns.js';
import type { Note } from '../../bridge/src/protocol.js';
import { drumPattern, type DrumOptions } from './drums.js';

export interface Command {
  command: string;
  args: Record<string, unknown>;
}

export interface ClipTarget {
  track_id: number;
  clip_slot: number;
}

export interface WriteOptions extends ClipTarget {
  bars: number;
  signature?: TimeSignature;
  name?: string;
  /** Create the clip if the slot is empty, and resize it to `bars`. */
  createClip?: boolean;
  /** Add to what is already in the clip rather than replacing it. */
  additive?: boolean;
}

/**
 * The command sequence that puts a pattern into a clip.
 *
 * Always: snapshot (so the edit is reversible), create/resize, then write.
 */
export function writePattern(pattern: Pattern, options: WriteOptions): Command[] {
  const signature = options.signature ?? FOUR_FOUR;
  const lengthBeats = barsToBeats(options.bars, signature);
  const commands: Command[] = [];

  if (options.createClip) {
    commands.push({
      command: 'live.create_midi_clip',
      args: {
        track_id: options.track_id,
        clip_slot: options.clip_slot,
        length_beats: lengthBeats,
        replace_existing: true,
        ...(options.name ? { name: options.name } : {}),
      },
    });
  }

  commands.push({
    command: options.additive ? 'live.add_notes' : 'live.replace_notes',
    args: {
      track_id: options.track_id,
      clip_slot: options.clip_slot,
      notes: toNotes(pattern),
    },
  });

  commands.push({
    command: 'live.set_clip_loop',
    args: {
      track_id: options.track_id,
      clip_slot: options.clip_slot,
      start: 0,
      length: lengthBeats,
      looping: true,
    },
  });

  return commands;
}

// ---------------------------------------------------------------------------
// Part generators
// ---------------------------------------------------------------------------

export interface GrooveOptions {
  bars?: number;
  signature?: TimeSignature;
  seed?: number;
}

export function createFourOnFloorKick(target: ClipTarget, options: GrooveOptions = {}): Command[] {
  const bars = options.bars ?? 1;
  return writePattern(fourOnTheFloorKick({ bars, signature: options.signature, seed: options.seed }), {
    ...target,
    bars,
    signature: options.signature,
    createClip: true,
    name: 'Kick',
  });
}

export function createOffbeatHat(target: ClipTarget, options: GrooveOptions = {}): Command[] {
  const bars = options.bars ?? 1;
  return writePattern(offbeatHat({ bars, signature: options.signature, seed: options.seed }), {
    ...target,
    bars,
    signature: options.signature,
    createClip: true,
    name: 'Hats',
  });
}

/** Kick, offbeat hats, sixteenth top and a clap on 2 and 4, in one clip. */
export function createTechnoDrumKit(
  target: ClipTarget,
  options: GrooveOptions = {},
): Command[] {
  const bars = options.bars ?? 4;
  const seed = options.seed ?? seedFrom('techno-kit');
  const fourFour = !options.signature || (options.signature.numerator === 4 && options.signature.denominator === 4);
  if (fourFour) {
    // DRUMS.md's driven 909 grid: ghost kick, ghost snare, accented hats, open hats that own their steps.
    return writePattern(drumPattern('techno', { bars, seed }), { ...target, bars, createClip: true, name: 'Drums' });
  }
  const pattern = mergePatterns(
    fourOnTheFloorKick({ bars, signature: options.signature, seed }),
    offbeatHat({ bars, signature: options.signature, seed: seed + 1, open: true }),
    sixteenthHats({ bars, signature: options.signature, seed: seed + 2 }),
    backbeatSnare({ bars, signature: options.signature, seed: seed + 3 }),
  );
  return writePattern(pattern, {
    ...target,
    bars,
    signature: options.signature,
    createClip: true,
    name: 'Drums',
  });
}

/** A DRUMS.md genre pattern (house, techno, hiphop, trap, electro) written into a clip. */
export function createDrumPattern(target: ClipTarget, genre: string, options: DrumOptions = {}): Command[] {
  const pattern = drumPattern(genre, options);
  return writePattern(pattern, { ...target, bars: pattern.length_beats / 4, createClip: true, name: `Drums ${genre}` });
}

export interface BasslineOptions extends GrooveOptions {
  root: string | number;
  scale?: string;
  lowPitch?: number;
  density?: number;
}

export function createRollingBass(target: ClipTarget, options: BasslineOptions): Command[] {
  const bars = options.bars ?? 4;
  const pattern = rollingBass({
    bars,
    signature: options.signature,
    seed: options.seed ?? seedFrom('bass'),
    root: options.root,
    scale: options.scale ?? 'minor',
    lowPitch: options.lowPitch ?? 36,
    density: options.density ?? 0.75,
  });
  return writePattern(pattern, {
    ...target,
    bars,
    signature: options.signature,
    createClip: true,
    name: 'Bass',
  });
}

export interface ChordOptions extends GrooveOptions {
  root: string | number;
  scale?: string;
  degrees?: number[];
  barsPerChord?: number;
  octave?: number;
}

export function createChordProgression(target: ClipTarget, options: ChordOptions): Command[] {
  const degrees = options.degrees ?? [1, 6, 3, 7];
  const barsPerChord = options.barsPerChord ?? 1;
  const pattern = chordProgression({
    root: options.root,
    scale: options.scale ?? 'minor',
    degrees,
    barsPerChord,
    octave: options.octave ?? 3,
    signature: options.signature,
    seed: options.seed ?? seedFrom('chords'),
  });
  return writePattern(pattern, {
    ...target,
    bars: degrees.length * barsPerChord,
    signature: options.signature,
    createClip: true,
    name: 'Chords',
  });
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface BuildUpOptions {
  bars?: number;
  signature?: TimeSignature;
  seed?: number;
  /** Drop the kick for the last half bar, the classic pre-drop gap. */
  dropKickBeforeEnd?: boolean;
}

/**
 * A build-up: an accelerating roll with rising velocity, optionally clearing
 * the kick just before the end so the drop lands into silence.
 */
export function createBuildUp(target: ClipTarget, options: BuildUpOptions = {}): Command[] {
  const bars = options.bars ?? 4;
  const signature = options.signature ?? FOUR_FOUR;
  const lengthBeats = barsToBeats(bars, signature);

  const roll = snareRoll({ bars, signature, seed: options.seed ?? seedFrom('build') });
  const kick = fourOnTheFloorKick({ bars, signature, seed: options.seed ?? 7 });

  // Thin the kick out of the final half bar so the build has somewhere to go.
  const gapStart = options.dropKickBeforeEnd === false ? lengthBeats : lengthBeats - 2;
  const kickEvents = kick.events.filter((event) => event.beat < gapStart);

  const pattern: Pattern = {
    length_beats: lengthBeats,
    events: [...kickEvents, ...roll.events],
  };

  return writePattern(pattern, {
    ...target,
    bars,
    signature,
    createClip: true,
    name: `Build ${bars} bars`,
  });
}

/**
 * Open a filter across a span of bars.
 *
 * Bars are 1-based as the user speaks them; the automation points are in
 * 0-based beats as Live stores them.
 */
export function openFilterOverBars(
  target: ClipTarget,
  deviceId: number,
  options: {
    parameterName?: string;
    fromBar: number;
    toBar: number;
    fromNormalized?: number;
    toNormalized?: number;
    signature?: TimeSignature;
  },
): Command[] {
  const signature = options.signature ?? FOUR_FOUR;
  if (options.toBar <= options.fromBar) {
    throw new RangeError('toBar must be greater than fromBar.');
  }
  return [
    {
      command: 'live.set_automation',
      args: {
        track_id: target.track_id,
        clip_slot: target.clip_slot,
        device_id: deviceId,
        parameter_name: options.parameterName ?? 'Frequency',
        points: [
          {
            beat: barToBeat(options.fromBar, signature),
            normalized: options.fromNormalized ?? 0.2,
          },
          {
            beat: barToBeat(options.toBar, signature),
            normalized: options.toNormalized ?? 0.9,
          },
        ],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

export interface Section {
  name: string;
  start_bar: number;
  length_bars: number;
  /** 0 = quietest, 1 = full. Drives which parts play. */
  energy: number;
}

/**
 * A conventional structure for a loop-based track.
 *
 * This is an abstract plan, not a set of edits: the agent decides how to
 * realise each section against the parts the project actually has.
 */
export function defaultArrangement(totalBars: number): Section[] {
  if (totalBars < 8) throw new RangeError('An arrangement needs at least 8 bars.');
  const unit = Math.max(1, Math.floor(totalBars / 4));
  return [
    { name: 'Intro', start_bar: 1, length_bars: unit, energy: 0.25 },
    { name: 'Groove', start_bar: 1 + unit, length_bars: unit, energy: 0.6 },
    { name: 'Breakdown', start_bar: 1 + unit * 2, length_bars: unit, energy: 0.35 },
    {
      name: 'Drop',
      start_bar: 1 + unit * 3,
      length_bars: totalBars - unit * 3,
      energy: 1,
    },
  ];
}

/** Which roles should sound at a given energy level. */
export function partsForEnergy(energy: number): string[] {
  const parts: string[] = [];
  if (energy >= 0.2) parts.push('hats');
  if (energy >= 0.3) parts.push('atmosphere');
  if (energy >= 0.45) parts.push('kick');
  if (energy >= 0.55) parts.push('bass');
  if (energy >= 0.7) parts.push('chords');
  if (energy >= 0.85) parts.push('lead', 'clap');
  return parts;
}

/**
 * Guess what a track is for from its name.
 *
 * A weak inference, so the result carries its own confidence and the agent is
 * expected to confirm anything it acts on destructively.
 */
export function inferTrackRole(name: string): { role: string; confidence: number } {
  const text = name.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    // Plurals count: real tracks are called "Hats" and "Chords".
    [/\b(kicks?|bd|bass ?drums?)\b/, 'kick'],
    [/\b(snares?|claps?|rims?|sd)\b/, 'snare'],
    [/\b(hats?|hh|cymbals?|rides?)\b/, 'hats'],
    [/\b(percs?|percussion|shakers?|toms?|congas?|bongos?|tops?)\b/, 'perc'],
    [/\b(sub|bass|basses|808s?|reese)\b/, 'bass'],
    [/\b(counter|counters|counter ?motif|answer)\b/, 'counter'],
    [/\b(leads?|arps?|melody|melodies|hooks?|top ?lines?)\b/, 'lead'],
    [/\b(chords?|pads?|keys|stabs?|rhodes|piano)\b/, 'chords'],
    [/\b(fx|risers?|sweeps?|impacts?|noise|atmos|ambient|textures?)\b/, 'atmosphere'],
    [/\b(vox|vocals?|voices?)\b/, 'vocal'],
  ];
  for (const [pattern, role] of rules) {
    if (pattern.test(text)) return { role, confidence: 0.8 };
  }
  return { role: 'unknown', confidence: 0 };
}

/** Pitch-range heuristic, used to corroborate or correct a name guess. */
export function inferRoleFromNotes(notes: Note[]): { role: string; confidence: number } {
  if (notes.length === 0) return { role: 'unknown', confidence: 0 };
  const pitches = notes.map((note) => note.pitch);
  const low = Math.min(...pitches);
  const high = Math.max(...pitches);
  const distinct = new Set(pitches).size;

  // A handful of distinct pitches inside the GM drum range is a kit, not a part.
  if (low >= 35 && high <= 59 && distinct <= 8) return { role: 'drums', confidence: 0.6 };
  if (high <= 52) return { role: 'bass', confidence: 0.5 };
  if (low >= 60) return { role: 'lead', confidence: 0.4 };
  if (distinct >= 3 && notes.some((note) => note.duration >= 2)) {
    return { role: 'chords', confidence: 0.4 };
  }
  return { role: 'unknown', confidence: 0 };
}

/** Repeat a clip's material across more bars, for "turn 8 bars into 32". */
export function extendClip(
  target: ClipTarget,
  notes: Note[],
  options: { fromBars: number; toBars: number; signature?: TimeSignature },
): Command[] {
  const signature = options.signature ?? FOUR_FOUR;
  const sourceBeats = barsToBeats(options.fromBars, signature);
  const targetBeats = barsToBeats(options.toBars, signature);
  if (targetBeats <= sourceBeats) {
    throw new RangeError('toBars must be greater than fromBars.');
  }
  const source: Pattern = {
    length_beats: sourceBeats,
    events: notes.map((note) => ({
      beat: note.start,
      pitch: note.pitch,
      duration: note.duration,
      velocity: note.velocity,
    })),
  };
  const extended = repeatPattern(source, targetBeats);
  return writePattern(extended, { ...target, bars: options.toBars, signature });
}

export { DRUMS };
