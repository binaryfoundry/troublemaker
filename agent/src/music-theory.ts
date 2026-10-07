/**
 * Deterministic musical helpers.
 *
 * Everything here is a pure function over numbers. Nothing in this file knows
 * that Ableton exists - the agent uses it to turn a musical idea into beats
 * and pitches, and only then emits primitive bridge commands.
 *
 * Octave numbering: Ableton's piano roll labels middle C (MIDI 60) as "C3",
 * so that is the default here and note names will match what the user sees on
 * screen. Scientific pitch notation, where middle C is "C4", is available by
 * passing 'scientific' - under that convention "F1" is 29.
 */

export type OctaveConvention = 'live' | 'scientific';

export const PITCH_MIN = 0;
export const PITCH_MAX = 127;

const NOTE_OFFSETS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number of C0 under each convention. */
const C_ZERO: Record<OctaveConvention, number> = {
  live: 24, // middle C = 60 = C3
  scientific: 12, // middle C = 60 = C4
};

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

export function isScaleName(name: string): name is ScaleName {
  return Object.prototype.hasOwnProperty.call(SCALES, normalizeScaleName(name));
}

function normalizeScaleName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function scaleIntervals(scale: string): number[] {
  const key = normalizeScaleName(scale);
  const intervals = (SCALES as Record<string, readonly number[]>)[key];
  if (!intervals) {
    throw new RangeError(
      `Unknown scale '${scale}'. Known scales: ${Object.keys(SCALES).join(', ')}.`,
    );
  }
  return [...intervals];
}

// ---------------------------------------------------------------------------
// Note names
// ---------------------------------------------------------------------------

