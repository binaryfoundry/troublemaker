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
  /** Machine-style accent, kept apart from velocity (DRUMS.md). Not sent to Live. */
  accent?: boolean;
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

// ---------------------------------------------------------------------------
// Advanced rhythm: ratchets and retrigger decelerations (EFFECTS.md),
// polymeter and polyrhythm (EDM-TIPS.md 8, EDM-PRODUCTION.md 6.7)
// ---------------------------------------------------------------------------

/**
 * Euclidean rhythm: k hits spread as evenly as possible over n steps,
 * starting on a hit, then rotated by `rotation` steps. E(5,16) is a classic
 * hat line; E(3,8) is the tresillo.
 */
export function euclidean(hits: number, steps: number, rotation = 0): boolean[] {
  if (!Number.isInteger(hits) || !Number.isInteger(steps) || steps < 1 || hits < 0 || hits > steps) {
    throw new RangeError('Euclidean rhythm needs integers with 0 <= hits <= steps.');
  }
  // Bjorklund: repeatedly pair the remainder groups onto the hit groups.
  let a: boolean[][] = Array.from({ length: hits }, () => [true]);
  let b: boolean[][] = Array.from({ length: steps - hits }, () => [false]);
  while (b.length > 1 && a.length > 0) {
    const m = Math.min(a.length, b.length);
    const paired = a.slice(0, m).map((group, i) => [...group, ...b[i]!]);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = paired;
    b = rest;
  }
  const aligned = [...a, ...b].flat();
  const r = ((rotation % steps) + steps) % steps;
  return r === 0 ? aligned : [...aligned.slice(steps - r), ...aligned.slice(0, steps - r)];
}

export function euclideanPattern(
  options: GeneratorOptions & {
    hits: number;
    steps: number;
    rotation?: number;
    pitch: number;
    stepBeats?: number;
    velocity?: number;
  },
): Pattern {
  const { length, random } = resolve(options);
  const stepBeats = options.stepBeats ?? 0.25;
  const grid = euclidean(options.hits, options.steps, options.rotation ?? 0);
  const events: PatternEvent[] = [];
  for (let i = 0; i * stepBeats < length - 1e-9; i += 1) {
    if (!grid[i % grid.length]) continue;
    events.push({
      beat: round6(i * stepBeats),
      pitch: options.pitch,
      duration: round6(stepBeats * 0.5),
      velocity: clampVelocity((options.velocity ?? 96) + (random() * 8 - 4)),
    });
  }
  return { length_beats: length, events };
}

/**
 * a:b polyrhythm: a evenly spaced hits on one pitch and b on another, both
 * filling the same cycle. 3:2 over one bar puts three hits against two.
 */
export function polyrhythm(options: {
  a: number;
  b: number;
  pitchA: number;
  pitchB: number;
  cycleBeats?: number;
  bars?: number;
  velocity?: number;
}): Pattern {
  const cycle = options.cycleBeats ?? 4;
  const length = (options.bars ?? 1) * 4;
  const events: PatternEvent[] = [];
  for (let start = 0; start < length - 1e-9; start += cycle) {
    const streams: Array<[number, number]> = [
      [options.a, options.pitchA],
      [options.b, options.pitchB],
    ];
    for (const [count, pitch] of streams) {
      for (let i = 0; i < count; i += 1) {
        events.push({
          beat: round6(start + (i * cycle) / count),
          pitch,
          duration: round6(Math.min(0.25, cycle / count / 2)),
          velocity: clampVelocity(options.velocity ?? 100),
        });
      }
    }
  }
  return { length_beats: length, events };
}

/**
 * A polymetric clip: a pattern whose loop is `steps` sixteenths long, so it
 * drifts against the 16-step bar and realigns after lcm(steps, 16)
 * sixteenths. Write it into its own clip and set that clip's loop to
 * `length_beats`; Live then plays the polymeter by itself.
 */
