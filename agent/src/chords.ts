/**
 * Chord symbols and progressions (CHORDS.md): parse symbols such as F#m9,
 * E6/9sus4, Cm(add9), A7alt, C/E and "Gsus4→G", voice-lead them, report the
 * motion between chords, and check for the problems CHORDS.md's
 * troubleshooting names - mud from close low voicings, over-extended
 * chords, jumpy voice leading.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CHORD_FLOOR, pitchClass, scalePitches, voiceLead, voiceLeadingCost } from './music-theory.js';

/** Intervals above the root for each quality, longest names first when matching. */
const QUALITIES: Array<[string, number[]]> = [
  ['6/9sus4', [0, 5, 7, 9, 14]],
  ['m(add9)', [0, 3, 7, 14]],
  ['madd9', [0, 3, 7, 14]],
  ['maj13', [0, 4, 7, 11, 14, 21]],
  ['maj9', [0, 4, 7, 11, 14]],
  ['maj7', [0, 4, 7, 11]],
  ['m7b5', [0, 3, 6, 10]],
  ['dim7', [0, 3, 6, 9]],
  ['7alt', [0, 4, 10, 13, 15]],
  ['7sus4', [0, 5, 7, 10]],
  ['m11', [0, 3, 7, 10, 14, 17]],
  ['m9', [0, 3, 7, 10, 14]],
  ['m7', [0, 3, 7, 10]],
  ['m6', [0, 3, 7, 9]],
  ['6/9', [0, 4, 7, 9, 14]],
  ['add9', [0, 4, 7, 14]],
  ['sus2', [0, 2, 7]],
  ['sus4', [0, 5, 7]],
  ['dim', [0, 3, 6]],
  ['aug', [0, 4, 8]],
  ['13', [0, 4, 7, 10, 14, 21]],
  ['11', [0, 7, 10, 14, 17]],
  ['9', [0, 4, 7, 10, 14]],
  ['7', [0, 4, 7, 10]],
  ['6', [0, 4, 7, 9]],
  ['m', [0, 3, 7]],
  ['', [0, 4, 7]],
];

export interface ParsedChord {
  symbol: string;
  root: number;
  quality: string;
  /** Intervals above the root. */
  intervals: number[];
  /** Pitch class of a slash bass, if any. */
  bass: number | null;
}

