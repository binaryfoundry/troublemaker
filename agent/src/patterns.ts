/**
 * Pattern generation.
 *
 * A Pattern is a length in beats plus a list of events. It is deliberately
 * independent of Ableton: generate here, translate to note commands at the
 * edge. That makes every generator unit-testable without Live running.
 */

import {
  FOUR_FOUR,
  barsToBeats,
  clampVelocity,
  diatonicChord,
  makeRandom,
  round6,
  scalePitches,
  snapToScale,
  type TimeSignature,
} from './music-theory.js';
import type { Note } from '../../bridge/src/protocol.js';

export interface PatternEvent {
  beat: number;
  pitch: number;
  duration: number;
  velocity: number;
  probability?: number;
}

export interface Pattern {
  length_beats: number;
  events: PatternEvent[];
}

export interface GeneratorOptions {
  bars?: number;
  signature?: TimeSignature;
  seed?: number;
}

/** General MIDI drum map positions, which Live's own kits follow. */
export const DRUMS = {
  kick: 36,
  snare: 38,
  clap: 39,
  closedHat: 42,
  openHat: 46,
  ride: 51,
  rimshot: 37,
  tom: 45,
  shaker: 70,
  crash: 49,
} as const;

export function toNotes(pattern: Pattern): Note[] {
  return pattern.events
    .slice()
    .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
    .map((event) => ({
      pitch: event.pitch,
      start: round6(event.beat),
      duration: round6(event.duration),
      velocity: clampVelocity(event.velocity),
      ...(event.probability !== undefined ? { probability: event.probability } : {}),
    }));
}

