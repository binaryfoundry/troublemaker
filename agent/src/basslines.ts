/**
 * Basslines (BASSLINES.md): the pattern library as data, transposed to any
 * key, the A / A2 / B / A3 development form, a fix for envelope-restarting
 * repeats, and checks drawn from its troubleshooting matrix - kick
 * collisions, overlaps, clicky note boundaries, a fundamental too low for
 * the key, off-chord notes on strong beats and polyphony in a sub.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clampVelocity, makeRandom, noteNameToMidi, pitchClass, round6 } from './music-theory.js';
import type { Pattern, PatternEvent } from './patterns.js';

interface BassPatternSpec {
  genre: string;
  tempo: number;
  purpose: string;
  layer?: 'upper';
  grid: string;
  /** Key the pattern is written in, if not the library's C. */
  key?: string;
  /** Octave naming the pattern uses: scientific (C4 = 60) by default, or Live's (C3 = 60). */
  convention?: 'scientific' | 'live';
}

interface BassKnowledge {
  key: string;
  default_gate: number;
  patterns: Record<string, BassPatternSpec>;
  form: Array<'A' | 'A2' | 'B' | 'A3'>;
  genre_priorities: Record<string, string[]>;
  checks: { lowest_fundamental_hz: number; click_ms: number; retrigger_gap_ms: number };
}

const PATH = fileURLToPath(new URL('../knowledge/bass-patterns.json', import.meta.url));
let cached: BassKnowledge | null = null;

export function bassKnowledge(): BassKnowledge {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as BassKnowledge;
  return cached;
}

export function bassPatternNames(): string[] {
  return Object.keys(bassKnowledge().patterns);
}

const STEP = 0.25;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** BASSLINES.md notation (16 steps a bar, any number of bars) as events in the written key. */
export function parseBassGrid(grid: string, gate = bassKnowledge().default_gate, convention: 'scientific' | 'live' = 'scientific'): PatternEvent[] {
  const tokens = grid.split(/\s+/).filter((t) => t && t !== '|');
  if (tokens.length === 0 || tokens.length % 16 !== 0) throw new RangeError(`A bass grid needs 16 steps a bar; got ${tokens.length}.`);
  const events: PatternEvent[] = [];
  tokens.forEach((token, step) => {
    if (token === '~') {
      const last = events.at(-1);
      if (last) last.duration = round6(step * STEP + STEP * gate - last.beat);
      return;
    }
    if (token === '—' || token === '-') return;
    const [name, velocity] = token.split('/');
    events.push({
      beat: step * STEP,
      pitch: noteNameToMidi(name!, convention),
      duration: round6(STEP * gate),
      velocity: Number(velocity ?? 100),
    });
  });
  return events;
}

export interface BassOptions {
  /** Target key root, e.g. "F". The pattern moves the shortest way (−6..+5 semitones). */
  root?: string;
  /** Whole octaves up or down after transposing. */
  octave?: number;
  bars?: number;
  gate?: number;
  seed?: number;
  /** Development across the clip: A, A2 (one change), B (thinner), A3 (octave lift and approach). */
  form?: boolean;
  /** Bars per form section when form is on (default 2: an 8-bar clip). */
  barsPerSection?: number;
}

function transposeInterval(from: string, to: string): number {
  const up = (pitchClass(to) - pitchClass(from) + 12) % 12;
  return up > 5 ? up - 12 : up;
}

/** A / A2 / B / A3 as BASSLINES.md describes: controlled differences, one dimension at a time. */
export function developBar(events: PatternEvent[], section: 'A' | 'A2' | 'B' | 'A3', seed = 1, lengthBeats = 4): PatternEvent[] {
  if (section === 'A' || events.length === 0) return events.map((e) => ({ ...e }));
  const random = makeRandom(seed);
  const out = events.map((e) => ({ ...e }));
  const root = Math.min(...out.map((e) => e.pitch));
  if (section === 'A2') {
    // One change: a non-root note moves to the octave, or one note drops out.
    const others = out.filter((e) => e.pitch % 12 !== root % 12);
    if (others.length && random() < 0.6) {
      const pick = others[Math.floor(random() * others.length)]!;
      pick.pitch = root + 12;
    } else if (out.length > 2) {
      out.splice(1 + Math.floor(random() * (out.length - 1)), 1);
    }
    return out;
  }
  if (section === 'B') {
    // Reduce: every other note, the sub thinned to leave room.
    return out.filter((_, i) => i % 2 === 0);
  }
  // A3: return with a lift - the last note an octave up, plus a chromatic approach into the next downbeat.
  const last = out.at(-1)!;
  last.pitch += 12;
  const approachBeat = lengthBeats - 0.25;
  if (!out.some((e) => Math.abs(e.beat - approachBeat) < 1e-6)) {
    out.push({ beat: approachBeat, pitch: root - 1, duration: round6(STEP * 0.9), velocity: clampVelocity(last.velocity - 8) });
  }
  return out;
}