export function parseChordSymbol(symbol: string): ParsedChord {
  const text = symbol.trim();
  const match = /^([A-G][#b♯♭]?)(.*)$/.exec(text);
  if (!match) throw new RangeError(`'${symbol}' is not a chord symbol such as F#m9 or C/E.`);
  const root = pitchClass(match[1]!);
  let rest = match[2]!;
  let bass: number | null = null;
  // A slash bass is a note name after the last '/', unlike the 9 in "6/9".
  const slash = /\/([A-G][#b♯♭]?)$/.exec(rest);
  if (slash) {
    bass = pitchClass(slash[1]!);
    rest = rest.slice(0, slash.index);
  }
  const found = QUALITIES.find(([name]) => rest === name);
  if (!found) throw new RangeError(`Unknown chord quality '${rest}' in '${symbol}'. Known: ${QUALITIES.map(([q]) => q || '(major)').join(', ')}.`);
  return { symbol: text, root, quality: found[0], intervals: found[1], bass };
}

/** One slot of a progression: usually one chord, or "Gsus4→G" - a suspension resolving inside the slot. */
export function parseSlot(slot: string): ParsedChord[] {
  return slot.split(/→|->/).map(parseChordSymbol);
}

interface ChordKnowledge {
  templates: Record<string, { style: string; progression: string[] }>;
  complexity_ladder: string[];
  complexity_ladder_source: string;
  checks: {
    mud_floor_midi: number;
    mud_interval: number;
    max_voices: number;
    max_motion_per_change: number;
    low_interval_limit: { source: string; bands: Array<{ below_midi: number; min_interval: number }> };
    loop_boundary_max_motion: number;
  };
}

const PATH = fileURLToPath(new URL('../knowledge/chord-progressions.json', import.meta.url));
let cached: ChordKnowledge | null = null;

export function chordKnowledge(): ChordKnowledge {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as ChordKnowledge;
  return cached;
}

export function chordTemplate(id: string): { style: string; progression: string[] } {
  const t = chordKnowledge().templates[id];
  if (!t) throw new RangeError(`Unknown chord template '${id}'. Known: ${Object.keys(chordKnowledge().templates).join(', ')}.`);
  return t;
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Flat keys spell with flats: F, Bb, Eb... major, and D, G, C, F, Bb... minor. */
export function prefersFlats(root: string, minor: boolean): boolean {
  if (/b|♭/.test(root.slice(1))) return true;
  if (/#|♯/.test(root.slice(1))) return false;
  return minor ? ['D', 'G', 'C', 'F'].includes(root) : root === 'F';
}

/** Move a chord symbol by semitones, keeping its quality and slash bass. */
export function transposeSymbol(symbol: string, semitones: number, flats?: boolean): string {
  const move = (name: string) => {
    const useFlats = flats ?? /b|♭/.test(name.slice(1));
    return (useFlats ? FLATS : SHARPS)[(((pitchClass(name) + semitones) % 12) + 12) % 12]!;
  };
  return symbol
    .split(/(→|->)/)
    .map((part) => {
      if (part === '→' || part === '->') return part;
      const m = /^([A-G][#b♯♭]?)(.*?)(\/([A-G][#b♯♭]?))?$/.exec(part.trim());
      if (!m) return part;
      return `${move(m[1]!)}${m[2]}${m[4] ? `/${move(m[4])}` : ''}`;
    })
    .join('');
}

/** A template's progression moved to a new key root (its key is its first chord's root). */
export function templateInKey(id: string, root?: string): string[] {
  const t = chordTemplate(id);
  if (!root) return t.progression;
  const first = parseSlot(t.progression[0]!)[0]!;
  const shift = (((pitchClass(root) - first.root) % 12) + 12) % 12;
  const semitones = shift > 6 ? shift - 12 : shift;
  const flats = prefersFlats(root, first.intervals[1] === 3);
  return t.progression.map((sym) => transposeSymbol(sym, semitones, flats));
}

export interface VoicedChord {
  symbol: string;
  pitches: number[];
  /** Beats into the progression where this chord starts, and how long it lasts. */
  beat: number;
  beats: number;
}

/**
 * Voice a progression: each slot gets beatsPerChord; a "→" resolution
 * splits its slot in half. Chords move by the smallest total motion from
 * the one before (inversions and octave placement), and a slash bass is
 * placed under the voicing.
 */
export function voiceProgression(slots: string[], options: { beatsPerChord?: number; floor?: number } = {}): VoicedChord[] {
  const per = options.beatsPerChord ?? 4;
  const floor = options.floor ?? CHORD_FLOOR;
  const flat: Array<{ chord: ParsedChord; beat: number; beats: number }> = [];
  slots.forEach((slot, i) => {
    const chords = parseSlot(slot);
    chords.forEach((chord, j) => flat.push({ chord, beat: i * per + (j * per) / chords.length, beats: per / chords.length }));
  });
  const close = flat.map(({ chord }) => chord.intervals.map((iv) => floor + chord.root + iv));
  const led = voiceLead(close, floor);
  const out: VoicedChord[] = [];
  flat.forEach(({ chord, beat, beats }, i) => {
    let pitches = led[i]!;
    if (chord.bass !== null) {
      const reference = i > 0 ? Math.min(...out[i - 1]!.pitches) : Math.min(...pitches);
      // The bass note nearest the previous lowest voice: a pedal stays exactly where it was.
      const candidates = [-12, 0, 12].map((o) => reference - ((((reference - chord.bass!) % 12) + 12) % 12) + o);
      const bass = candidates.sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference) || a - b)[0]!;
      const upper = pitches.filter((p) => p !== bass).map((p) => {
        let q = p;
        while (q <= bass) q += 12;
        return q;
      });
      pitches = [bass, ...upper];
    }
    out.push({ symbol: chord.symbol, pitches: [...new Set(pitches)].sort((a, b) => a - b), beat, beats });
  });
  return out;
}

export interface VoiceLeadingStep {
  from: string;
  to: string;
  motion: number;
  commonTones: number;
  largestLeap: number;
  /** CHORDS.md 8.3's cost: motion penalised for leaps and low clusters, credited for common tones. */
  cost: number;
}

function stepBetween(from: VoicedChord, to: VoicedChord): VoiceLeadingStep {
  const a = from.pitches, b = to.pitches;
  let motion = 0, largest = 0;
  for (const p of b) {
    const nearest = Math.min(...a.map((q) => Math.abs(q - p)));
    motion += nearest;
    largest = Math.max(largest, nearest);
  }
  const commonTones = b.filter((p) => a.includes(p)).length;
  return { from: from.symbol, to: to.symbol, motion, commonTones, largestLeap: largest, cost: voiceLeadingCost(a, b).total };
}

/** Total motion, common tones, the largest single leap and the 8.3 cost at each change. */
export function voiceLeadingReport(chords: VoicedChord[]): VoiceLeadingStep[] {
  const steps: VoiceLeadingStep[] = [];
  for (let i = 1; i < chords.length; i += 1) steps.push(stepBetween(chords[i - 1]!, chords[i]!));
  return steps;
}

/**
 * CHORDS.md 69: the reset from the last chord back to the first is a
 * transition too. A four-bar loop can voice-lead perfectly inside and still
 * land ugly on bar 1.
 */
export function loopBoundary(chords: VoicedChord[]): VoiceLeadingStep | null {
  if (chords.length < 2) return null;
  return stepBetween(chords.at(-1)!, chords[0]!);
}

export interface ChordFinding {
  severity: 'info' | 'warn';
  message: string;
}

export function checkChords(chords: VoicedChord[]): ChordFinding[] {
  const c = chordKnowledge().checks;
  const findings: ChordFinding[] = [];
  for (const chord of chords) {
    const p = chord.pitches;
    // The slash bass is allowed low; the upper voices are judged for mud.
    const upper = chord.symbol.includes('/') && !/6\/9/.test(chord.symbol) ? p.slice(1) : p;
    // CHORDS.md 68: the lower the register, the wider the spacing has to be.
    const bands = [...c.low_interval_limit.bands].sort((a, b) => a.below_midi - b.below_midi);
    for (let i = 1; i < upper.length; i += 1) {
      const low = upper[i - 1]!, interval = upper[i]! - low;
      const band = bands.find((b) => low < b.below_midi);
      if (band && interval < band.min_interval) {
        findings.push({
          severity: 'warn',
          message: `${chord.symbol}: ${interval} semitones above MIDI ${low} is muddy - below MIDI ${band.below_midi} keep voices at least ${band.min_interval} apart. Move a note before reaching for EQ.`,
        });
        break;
      }
    }
    if (p.length > c.max_voices) {
      findings.push({ severity: 'info', message: `${chord.symbol} has ${p.length} voices; drop the fifth or a doubled tone unless the density is wanted.` });
    }
    // CHORDS.md 76, the simplification pass: delete notes before adding processing.
    const classes = p.map((q) => ((q % 12) + 12) % 12);
    const doubled = classes.filter((q, i) => classes.indexOf(q) !== i);
    if (doubled.length > 0) {
      findings.push({
        severity: 'info',
        message: `${chord.symbol} doubles ${doubled.length === 1 ? 'a pitch class' : `${doubled.length} pitch classes`}; ask whether the duplicate earns its place before adding anything.`,
      });
    }
  }
  for (const step of voiceLeadingReport(chords)) {
    if (step.motion > c.max_motion_per_change) {
      findings.push({ severity: 'warn', message: `${step.from} → ${step.to} moves ${step.motion} semitones in total; try another inversion or a common-tone voicing.` });
    }
  }
  const loop = loopBoundary(chords);
  if (loop && loop.motion > c.loop_boundary_max_motion) {
    findings.push({
      severity: 'warn',
      message: `the loop resets ${loop.from} → ${loop.to} over ${loop.motion} semitones with ${loop.commonTones} common tones; voice-lead the loop boundary, not just the chords inside it.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// ERIC.md: chord rhythm, and progression by moving one voice
// ---------------------------------------------------------------------------

export type ChordRhythm = 'sustained' | 'offbeat_stabs' | 'eighth_pulse' | 'syncopated';

/**
 * The same voicings rendered as long sidechained chords, offbeat stabs, an
 * eighth-note pulse or syncopated cells (3-3-2 style).
 */
export function chordRhythm(chords: VoicedChord[], rhythm: ChordRhythm = 'sustained'): {
  length_beats: number;
  events: Array<{ beat: number; pitch: number; duration: number; velocity: number }>;
} {
  const events: Array<{ beat: number; pitch: number; duration: number; velocity: number }> = [];
  const cell = [0, 0.75, 1.5, 2.5, 3];
  for (const chord of chords) {
    const end = chord.beat + chord.beats;
    const hits: Array<[number, number, number]> = [];
    if (rhythm === 'sustained') hits.push([chord.beat, chord.beats * 0.98, 88]);
    else if (rhythm === 'offbeat_stabs') for (let b = chord.beat + 0.5; b < end - 1e-9; b += 1) hits.push([b, 0.25, 96]);
    else if (rhythm === 'eighth_pulse') for (let b = chord.beat; b < end - 1e-9; b += 0.5) hits.push([b, 0.35, Number.isInteger(b) ? 98 : 84]);
    else {
      for (let bar = chord.beat; bar < end - 1e-9; bar += 4) {
        cell.forEach((offset, i) => {
          const at = bar + offset;
          const next = bar + (cell[i + 1] ?? 4);
          if (at < end - 1e-9) hits.push([at, Math.min(next, end) - at - 0.1, i === 0 ? 100 : 88]);
        });
      }
    }
    for (const [beat, duration, velocity] of hits) for (const pitch of chord.pitches) events.push({ beat, pitch, duration, velocity });
  }
  return { length_beats: Math.max(...chords.map((c) => c.beat + c.beats)), events };
}

/**
 * "Before adding a new chord, move one note inside the current voicing."
 * Each step moves a single voice by one scale step, cycling from the top
 * voice down, never doubling another voice; everything else holds.
 */
export function evolveVoicing(start: number[], steps: number, options: { root: string; scale?: string; beatsPerChord?: number; seed?: number }): VoicedChord[] {
  const pool = scalePitches(options.root, options.scale ?? 'minor', Math.min(...start) - 12, Math.max(...start) + 12);
  const per = options.beatsPerChord ?? 4;
  let current = [...start].sort((a, b) => a - b);
  const out: VoicedChord[] = [{ symbol: 'start', pitches: current, beat: 0, beats: per }];
  let direction = (options.seed ?? 1) % 2 === 0 ? 1 : -1;
  for (let i = 1; i <= steps - 1; i += 1) {
    const voice = current.length - 1 - ((i - 1) % current.length);
    const from = current[voice]!;
    const index = pool.indexOf(pool.reduce((best, p) => (Math.abs(p - from) < Math.abs(best - from) ? p : best), pool[0]!));
    let to = pool[index + direction] ?? from;
    if (current.includes(to)) to = pool[index - direction] ?? from;
    if (current.includes(to)) to = from;
    current = current.map((p, v) => (v === voice ? to : p)).sort((a, b) => a - b);
    out.push({ symbol: `move ${i}`, pitches: current, beat: i * per, beats: per });
    direction = -direction;
  }
  return out;
}
