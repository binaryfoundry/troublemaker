/**
 * Motif-first melody (EDM-TIPS.md): rhythm before pitch, chord tones on the
 * strong beats, mostly stepwise motion with a leap that recovers, a limited
 * range, repetition with one controlled variation, and a resolution at the
 * end of the phrase. "Make it catchier" means simplify to a rhythmic motif
 * and restore pitch around chord tones - not more notes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clampVelocity, makeRandom, pitchClass, round6, scalePitches } from './music-theory.js';
import { euclidean, type Pattern, type PatternEvent } from './patterns.js';

export interface MelodyOptions {
  /** Chord tones per chord (absolute pitches are fine; only pitch classes are used). */
  chords: number[][];
  beatsPerChord: number;
  root: string;
  scale?: string;
  /** Total bars; default one pass of the chords. */
  bars?: number;
  /** Lowest and highest pitch allowed. Default one octave and a fourth from F4-ish. */
  register?: [number, number];
  /** Onsets in the one-bar rhythmic motif (of 16 steps). Default 5. */
  hits?: number;
  /** Bar plan; default A A A' B repeated. */
  plan?: Array<'A' | "A'" | 'B'>;
  seed?: number;
}

const STEP = 0.25;

/** The motif's rhythm: onsets on a 16-step bar, starting on the downbeat. */
export function motifRhythm(hits: number, seed = 1): number[] {
  const random = makeRandom(seed);
  const rotation = Math.floor(random() * 3);
  const grid = euclidean(Math.min(Math.max(hits, 2), 9), 16, rotation);
  const onsets = grid.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  return onsets.includes(0) ? onsets : [0, ...onsets.slice(1)];
}

export function motifMelody(options: MelodyOptions): Pattern {
  const random = makeRandom(options.seed ?? 1);
  const scale = options.scale ?? 'minor';
  const [low, high] = options.register ?? [65, 82];
  const totalBeats = (options.bars ?? (options.chords.length * options.beatsPerChord) / 4) * 4;
  const bars = Math.round(totalBeats / 4);
  const plan = options.plan ?? ['A', 'A', "A'", 'B'];
  const pool = scalePitches(options.root, scale, low, high);
  const tonic = pitchClass(options.root);
  const rhythmA = motifRhythm(options.hits ?? 5, options.seed ?? 1);
  // B answers A: same number of notes, shifted where the motif is weakest.
  const rhythmB = [...new Set(rhythmA.map((s, i) => (i === rhythmA.length - 1 ? Math.min(15, s + 2) : s)))];

  const chordAt = (beat: number) => options.chords[Math.floor(beat / options.beatsPerChord) % options.chords.length]!.map((p) => p % 12);
  const nearestIn = (target: number, allowed: (p: number) => boolean) =>
    pool.filter(allowed).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target;

  // Contour of the motif in scale steps, chosen once so A bars repeat recognisably.
  const contour = rhythmA.map((_, i) => (i === 0 ? 0 : random() < 0.15 ? (random() < 0.5 ? 3 : -3) : random() < 0.5 ? 1 : -1));

  const events: PatternEvent[] = [];
  // Every bar starts near the same anchor, so repeats are recognisable and the line cannot drift.
  const anchor = nearestIn(low + (high - low) * 0.4, (p) => chordAt(0).includes(p % 12));
  let previous = anchor;
  for (let bar = 0; bar < bars; bar += 1) {
    const kind = plan[bar % plan.length]!;
    previous = nearestIn(anchor, (p) => chordAt(bar * 4).includes(p % 12));
    const rhythm = kind === 'B' ? rhythmB : rhythmA;
    const lastBar = bar === bars - 1;
    rhythm.forEach((step, i) => {
      const beat = bar * 4 + step * STEP;
      const chord = chordAt(beat);
      const strong = step % 4 === 0;
      const index = pool.indexOf(nearestIn(previous, () => true));
      if (i === 0) {
        previous = nearestIn(anchor, (p) => chord.includes(p % 12));
      }
      let move = kind === 'B' ? -contour[i]! : contour[i]!;
      // A' changes only the final note of the bar.
      if (kind === "A'" && i === rhythm.length - 1) move += move >= 0 ? 2 : -2;
      // Recover from a leap in the opposite direction.
      const lastMove = events.length > 1 ? events.at(-1)!.pitch - events.at(-2)!.pitch : 0;
      if (Math.abs(lastMove) > 4) move = -Math.sign(lastMove);
      let pitch = pool[Math.min(pool.length - 1, Math.max(0, index + move))]!;
      if (strong) pitch = nearestIn(pitch, (p) => chord.includes(p % 12));
      const finalNote = lastBar && i === rhythm.length - 1;
      if (finalNote) {
        // Resolve to the tonic nearest the middle of the line, not an octave away.
        const sung = events.map((e) => e.pitch).sort((a, b) => a - b);
        pitch = nearestIn(sung[Math.floor(sung.length / 2)] ?? pitch, (p) => p % 12 === tonic);
      }
      const next = rhythm[i + 1] ?? 16;
      events.push({
        beat: round6(beat),
        pitch,
        duration: round6(finalNote ? Math.max(STEP * 2, (16 - step) * STEP * 0.95) : Math.min(1, (next - step) * STEP * 0.9)),
        velocity: clampVelocity((strong ? 104 : 90) + (random() * 8 - 4)),
      });
      previous = pitch;
    });
  }
  return { length_beats: totalBeats, events };
}

