/**
 * Chord symbols and progressions (CHORDS.md): parse symbols such as F#m9,
 * E6/9sus4, Cm(add9), A7alt, C/E and "Gsus4→G", voice-lead them, report the
 * motion between chords, and check for the problems CHORDS.md's
 * troubleshooting names - mud from close low voicings, over-extended
 * chords, jumpy voice leading.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CHORD_FLOOR, pitchClass, voiceLead } from './music-theory.js';

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
  checks: { mud_floor_midi: number; mud_interval: number; max_voices: number; max_motion_per_change: number };
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
  return flat.map(({ chord, beat, beats }, i) => {
    let pitches = led[i]!;
    if (chord.bass !== null) {
      // Already standing on the bass note? Then the voicing is the slash chord.
      const lowest = Math.min(...pitches);
      if (lowest % 12 !== chord.bass) {
        const below = lowest - ((((lowest - chord.bass) % 12) + 12) % 12 || 12);
        pitches = [below, ...pitches];
      }
    }
    return { symbol: chord.symbol, pitches: [...new Set(pitches)].sort((a, b) => a - b), beat, beats };
  });
}

export interface VoiceLeadingStep {
  from: string;
  to: string;
  motion: number;
  commonTones: number;
  largestLeap: number;
}

/** Total motion, common tones and the largest single leap at each change. */
export function voiceLeadingReport(chords: VoicedChord[]): VoiceLeadingStep[] {
  const steps: VoiceLeadingStep[] = [];
  for (let i = 1; i < chords.length; i += 1) {
    const a = chords[i - 1]!.pitches, b = chords[i]!.pitches;
    let motion = 0, largest = 0;
    for (const p of b) {
      const nearest = Math.min(...a.map((q) => Math.abs(q - p)));
      motion += nearest;
      largest = Math.max(largest, nearest);
    }
    const commonTones = b.filter((p) => a.includes(p)).length;
    steps.push({ from: chords[i - 1]!.symbol, to: chords[i]!.symbol, motion, commonTones, largestLeap: largest });
  }
  return steps;
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
    for (let i = 1; i < upper.length; i += 1) {
      if (upper[i - 1]! < c.mud_floor_midi && upper[i]! - upper[i - 1]! <= c.mud_interval) {
        findings.push({ severity: 'warn', message: `${chord.symbol}: a third or closer below MIDI ${c.mud_floor_midi} is muddy; open the low voices.` });
        break;
      }
    }
    if (p.length > c.max_voices) {
      findings.push({ severity: 'info', message: `${chord.symbol} has ${p.length} voices; drop the fifth or a doubled tone unless the density is wanted.` });
    }
  }
  for (const step of voiceLeadingReport(chords)) {
    if (step.motion > c.max_motion_per_change) {
      findings.push({ severity: 'warn', message: `${step.from} → ${step.to} moves ${step.motion} semitones in total; try another inversion or a common-tone voicing.` });
    }
  }
  return findings;
}