function resolve(options: GeneratorOptions): {
  bars: number;
  signature: TimeSignature;
  length: number;
  random: () => number;
} {
  const bars = options.bars ?? 1;
  const signature = options.signature ?? FOUR_FOUR;
  return {
    bars,
    signature,
    length: barsToBeats(bars, signature),
    random: makeRandom(options.seed ?? 1),
  };
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

export function fourOnTheFloorKick(options: GeneratorOptions = {}): Pattern {
  const { length, random } = resolve(options);
  const events: PatternEvent[] = [];
  for (let beat = 0; beat < length; beat += 1) {
    // A touch of velocity shaping: downbeats land hardest.
    const isDownbeat = beat % 4 === 0;
    events.push({
      beat,
      pitch: DRUMS.kick,
      duration: 0.25,
      velocity: clampVelocity((isDownbeat ? 122 : 116) + (random() * 4 - 2)),
    });
  }
  return { length_beats: length, events };
}

export function offbeatHat(options: GeneratorOptions & { open?: boolean } = {}): Pattern {
  const { length, random } = resolve(options);
  const pitch = options.open ? DRUMS.openHat : DRUMS.closedHat;
  const events: PatternEvent[] = [];
  for (let beat = 0.5; beat < length; beat += 1) {
    events.push({
      beat,
      pitch,
      duration: 0.25,
      velocity: clampVelocity(96 + (random() * 10 - 5)),
    });
  }
  return { length_beats: length, events };
}

export function sixteenthHats(options: GeneratorOptions = {}): Pattern {
  const { length, random } = resolve(options);
  const events: PatternEvent[] = [];
  let index = 0;
  for (let beat = 0; beat < length; beat += 0.25, index += 1) {
    // Accent the eighths so a straight 16th run still has a pulse.
    const accent = index % 2 === 0 ? 14 : 0;
    events.push({
      beat,
      pitch: DRUMS.closedHat,
      duration: 0.125,
      velocity: clampVelocity(78 + accent + (random() * 8 - 4)),
    });
  }
  return { length_beats: length, events };
}

export function backbeatSnare(
  options: GeneratorOptions & { pitch?: number } = {},
): Pattern {
  const { length, random } = resolve(options);
  const pitch = options.pitch ?? DRUMS.clap;
  const events: PatternEvent[] = [];
  for (let beat = 1; beat < length; beat += 2) {
    events.push({
      beat,
      pitch,
      duration: 0.25,
      velocity: clampVelocity(110 + (random() * 6 - 3)),
    });
  }
  return { length_beats: length, events };
}

/**
 * An accelerating roll into the next downbeat - the standard way to signal
 * that a section is about to change.
 */
export function snareRoll(
  options: GeneratorOptions & { pitch?: number; startDivision?: number; endDivision?: number } = {},
): Pattern {
  const { length } = resolve(options);
  const pitch = options.pitch ?? DRUMS.snare;
  const start = options.startDivision ?? 0.5;
  const end = options.endDivision ?? 0.125;
  const events: PatternEvent[] = [];
  let beat = 0;
  while (beat < length - 1e-9) {
    const progress = beat / length;
    const division = start + (end - start) * progress;
    events.push({
      beat: round6(beat),
      pitch,
      duration: Math.min(division, 0.25),
      velocity: clampVelocity(58 + 62 * progress),
    });
    beat += division;
  }
  return { length_beats: length, events };
}

// ---------------------------------------------------------------------------
// Bass and melody
// ---------------------------------------------------------------------------

export interface BassOptions extends GeneratorOptions {
  root: string | number;
  scale?: string;
  /** Lowest pitch the line may use. */
  lowPitch?: number;
  /** 0 = sparse, 1 = every sixteenth. */
  density?: number;
  octaveJumpChance?: number;
}

/**
 * A rolling 16th bassline: mostly the root, with scale tones and occasional
 * octave jumps for movement. Short notes keep it out of the kick's way.
 */
export function rollingBass(options: BassOptions): Pattern {
  const { length, random } = resolve(options);
  const scale = options.scale ?? 'minor';
  const low = options.lowPitch ?? 36;
  const density = Math.min(1, Math.max(0.1, options.density ?? 0.75));
  const jumpChance = options.octaveJumpChance ?? 0.12;

  const available = scalePitches(options.root, scale, low, low + 12);
  const rootPitch = available[0] ?? low;
  const events: PatternEvent[] = [];

  let index = 0;
  for (let beat = 0; beat < length; beat += 0.25, index += 1) {
    const onBeat = index % 4 === 0;
    // Leave the downbeat to the kick; the bass answers just after it.
    if (onBeat) continue;
    if (random() > density) continue;

    let pitch = rootPitch;
    const roll = random();
    if (roll < jumpChance) {
      pitch = Math.min(127, rootPitch + 12);
    } else if (roll < jumpChance + 0.18) {
      pitch = available[1 + Math.floor(random() * Math.max(1, available.length - 2))] ?? rootPitch;
    }
    events.push({
      beat: round6(beat),
      pitch,
      duration: 0.2,
      velocity: clampVelocity(index % 2 === 0 ? 104 : 92 + random() * 8),
    });
  }
  return { length_beats: length, events };
}

export interface ArpeggioOptions extends GeneratorOptions {
  pitches: number[];
  division?: number;
  direction?: 'up' | 'down' | 'updown';
  gate?: number;
}

export function arpeggio(options: ArpeggioOptions): Pattern {
  const { length, random } = resolve(options);
  const division = options.division ?? 0.25;
  const gate = options.gate ?? 0.9;
  if (options.pitches.length === 0) throw new RangeError('An arpeggio needs at least one pitch.');

  let sequence = [...options.pitches];
  if (options.direction === 'down') sequence.reverse();
  if (options.direction === 'updown' && sequence.length > 2) {
    sequence = [...sequence, ...sequence.slice(1, -1).reverse()];
  }

  const events: PatternEvent[] = [];
  let index = 0;
  for (let beat = 0; beat < length - 1e-9; beat += division, index += 1) {
    events.push({
      beat: round6(beat),
      pitch: sequence[index % sequence.length]!,
      duration: round6(division * gate),
      velocity: clampVelocity(96 + (index % 4 === 0 ? 12 : 0) + (random() * 6 - 3)),
    });
  }
  return { length_beats: length, events };
}

export interface ProgressionOptions extends GeneratorOptions {
  root: string | number;
  scale?: string;
  /** 1-based scale degrees, one per chord. */
  degrees: number[];
  barsPerChord?: number;
  octave?: number;
  size?: number;
}

export function chordProgression(options: ProgressionOptions): Pattern {
  const signature = options.signature ?? FOUR_FOUR;
  const barsPerChord = options.barsPerChord ?? 1;
  const scale = options.scale ?? 'minor';
  const chordLength = barsToBeats(barsPerChord, signature);
  const random = makeRandom(options.seed ?? 1);

  const events: PatternEvent[] = [];
  options.degrees.forEach((degree, index) => {
    const pitches = diatonicChord(options.root, scale, degree, {
      size: options.size ?? 3,
      octave: options.octave ?? 3,
    });
    const beat = index * chordLength;
    for (const pitch of pitches) {
      events.push({
        beat: round6(beat),
        pitch,
        // Stop just short of the next chord so voices do not overlap.
        duration: round6(chordLength * 0.98),
        velocity: clampVelocity(88 + (random() * 8 - 4)),
      });
    }
  });

  return { length_beats: options.degrees.length * chordLength, events };
}

/** Fold a short pattern over a longer span, so a 1-bar idea fills 8 bars. */
export function repeatPattern(pattern: Pattern, totalBeats: number): Pattern {
  if (pattern.length_beats <= 0) throw new RangeError('Pattern length must be > 0.');
  const events: PatternEvent[] = [];
  for (let offset = 0; offset < totalBeats - 1e-9; offset += pattern.length_beats) {
    for (const event of pattern.events) {
      const beat = offset + event.beat;
      if (beat >= totalBeats - 1e-9) continue;
      events.push({ ...event, beat: round6(beat) });
    }
  }
  return { length_beats: totalBeats, events };
}

export function mergePatterns(...patterns: Pattern[]): Pattern {
  const length = Math.max(0, ...patterns.map((p) => p.length_beats));
  return { length_beats: length, events: patterns.flatMap((p) => p.events) };
}

/** Keep only the events inside a beat window, rebased to 0. */
export function slicePattern(pattern: Pattern, fromBeat: number, toBeat: number): Pattern {
  if (toBeat <= fromBeat) throw new RangeError('toBeat must be greater than fromBeat.');
  return {
    length_beats: toBeat - fromBeat,
    events: pattern.events
      .filter((e) => e.beat >= fromBeat && e.beat < toBeat)
      .map((e) => ({ ...e, beat: round6(e.beat - fromBeat) })),
  };
}

/** Pull every event onto the nearest in-scale pitch. */
export function conformToScale(
  pattern: Pattern,
  root: string | number,
  scale: string,
): Pattern {
  return {
    length_beats: pattern.length_beats,
    events: pattern.events.map((e) => ({ ...e, pitch: snapToScale(e.pitch, root, scale) })),
  };
}

// ---------------------------------------------------------------------------
// Borrowing a bassline's feel
// ---------------------------------------------------------------------------

/** The parts of a bass analysis a pattern needs (see qc/src/bass.ts). */
export interface BassFeel {
  steps: Array<{ step: number; levelDb: number; sharedWithKick: boolean; pitch: number | null }>;
  /** Fraction of each 16th the bass sounds. */
  gate: number;
  /** Most common pitch, used for steps without a steady pitch of their own. */
  rootMidi: number;
}

export interface BassFeelOptions extends GeneratorOptions {
  /** Semitones added to every pitch, e.g. +12 when the synth adds a sub-octave. */
  transpose?: number;
  /**
   * Leave the kick's 16ths empty. Without a sidechain this is how a rolling
   * bass gets out of the kick's way; MIXING.md's House section prefers moving
   * the bass rhythm before reaching for broad EQ.
   */
  skipKickSteps?: boolean;
  /** Steps quieter than this (dB below the loudest) are left out. */
  floorDb?: number;
  /**
   * With skipKickSteps off: start the kick's 16ths this many beats late,
   * leaving a short gap where a sidechain would duck. 0.0625 is one 64th.
   */
  kickDelay?: number;
}

/**
 * Write a bassline with a reference's rhythm, accents, note length and
 * pitches, one bar repeated. Pitches are kept literal (transposable), so the
 * caller decides whether the reference's notes fit the track's key.
 */
export function bassFromFeel(feel: BassFeel, options: BassFeelOptions = {}): Pattern {
  const { length, random } = resolve(options);
  const perBar = 16;
  const step = 0.25;
  const floor = options.floorDb ?? -6;
  const shift = options.transpose ?? 0;
  const skipKick = options.skipKickSteps ?? true;
  const duration = Math.max(0.06, Math.min(0.25, step * feel.gate));

  const events: PatternEvent[] = [];
  const barCount = Math.round(length / 4);
  for (let bar = 0; bar < barCount; bar += 1) {
    for (const s of feel.steps) {
      if (s.step >= perBar) continue;
      if (skipKick && s.sharedWithKick) continue;
      if (s.levelDb < floor) continue;
      const pitch = (s.pitch ?? feel.rootMidi) + shift;
      if (pitch < 0 || pitch > 127) continue;
      // Accent from the reference's level: 0 dB -> 112, -6 dB -> 88.
      const velocity = 112 + s.levelDb * 4 + (random() * 4 - 2);
      const delay = !skipKick && s.sharedWithKick ? Math.min(options.kickDelay ?? 0, step / 2) : 0;
      events.push({
        beat: round6(bar * 4 + s.step * step + delay),
        pitch,
        duration: round6(Math.max(0.03, duration - delay)),
        velocity: clampVelocity(velocity),
      });
    }
  }
  return { length_beats: length, events };
}