export interface MelodyFinding {
  severity: 'info' | 'warn';
  message: string;
}

/** EDM-TIPS.md's melody checks: chord tones on strong beats, range, leaps, resolution. */
export function checkMelody(pattern: Pattern, options: { chords: number[][]; beatsPerChord: number; root: string }): MelodyFinding[] {
  const findings: MelodyFinding[] = [];
  const events = [...pattern.events].sort((a, b) => a.beat - b.beat);
  if (!events.length) return [{ severity: 'warn', message: 'The melody is empty.' }];
  const chordAt = (beat: number) => options.chords[Math.floor(beat / options.beatsPerChord) % options.chords.length]!.map((p) => p % 12);
  const strong = events.filter((e) => Math.abs(e.beat - Math.round(e.beat)) < 1e-6);
  const onChord = strong.filter((e) => chordAt(e.beat).includes(e.pitch % 12)).length;
  if (strong.length && onChord / strong.length < 0.6) {
    findings.push({ severity: 'warn', message: `Only ${onChord} of ${strong.length} notes on the beat are chord tones; anchor the strong beats on the harmony.` });
  }
  const pitches = events.map((e) => e.pitch);
  const range = Math.max(...pitches) - Math.min(...pitches);
  if (range > 15) findings.push({ severity: 'warn', message: `The melody spans ${range} semitones; a hook is easier to remember within about an octave and a third.` });
  let leaps = 0;
  for (let i = 1; i < pitches.length; i += 1) if (Math.abs(pitches[i]! - pitches[i - 1]!) > 7) leaps += 1;
  if (leaps > pitches.length / 4) findings.push({ severity: 'info', message: `${leaps} leaps wider than a fifth; mostly stepwise motion with occasional leaps reads as a melody.` });
  const last = events.at(-1)!;
  const tonic = pitchClass(options.root);
  if (last.pitch % 12 !== tonic && !chordAt(last.beat).includes(last.pitch % 12)) {
    findings.push({ severity: 'info', message: 'The phrase ends off the harmony; end on the tonic or a chord tone unless the loop should stay open.' });
  }
  return findings;
}

/**
 * MELODY.md's checks, which are about a melody's *shape over a phrase* rather
 * than its note-by-note correctness. They are kept separate from
 * `checkMelody` because the two documents are different sources and
 * AGENTS.md asks that each source keep its own rules.
 *
 * The first check exists because of a real failure: a lead was written that
 * started all sixteen bars on the tonic. Every note was a chord tone, the
 * range and leaps were fine, so `checkMelody` passed it - and it still sounded
 * like an exercise, exactly as MELODY.md section 7 predicts ("repeatedly
 * landing on roots can make a lead melody sound like a bassline"). Section 16
 * is blunter: the tonic should be a destination, not a default.
 */