export function polymeterClip(options: {
  steps: number;
  hits?: number;
  pitch: number;
  velocity?: number;
  seed?: number;
}): Pattern & { realignsAfterBars: number } {
  if (!Number.isInteger(options.steps) || options.steps < 2) {
    throw new RangeError('steps must be an integer >= 2.');
  }
  const hits = options.hits ?? Math.max(1, Math.round(options.steps / 2.5));
  const length = options.steps * 0.25;
  const grid = euclidean(hits, options.steps);
  const random = makeRandom(options.seed ?? 1);
  const events: PatternEvent[] = [];
  grid.forEach((hit, i) => {
    if (!hit) return;
    events.push({
      beat: round6(i * 0.25),
      pitch: options.pitch,
      duration: 0.125,
      velocity: clampVelocity((options.velocity ?? 96) + (random() * 8 - 4)),
    });
  });
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const realign = (options.steps * 16) / gcd(options.steps, 16);
  return { length_beats: length, events, realignsAfterBars: realign / 16 };
}

/**
 * A layered-cycle arpeggio, the modular-sequencer way to make a short idea
 * evolve: a contour (indices into the current chord's tones), an accent
 * pattern, an octave pattern and a rest mask, each looping at its own
 * length against the step grid. With lengths like 5, 8, 7 and 16 the line
 * keeps shifting against the bar and only repeats after their lcm, while
 * every pitch still comes from the chord that is sounding.
 */
export function cycleArp(options: {
  /** Chord tones per chord, in order; each lasts beatsPerChord. */
  chords: number[][];
  beatsPerChord: number;
  bars?: number;
  stepBeats?: number;
  /** Index into the chord's tones; past the top wraps up an octave. */
  contour: number[];
  accents?: boolean[];
  octaves?: number[];
  /** false = rest on that step of the mask's cycle. */
  mask?: boolean[];
  gate?: number;
  velocity?: [number, number];
  seed?: number;
}): Pattern & { repeatsAfterSteps: number } {
  if (!options.chords.length || options.contour.length === 0) {
    throw new RangeError('cycleArp needs chords and a contour.');
  }
  const step = options.stepBeats ?? 0.25;
  const length = (options.bars ?? 1) * 4;
  const accents = options.accents ?? [true, false, false, false];
  const octaves = options.octaves ?? [0];
  const mask = options.mask ?? [true];
  const [soft, loud] = options.velocity ?? [76, 112];
  const random = makeRandom(options.seed ?? 1);
  const events: PatternEvent[] = [];
  const total = Math.round(length / step);
  for (let i = 0; i < total; i += 1) {
    if (!mask[i % mask.length]) continue;
    const beat = i * step;
    const chord = [...options.chords[Math.floor(beat / options.beatsPerChord) % options.chords.length]!].sort((a, b) => a - b);
    const index = options.contour[i % options.contour.length]!;
    const pitch = chord[index % chord.length]! + 12 * Math.floor(index / chord.length) + octaves[i % octaves.length]!;
    if (pitch < 0 || pitch > 127) continue;
    events.push({
      beat: round6(beat),
      pitch,
      duration: round6(step * (options.gate ?? 0.6)),
      velocity: clampVelocity((accents[i % accents.length] ? loud : soft) + (random() * 6 - 3)),
    });
  }
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const lcm = (x: number, y: number) => (x * y) / gcd(x, y);
  const repeatsAfterSteps = [options.contour.length, accents.length, octaves.length, mask.length, 16].reduce(lcm);
  return { length_beats: length, events, repeatsAfterSteps };
}

/**
 * Exponential ratchet / retrigger deceleration: one note retriggered while
 * the repeat rate moves from startHz to endHz along an exponential curve,
 * so spacing changes by a constant ratio. Accelerating builds tension;
 * decelerating is the roulette wheel slowing down. Each hit keeps its pitch,
 * which is what separates it from a tape stop.
 */