/** Pitch class 0-11 for a note letter with optional accidentals, e.g. "F#". */
export function pitchClass(name: string): number {
  const match = /^([A-Ga-g])([#b♯♭]*)$/.exec(name.trim());
  if (!match) throw new RangeError(`'${name}' is not a note name such as C, F#, or Bb.`);
  const [, letter, accidentals] = match;
  let value = NOTE_OFFSETS[letter!.toUpperCase()]!;
  for (const character of accidentals ?? '') {
    if (character === '#' || character === '♯') value += 1;
    else value -= 1;
  }
  return ((value % 12) + 12) % 12;
}

/** "F1", "C#3", "Bb-1" to a MIDI note number. */
export function noteNameToMidi(name: string, convention: OctaveConvention = 'live'): number {
  const match = /^([A-Ga-g][#b♯♭]*)(-?\d+)$/.exec(name.trim());
  if (!match) {
    throw new RangeError(`'${name}' is not a note name with an octave, such as F1 or C#3.`);
  }
  const [, note, octaveText] = match;
  const midi = C_ZERO[convention] + Number.parseInt(octaveText!, 10) * 12 + pitchClass(note!);
  if (midi < PITCH_MIN || midi > PITCH_MAX) {
    throw new RangeError(`'${name}' is outside the MIDI range 0-127 (got ${midi}).`);
  }
  return midi;
}

export function midiToNoteName(pitch: number, convention: OctaveConvention = 'live'): string {
  assertPitch(pitch);
  const octave = Math.floor((pitch - C_ZERO[convention]) / 12);
  return `${SHARP_NAMES[pitch % 12]}${octave}`;
}

export function assertPitch(pitch: number): void {
  if (!Number.isInteger(pitch) || pitch < PITCH_MIN || pitch > PITCH_MAX) {
    throw new RangeError(`MIDI pitch must be an integer 0-127 (got ${pitch}).`);
  }
}

// ---------------------------------------------------------------------------
// Scales and chords
// ---------------------------------------------------------------------------

/** The pitch classes of a scale, as 0-11 values. */
export function scaleNotes(root: string | number, scale: string): number[] {
  const rootClass = typeof root === 'number' ? ((root % 12) + 12) % 12 : pitchClass(root);
  return scaleIntervals(scale).map((interval) => (rootClass + interval) % 12);
}

/** Every pitch of a scale within an inclusive MIDI range, ascending. */
export function scalePitches(
  root: string | number,
  scale: string,
  fromPitch: number,
  toPitch: number,
): number[] {
  assertPitch(fromPitch);
  assertPitch(toPitch);
  if (toPitch < fromPitch) throw new RangeError('toPitch must be >= fromPitch.');
  const classes = new Set(scaleNotes(root, scale));
  const pitches: number[] = [];
  for (let pitch = fromPitch; pitch <= toPitch; pitch += 1) {
    if (classes.has(pitch % 12)) pitches.push(pitch);
  }
  return pitches;
}

/**
 * Move a pitch to the nearest member of a scale.
 *
 * Ties resolve downward, which keeps basslines from drifting sharp.
 */
export function snapToScale(pitch: number, root: string | number, scale: string): number {
  assertPitch(pitch);
  const classes = scaleNotes(root, scale);
  if (classes.includes(pitch % 12)) return pitch;
  for (let distance = 1; distance <= 6; distance += 1) {
    const down = pitch - distance;
    if (down >= PITCH_MIN && classes.includes(((down % 12) + 12) % 12)) return down;
    const up = pitch + distance;
    if (up <= PITCH_MAX && classes.includes(up % 12)) return up;
  }
  return pitch;
}

/**
 * Build a diatonic chord on a scale degree (1-based).
 *
 * Stacking thirds inside the scale keeps the harmony in key, which is what
 * "add chords in F minor" means in practice.
 */
export function diatonicChord(
  root: string | number,
  scale: string,
  degree: number,
  options: { size?: number; octave?: number; convention?: OctaveConvention } = {},
): number[] {
  const size = options.size ?? 3;
  if (!Number.isInteger(degree) || degree < 1) {
    throw new RangeError('Scale degree must be an integer >= 1.');
  }
  if (size < 2 || size > 7) throw new RangeError('Chord size must be 2-7 notes.');

  const intervals = scaleIntervals(scale);
  const rootClass = typeof root === 'number' ? ((root % 12) + 12) % 12 : pitchClass(root);
  const baseOctave = options.octave ?? 3;
  const basePitch = C_ZERO[options.convention ?? 'live'] + baseOctave * 12 + rootClass;

  const pitches: number[] = [];
  for (let step = 0; step < size; step += 1) {
    const scaleIndex = degree - 1 + step * 2;
    const octaveShift = Math.floor(scaleIndex / intervals.length);
    const interval = intervals[scaleIndex % intervals.length]!;
    const pitch = basePitch + interval + octaveShift * 12;
    if (pitch >= PITCH_MIN && pitch <= PITCH_MAX) pitches.push(pitch);
  }
  return pitches;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

/** Beats in one bar. A beat is a quarter note, which is Live's unit. */
export function beatsPerBar(signature: TimeSignature = FOUR_FOUR): number {
  return (signature.numerator * 4) / signature.denominator;
}

/**
 * Bar number (1-based, as the user says it) to beat position (0-based, as
 * Live stores it). Bar 1 starts at beat 0; in 4/4, bar 9 starts at beat 32.
 */
export function barToBeat(bar: number, signature: TimeSignature = FOUR_FOUR): number {
  if (!Number.isFinite(bar) || bar < 1) throw new RangeError('Bar numbers start at 1.');
  return (bar - 1) * beatsPerBar(signature);
}

/** Beat position to a 1-based bar number and the offset inside that bar. */
export function beatToBar(
  beat: number,
  signature: TimeSignature = FOUR_FOUR,
): { bar: number; beatInBar: number } {
  if (!Number.isFinite(beat) || beat < 0) throw new RangeError('Beat positions start at 0.');
  const perBar = beatsPerBar(signature);
  return { bar: Math.floor(beat / perBar) + 1, beatInBar: beat % perBar };
}

export function barsToBeats(bars: number, signature: TimeSignature = FOUR_FOUR): number {
  if (!Number.isFinite(bars) || bars <= 0) throw new RangeError('Bar count must be > 0.');
  return bars * beatsPerBar(signature);
}

/** Snap a beat position to a grid, e.g. 0.25 for sixteenths. */
export function quantizeTime(beat: number, grid = 0.25, strength = 1): number {
  if (grid <= 0) throw new RangeError('Quantize grid must be > 0.');
  if (strength < 0 || strength > 1) throw new RangeError('Quantize strength must be 0-1.');
  const snapped = Math.round(beat / grid) * grid;
  return round6(beat + (snapped - beat) * strength);
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * A small seeded PRNG.
 *
 * Humanization has to be reproducible: the same prompt against the same clip
 * should produce the same edit, or a user can never undo-and-retry their way
 * to a result they like.
 */
export function makeRandom(seed = 1): () => number {
  let state = seed >>> 0 || 1;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seed from any string, so a clip name gives a stable feel. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function clampVelocity(velocity: number): number {
  return clamp(Math.round(velocity), 1, 127);
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Tempo-synced timing
// ---------------------------------------------------------------------------

/**
 * Length of a note value in milliseconds: 60000 / BPM per quarter note.
 * `division` is the note value denominator: 4 = quarter, 16 = sixteenth.
 */
export function noteMs(
  bpm: number,
  division: number,
  options: { dotted?: boolean; triplet?: boolean } = {},
): number {
  if (!(bpm > 0) || !(division > 0)) throw new RangeError('BPM and division must be positive.');
  let ms = (60000 / bpm) * (4 / division);
  if (options.dotted) ms *= 1.5;
  if (options.triplet) ms *= 2 / 3;
  return Math.round(ms * 100) / 100;
}

// ---------------------------------------------------------------------------
// Voicings and progressions
// ---------------------------------------------------------------------------

export type Voicing = 'triad' | 'seventh' | 'ninth' | 'sus2' | 'sus4' | 'power';

/** Lowest pitch a chord voice should use when a bass owns the bottom octave. */
export const CHORD_FLOOR = 48; // C2, about 131 Hz

/** A diatonic chord with a named voicing. Suspended chords stay in the scale. */
export function voicedChord(
  root: string | number,
  scale: string,
  degree: number,
  voicing: Voicing = 'triad',
  octave = 3,
): number[] {
  const stack = (size: number) => diatonicChord(root, scale, degree, { size, octave });
  switch (voicing) {
    case 'triad':
      return stack(3);
    case 'seventh':
      return stack(4);
    case 'ninth': {
      const [r, third, fifth, seventh, ninth] = stack(5);
      // Drop the fifth: the ninth gives the colour, the fifth only thickens.
      return [r!, third!, seventh!, ninth!].filter((p) => p !== undefined);
    }
    case 'sus2':
    case 'sus4': {
      const [r, , fifth] = stack(3);
      const step = voicing === 'sus2' ? 1 : 3;
      const intervals = scaleIntervals(scale);
      const rootClass = typeof root === 'number' ? ((root % 12) + 12) % 12 : pitchClass(root);
      const degreeIndex = (degree - 1 + step) % intervals.length;
      const octaveShift = Math.floor((degree - 1 + step) / intervals.length);
      const suspended = C_ZERO.live + octave * 12 + rootClass + intervals[degreeIndex]! + octaveShift * 12;
      return [r!, suspended, fifth!];
    }
    case 'power': {
      const [r, , fifth] = stack(3);
      return [r!, fifth!];
    }
  }
}

/** The terms of CHORDS.md 8.3's voice-leading cost, and the total. */
export interface VoiceLeadingCost {
  total: number;
  motion: number;
  /** Voices moving more than 7 semitones. */
  leaps: number;
  /** Paired voices that swap order. */
  crossings: number;
  /** Close intervals in the target voicing below the mud floor. */
  lowClusters: number;
  commonTones: number;
  contraryMotion: boolean;
}

/**
 * CHORDS.md 8.3: score an actual candidate note placement rather than
 * naming an inversion. The document calls this a decision procedure, not
 * sacred mathematics - the weights are its own:
 *
 *   motion + 4*leaps + 3*crossings + 3*lowClusters - 2*commonTones
 *   - 1*contraryMotion
 *
 * Voices are paired by order, as `movement` pairs them. This project models
 * a voicing as a sorted set of pitches, so `crossings` can only be non-zero
 * when a caller supplies its own voice assignment unsorted.
 */
export function voiceLeadingCost(from: number[], to: number[], floor = CHORD_FLOOR): VoiceLeadingCost {
  const pairs = Math.min(from.length, to.length);
  let leaps = 0, crossings = 0, up = 0, down = 0;
  for (let i = 0; i < pairs; i += 1) {
    const delta = to[i]! - from[i]!;
    if (Math.abs(delta) > 7) leaps += 1;
    if (delta > 0) up += 1;
    if (delta < 0) down += 1;
    for (let j = i + 1; j < pairs; j += 1) {
      if (from[i]! < from[j]! && to[i]! > to[j]!) crossings += 1;
      if (from[i]! > from[j]! && to[i]! < to[j]!) crossings += 1;
    }
  }
  let lowClusters = 0;
  const sorted = [...to].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1]! < floor && sorted[i]! - sorted[i - 1]! <= 4) lowClusters += 1;
  }
  const commonTones = to.filter((p) => from.includes(p)).length;
  const contraryMotion = up > 0 && down > 0;
  const motion = movement(from, to);
  const total =
    motion + 4 * leaps + 3 * crossings + 3 * lowClusters - 2 * commonTones - (contraryMotion ? 1 : 0);
  return { total, motion, leaps, crossings, lowClusters, commonTones, contraryMotion };
}

/**
 * Re-voice each chord to move as little as possible from the previous one,
 * by choosing among its inversions within an octave of the starting register.
 * Candidates are scored with CHORDS.md 8.3's cost, so held common tones and
 * open low spacing can outweigh a slightly larger total motion.
 * Voice-led harmony is the deep-house default; parallel motion is the
 * deliberate alternative.
 */
export function voiceLead(chords: number[][], floor = CHORD_FLOOR): number[][] {
  if (chords.length === 0) return [];
  const result: number[][] = [raiseAbove(chords[0]!, floor)];
  for (let i = 1; i < chords.length; i += 1) {
    const previous = result[i - 1]!;
    const candidates = inversions(chords[i]!, floor);
    let best = candidates[0]!;
    let bestCost = Infinity;
    for (const candidate of candidates) {
      const cost = voiceLeadingCost(previous, candidate, floor).total;
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    result.push(best);
  }
  return result;
}

function raiseAbove(chord: number[], floor: number): number[] {
  const out = [...chord].sort((a, b) => a - b);
  // Move the lowest voice up an octave until every voice clears the floor.
  while (out.length && out[0]! < floor) {
    out.push(out.shift()! + 12);
    out.sort((a, b) => a - b);
  }
  return out;
}

function inversions(chord: number[], floor: number): number[][] {
  const base = raiseAbove(chord, floor);
  const out: number[][] = [];
  let current = [...base];
  for (let i = 0; i < base.length * 2; i += 1) {
    out.push([...current]);
    // Rotate: lowest voice up an octave.
    current = [...current.slice(1), current[0]! + 12].sort((a, b) => a - b);
    if (current.at(-1)! > floor + 30) break;
  }
  // Also consider each candidate an octave down if it still clears the floor.
  for (const candidate of [...out]) {
    const down = candidate.map((p) => p - 12);
    if (down[0]! >= floor) out.push(down);
  }
  return out;
}

/** Total semitone movement between two chords, matching voices by order. */
function movement(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += Math.abs((a[Math.min(i, a.length - 1)] ?? 0) - (b[Math.min(i, b.length - 1)] ?? 0));
  }
  return total;
}

/** Chords for a list of scale degrees, voiced and optionally voice-led. */
export function progression(
  root: string | number,
  scale: string,
  degrees: number[],
  options: { voicing?: Voicing; octave?: number; voiceLed?: boolean } = {},
): number[][] {
  const chords = degrees.map((d) => voicedChord(root, scale, d, options.voicing ?? 'triad', options.octave ?? 3));
  return options.voiceLed === false ? chords.map((c) => raiseAbove(c, CHORD_FLOOR)) : voiceLead(chords);
}

/** Least common multiple: when two cycle lengths realign. */
export function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return Math.abs(a * b) / gcd(a, b);
}