export function checkMelodyShape(
  pattern: Pattern,
  options: { chords: number[][]; chordRoots: number[]; beatsPerChord: number; root: string; barsPerPhrase?: number },
): MelodyFinding[] {
  const findings: MelodyFinding[] = [];
  const events = [...pattern.events].sort((a, b) => a.beat - b.beat);
  if (!events.length) return [{ severity: 'warn', message: 'The melody is empty.' }];

  const tonic = pitchClass(options.root);
  const barsPerPhrase = options.barsPerPhrase ?? 8;

  // Section 16: the tonic is a destination, not a default.
  const barStarts = events.filter((e) => Math.abs(e.beat % 4) < 1e-6);
  const tonicStarts = barStarts.filter((e) => e.pitch % 12 === tonic).length;
  if (barStarts.length >= 4 && tonicStarts / barStarts.length > 0.5) {
    findings.push({
      severity: 'warn',
      message: `${tonicStarts} of ${barStarts.length} bars start on the tonic; MELODY.md 16 wants the tonic withheld as a destination, not used as a default.`,
    });
  }
  const tonicShare = events.filter((e) => e.pitch % 12 === tonic).length / events.length;
  if (tonicShare > 0.4) {
    findings.push({
      severity: 'info',
      message: `${Math.round(tonicShare * 100)}% of notes are the tonic; that weakens forward motion.`,
    });
  }

  // Section 7: target the new chord, and prefer its third or seventh to its root.
  const rootHits = events.filter((e) => {
    const index = Math.floor(e.beat / options.beatsPerChord) % options.chordRoots.length;
    return e.pitch % 12 === options.chordRoots[index]! % 12;
  }).length;
  if (rootHits / events.length > 0.4) {
    findings.push({
      severity: 'warn',
      message: `${rootHits} of ${events.length} notes land on the root of the chord beneath them; the third or seventh carries a chord's character better.`,
    });
  }

  // Section 7 again: the melody should move when the harmony does.
  const chordCount = Math.max(1, Math.floor(pattern.length_beats / options.beatsPerChord));
  const perChord: string[] = [];
  for (let c = 0; c < chordCount; c += 1) {
    const inChord = events.filter((e) => e.beat >= c * options.beatsPerChord && e.beat < (c + 1) * options.beatsPerChord);
    perChord.push([...new Set(inChord.map((e) => e.pitch))].sort((a, b) => a - b).join(','));
  }
  const distinct = new Set(perChord.filter(Boolean)).size;
  if (chordCount >= 3 && distinct === 1) {
    findings.push({
      severity: 'info',
      message: 'The melody uses identical pitches over every chord; that can be deliberate reharmonisation, but check it is a choice.',
    });
  }

  // Section 12: a phrase wants a shape, not one repeated contour.
  const contourOf = (bar: number) => {
    const inBar = events.filter((e) => e.beat >= bar * 4 && e.beat < bar * 4 + 4);
    if (inBar.length < 2) return '';
    const first = inBar[0]!.pitch;
    const last = inBar.at(-1)!.pitch;
    return last > first ? 'up' : last < first ? 'down' : 'flat';
  };
  const bars = Math.max(1, Math.round(pattern.length_beats / 4));
  const contours = new Set<string>();
  for (let b = 0; b < bars; b += 1) {
    const c = contourOf(b);
    if (c) contours.add(c);
  }
  if (bars >= barsPerPhrase && contours.size === 1) {
    findings.push({
      severity: 'info',
      message: `Every bar has the same ${[...contours][0]} contour; MELODY.md 10 and 12 want a phrase that asks and then answers.`,
    });
  }

  // Section 11: the last bar of a phrase is the valuable one.
  if (bars >= barsPerPhrase) {
    const lastBar = Math.floor((barsPerPhrase - 1));
    const a = events.filter((e) => e.beat >= 0 && e.beat < 4).map((e) => `${round6(e.beat)}:${e.pitch}`).join('|');
    const z = events
      .filter((e) => e.beat >= lastBar * 4 && e.beat < lastBar * 4 + 4)
      .map((e) => `${round6(e.beat - lastBar * 4)}:${e.pitch}`)
      .join('|');
    if (a && a === z) {
      findings.push({
        severity: 'info',
        message: `Bar ${barsPerPhrase} repeats bar 1 exactly; MELODY.md 11 keeps the final bar of a phrase for a fill, pickup or altered ending.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// MELODIC-TECHNO.md: the template motif and its variation order
// ---------------------------------------------------------------------------

interface GenreKnowledge {
  key: string;
  motif: { events: Array<{ beat: number; pitch: number; duration: number; velocity: number }> };
  chord_loop: { bars: Array<{ symbol: string; pitches: number[] }> };
  motif_variation_order: string[];
}

let melodicTechno: GenreKnowledge | null = null;

export function melodicTechnoKnowledge(): GenreKnowledge {
  if (!melodicTechno) {
    const path = fileURLToPath(new URL('../knowledge/melodic-techno.json', import.meta.url));
    melodicTechno = JSON.parse(readFileSync(path, 'utf8')) as GenreKnowledge;
  }
  return melodicTechno;
}

/** The two-bar motif, moved the shortest way from D to `root`, plus whole octaves. */
export function templateMotif(root?: string, octave = 0): Pattern {
  const k = melodicTechnoKnowledge();
  const up = root ? (pitchClass(root) - pitchClass(k.key) + 12) % 12 : 0;
  const shift = (up > 6 ? up - 12 : up) + 12 * octave;
  return { length_beats: 8, events: k.motif.events.map((e) => ({ beat: e.beat, pitch: e.pitch + shift, duration: e.duration, velocity: e.velocity })) };
}

export type MotifVariation = 'octave' | 'rhythm' | 'last_note' | 'velocity' | 'gate' | 'register';

/**
 * Vary a motif without rewriting it, in MELODIC-TECHNO.md's order: one note
 * up an octave, one note moved a 16th, the last note changed, the accents
 * reshaped, the gate changed, or the whole motif moved to another register.
 * (Timbre and delay, the other steps, are device moves, not note edits.)
 */
export function varyMotif(pattern: Pattern, kind: MotifVariation, options: { root: string; scale?: string; seed?: number }): Pattern {
  const random = makeRandom(options.seed ?? 1);
  const events = [...pattern.events].sort((a, b) => a.beat - b.beat).map((e) => ({ ...e }));
  if (!events.length) return pattern;
  const pick = 1 + Math.floor(random() * Math.max(1, events.length - 2));
  switch (kind) {
    case 'octave':
      events[pick]!.pitch += events[pick]!.pitch > 84 ? -12 : 12;
      break;
    case 'rhythm': {
      const e = events[pick]!;
      const prevEnd = events[pick - 1]!.beat + events[pick - 1]!.duration;
      const next = events[pick + 1]?.beat ?? pattern.length_beats;
      const later = e.beat + 0.25;
      if (later + Math.min(e.duration, 0.25) <= next) e.beat = round6(later);
      else if (e.beat - 0.25 >= prevEnd) e.beat = round6(e.beat - 0.25);
      e.duration = round6(Math.min(e.duration, next - e.beat));
      break;
    }
    case 'last_note': {
      const last = events.at(-1)!;
      const pool = scalePitches(options.root, options.scale ?? 'minor', last.pitch - 7, last.pitch + 7).filter((p) => p !== last.pitch);
      last.pitch = pool.sort((a, b) => Math.abs(a - last.pitch) - Math.abs(b - last.pitch))[Math.floor(random() * 2)] ?? last.pitch;
      break;
    }
    case 'velocity': {
      const mean = events.reduce((s, e) => s + e.velocity, 0) / events.length;
      for (const e of events) e.velocity = clampVelocity(2 * mean - e.velocity);
      break;
    }
    case 'gate': {
      const factor = random() < 0.5 ? 0.5 : 1.5;
      events.forEach((e, i) => {
        const next = events[i + 1]?.beat ?? pattern.length_beats;
        e.duration = round6(Math.max(0.06, Math.min(e.duration * factor, next - e.beat)));
      });
      break;
    }
    case 'register': {
      const shift = events[0]!.pitch > 72 ? -12 : 12;
      for (const e of events) e.pitch += shift;
      break;
    }
  }
  return { length_beats: pattern.length_beats, events };
}