export function bassPattern(name: string, options: BassOptions = {}): Pattern & { spec: BassPatternSpec } {
  const k = bassKnowledge();
  const spec = k.patterns[name];
  if (!spec) throw new RangeError(`Unknown bass pattern '${name}'. Known: ${bassPatternNames().join(', ')}.`);
  const shift = (options.root ? transposeInterval(spec.key ?? k.key, options.root) : 0) + 12 * (options.octave ?? 0);
  const bar = parseBassGrid(spec.grid, options.gate ?? k.default_gate, spec.convention ?? 'scientific').map((e) => ({ ...e, pitch: e.pitch + shift }));
  const unitBeats = (spec.grid.split(/\s+/).filter((t) => t && t !== '|').length / 16) * 4;
  const sections = options.form ? k.form : ['A' as const];
  const perSection = options.form ? (options.barsPerSection ?? 2) : (options.bars ?? 1);
  const events: PatternEvent[] = [];
  let barIndex = 0;
  sections.forEach((section, s) => {
    for (let b = 0; b < perSection; b += 1) {
      // The change lands on the section's last bar, so each section opens on the familiar idea.
      const variant = b === perSection - 1 || section === 'B' ? section : 'A';
      for (const e of developBar(bar, variant, (options.seed ?? 1) * 31 + s, unitBeats)) events.push({ ...e, beat: round6(e.beat + barIndex * 4) });
      barIndex += unitBeats / 4;
    }
  });
  return { length_beats: barIndex * 4, events, spec };
}

/**
 * Join back-to-back notes of the same pitch into one. A patch with a fast
 * attack restarts its envelope on every note, and sixteen restarts a bar of
 * a low waveform is heard as clicking and stutter rather than a rolling bass.
 */
export function mergeRepeats(pattern: Pattern, maxGapBeats = 0.03): Pattern {
  const sorted = [...pattern.events].sort((a, b) => a.beat - b.beat);
  const out: PatternEvent[] = [];
  for (const e of sorted) {
    const last = out.at(-1);
    if (last && last.pitch === e.pitch && e.beat - (last.beat + last.duration) <= maxGapBeats && e.beat > last.beat) {
      last.duration = round6(e.beat + e.duration - last.beat);
      continue;
    }
    out.push({ ...e });
  }
  return { ...pattern, events: out };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface BassFinding {
  severity: 'info' | 'warn' | 'review';
  message: string;
}

export interface BassContext {
  bpm?: number;
  /** Kick note start beats, to find collisions. */
  kicks?: number[];
  /** Chord tones per chord and how long each lasts, to find off-chord strong beats. */
  chords?: number[][];
  beatsPerChord?: number;
  /** An upper layer may sit higher and overlap; a sub may not. */
  layer?: 'sub' | 'upper';
}

export function checkBassline(pattern: Pattern, context: BassContext = {}): BassFinding[] {
  const k = bassKnowledge();
  const bpm = context.bpm ?? 124;
  const ms = (beats: number) => (beats * 60000) / bpm;
  const events = [...pattern.events].sort((a, b) => a.beat - b.beat);
  const findings: BassFinding[] = [];
  if (!events.length) return [{ severity: 'review', message: 'The bassline is empty.' }];

  const lowest = Math.min(...events.map((e) => e.pitch));
  if (hz(lowest) < k.checks.lowest_fundamental_hz && context.layer !== 'upper') {
    findings.push({
      severity: 'warn',
      message: `The lowest note's fundamental is ${hz(lowest).toFixed(0)} Hz, below ~${k.checks.lowest_fundamental_hz} Hz: most systems lose it. Move the octave or the key.`,
    });
  }

  const short = events.filter((e) => ms(e.duration) < k.checks.click_ms).length;
  if (short) {
    findings.push({
      severity: 'warn',
      message: `${short} notes are shorter than ${k.checks.click_ms} ms; low notes that short click at their boundaries. Lengthen them or give the patch a small attack and release.`,
    });
  }

  let overlaps = 0, stacked = 0, retriggers = 0;
  for (let i = 1; i < events.length; i += 1) {
    const a = events[i - 1]!, b = events[i]!;
    if (Math.abs(a.beat - b.beat) < 1e-6) stacked += 1;
    else if (a.beat + a.duration > b.beat + 1e-6) overlaps += 1;
    else if (a.pitch === b.pitch && ms(b.beat - (a.beat + a.duration)) < k.checks.retrigger_gap_ms) retriggers += 1;
  }
  if (stacked && context.layer !== 'upper') {
    findings.push({ severity: 'warn', message: `${stacked} chords/stacked notes in the bass; avoid polyphony in a dedicated sub layer.` });
  }
  if (overlaps && context.layer !== 'upper') {
    findings.push({ severity: 'warn', message: `${overlaps} notes overlap the next one; overlapping low notes smear and can cancel. Use it only as deliberate glide.` });
  }
  const bars = Math.max(1, pattern.length_beats / 4);
  if (retriggers / bars >= 4) {
    findings.push({
      severity: 'warn',
      message: `${retriggers} back-to-back repeats of the same note (${(retriggers / bars).toFixed(0)} a bar) restart the envelope each time; on a fast-attack patch that clicks and stutters. Merge repeats (mergeRepeats) or soften the attack.`,
    });
  }

  if (context.kicks?.length) {
    const onKick = events.filter((e) => context.kicks!.some((kb) => Math.abs(kb - e.beat) < 0.02)).length;
    if (onKick / events.length > 0.5) {
      findings.push({
        severity: 'info',
        message: `${onKick} of ${events.length} bass notes start with the kick. Shorten, offset or answer the kick before reaching for sidechain.`,
      });
    }
  }

  if (context.chords?.length && context.beatsPerChord) {
    const strong = events.filter((e) => Math.abs(e.beat - Math.round(e.beat)) < 1e-6);
    const off = strong.filter((e) => {
      const chord = context.chords![Math.floor(e.beat / context.beatsPerChord!) % context.chords!.length]!;
      return !chord.some((n) => n % 12 === e.pitch % 12);
    }).length;
    if (off) findings.push({ severity: 'info', message: `${off} notes on the beat are not in the sounding chord; check each is an intended passing or pedal note.` });
  }
  return findings;
}