export function retriggerRamp(options: {
  pitch: number;
  startHz: number;
  endHz: number;
  durationBeats: number;
  bpm: number;
  /** Fraction of each interval the note sounds. */
  gate?: number;
  velocity?: number;
  /** Velocity at the end relative to the start, e.g. 0.6 to fade out. */
  velocityEnd?: number;
  /** Semitones of pitch drop across the gesture, for a deliberate hybrid. */
  pitchDrop?: number;
  offsetBeats?: number;
}): Pattern {
  const { startHz, endHz, bpm } = options;
  if (!(startHz > 0) || !(endHz > 0)) throw new RangeError('Rates must be positive.');
  const secondsTotal = (options.durationBeats * 60) / bpm;
  const gate = options.gate ?? 0.4;
  const v0 = options.velocity ?? 105;
  const v1 = v0 * (options.velocityEnd ?? 1);
  const events: PatternEvent[] = [];
  let t = 0;
  let guard = 0;
  while (t < secondsTotal - 1e-6 && guard < 2000) {
    const progress = t / secondsTotal;
    const hz = startHz * Math.pow(endHz / startHz, progress);
    const interval = 1 / hz;
    events.push({
      beat: round6((options.offsetBeats ?? 0) + (t * bpm) / 60),
      pitch: Math.round(options.pitch - (options.pitchDrop ?? 0) * progress),
      duration: round6(Math.max(0.01, (interval * gate * bpm) / 60)),
      velocity: clampVelocity(v0 + (v1 - v0) * progress),
    });
    t += interval;
    guard += 1;
  }
  return { length_beats: options.durationBeats + (options.offsetBeats ?? 0), events };
}

/**
 * A fill ending at `endBeat`: the subdivision tightens and velocity rises
 * over the last `beats`. Pitches cycle through `pitches`, so a fill can move
 * between snare, toms and percussion.
 */
export function fill(options: {
  pitches: number[];
  beats?: number;
  endBeat: number;
  startDivision?: number;
  endDivision?: number;
  seed?: number;
}): Pattern {
  if (options.pitches.length === 0) throw new RangeError('A fill needs at least one pitch.');
  const beats = options.beats ?? 2;
  const startDivision = options.startDivision ?? 0.5;
  const endDivision = options.endDivision ?? 0.125;
  const random = makeRandom(options.seed ?? 1);
  const start = options.endBeat - beats;
  const events: PatternEvent[] = [];
  let position = 0;
  let index = 0;
  while (position < beats - 1e-9) {
    const progress = position / beats;
    const division = startDivision + (endDivision - startDivision) * progress;
    events.push({
      beat: round6(start + position),
      pitch: options.pitches[index % options.pitches.length]!,
      duration: round6(Math.min(division, 0.25)),
      velocity: clampVelocity(70 + 50 * progress + (random() * 6 - 3)),
    });
    // Snap to a 32nd so the fill stays on the grid.
    position = Math.max(position + 0.125, Math.round((position + division) * 8) / 8);
    index += 1;
  }
  return { length_beats: options.endBeat, events };
}

/** A tonal riser: scale steps climbing faster towards the drop. */
export function risingNotes(options: {
  root: string | number;
  scale?: string;
  startPitch: number;
  semitones?: number;
  beats: number;
  offsetBeats?: number;
}): Pattern {
  const top = Math.min(127, options.startPitch + (options.semitones ?? 12));
  const pitches = scalePitches(options.root, options.scale ?? 'minor', options.startPitch, top);
  const n = pitches.length;
  const events: PatternEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    // Quadratic spacing: early notes are long, late ones crowd the drop.
    const at = options.beats * (1 - Math.pow(1 - i / n, 2));
    const next = options.beats * (1 - Math.pow(1 - (i + 1) / n, 2));
    events.push({
      beat: round6((options.offsetBeats ?? 0) + at),
      pitch: pitches[i]!,
      duration: round6(Math.max(0.06, next - at)),
      velocity: clampVelocity(80 + (40 * i) / Math.max(1, n - 1)),
    });
  }
  return { length_beats: (options.offsetBeats ?? 0) + options.beats, events };
}

/** A single impact note on the downbeat of an arrival. */
export function impact(options: { pitch: number; atBeat: number; beats?: number; velocity?: number }): Pattern {
  return {
    length_beats: options.atBeat + (options.beats ?? 4),
    events: [
      { beat: options.atBeat, pitch: options.pitch, duration: options.beats ?? 2, velocity: options.velocity ?? 120 },
    ],
  };
}
