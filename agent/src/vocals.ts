/**
 * Electronic vocals (ABLETON_VOCALS_EXPERT.md), the parts the API can act
 * on: vocal chops written as MIDI for a Simpler holding a vocal fragment,
 * a checker built from the document's "chop sounds random" decision tree,
 * and a vocal plan that maps its hook transformation ladder and section
 * logic onto an arrangement. Comping, warping, tuning, clip gain and audio
 * reversal are not available through the Live API.
 */

import { clampVelocity, makeRandom, pitchClass, round6, scalePitches } from './music-theory.js';
import type { Pattern, PatternEvent } from './patterns.js';
import { motifRhythm } from './melody.js';
import { sectionFunction, type PlannedSection } from './arrangement.js';

export interface ChopOptions {
  root: string;
  scale?: string;
  bars?: number;
  /** Onsets per bar in the chop motif (default 4; the document warns against filling every 16th). */
  hits?: number;
  /** Pitch the chop phrase centres on; default the tonic nearest middle C. */
  register?: number;
  seed?: number;
}

/**
 * A chop phrase: a recognisable anchor note, one repeated rhythmic motif
 * plus an answer, at most four pitches, space between events, and a changed
 * ending on the fourth bar.
 */
export function vocalChop(options: ChopOptions): Pattern {
  const random = makeRandom(options.seed ?? 1);
  const bars = options.bars ?? 4;
  const scale = options.scale ?? 'minor';
  const centre = options.register ?? 60;
  const pool = scalePitches(options.root, scale, centre - 12, centre + 12);
  const tonic = pitchClass(options.root);
  const anchor = pool.filter((p) => p % 12 === tonic).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0]!;
  const i = pool.indexOf(anchor);
  // Four pitches at most: anchor, a step either side, and a third above for the changed ending.
  const set = { anchor, up: pool[i + 1]!, down: pool[i - 1]!, lift: pool[i + 2]! };
  const rhythmA = motifRhythm(Math.min(6, Math.max(2, options.hits ?? 4)), options.seed ?? 1);
  // The answer moves one onset; the identity stays.
  const rhythmB = rhythmA.map((s, k) => (k === rhythmA.length - 1 ? Math.min(15, s + 1) : s));
  const contour = rhythmA.map((_, k) => (k === 0 ? 'anchor' : random() < 0.5 ? 'up' : random() < 0.5 ? 'down' : 'anchor')) as Array<'anchor' | 'up' | 'down'>;

  const events: PatternEvent[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const answer = bar % 4 === 3;
    const rhythm = answer ? rhythmB : rhythmA;
    rhythm.forEach((step, k) => {
      const beat = bar * 4 + step * 0.25;
      let pitch = set[contour[k]!];
      if (answer && k === rhythm.length - 1) pitch = set.lift;
      const next = rhythm[k + 1] ?? 16;
      events.push({
        beat: round6(beat),
        pitch,
        duration: round6(Math.min(0.5, (next - step) * 0.25 * 0.8)),
        velocity: clampVelocity((k === 0 ? 108 : 92) + (random() * 6 - 3)),
      });
    });
  }
  return { length_beats: bars * 4, events };
}

export interface ChopFinding {
  severity: 'info' | 'warn';
  message: string;
}

/** ABLETON_VOCALS_EXPERT.md: a chop sounds random without a motif, an anchor, few pitches and space. */
export function checkChops(pattern: Pattern): ChopFinding[] {
  const findings: ChopFinding[] = [];
  const events = pattern.events;
  if (!events.length) return [{ severity: 'warn', message: 'No chops.' }];
  const bars = Math.max(1, Math.round(pattern.length_beats / 4));
  const pitches = new Map<number, number>();
  for (const e of events) pitches.set(e.pitch, (pitches.get(e.pitch) ?? 0) + 1);
  if (pitches.size > 4) findings.push({ severity: 'warn', message: `${pitches.size} different pitches; a chop phrase reads best with a few, around an anchor.` });
  const anchorShare = Math.max(...pitches.values()) / events.length;
  if (anchorShare < 0.3) findings.push({ severity: 'warn', message: 'No anchor note: no pitch carries at least 30% of the chops.' });
  if (events.length / bars > 8) findings.push({ severity: 'warn', message: `${(events.length / bars).toFixed(0)} chops a bar: too many syllables; leave space.` });
  const occupied = new Set(events.map((e) => Math.round(e.beat * 4))).size;
  if (occupied / (bars * 16) > 0.5) findings.push({ severity: 'warn', message: 'More than half the 16ths are filled; negative space is what makes a chop phrase speak.' });
  const shapes = Array.from({ length: bars }, (_, b) =>
    events.filter((e) => e.beat >= b * 4 && e.beat < b * 4 + 4).map((e) => Math.round((e.beat - b * 4) * 4)).join(','),
  );
  if (bars > 1 && new Set(shapes).size === bars) findings.push({ severity: 'warn', message: 'No repeated rhythmic motif: every bar has a different rhythm.' });
  return findings;
}

export interface VocalCue {
  section: string;
  startBar: number;
  treatment: string;
  /** Step of the hook transformation ladder this section uses, 1-9. */
  ladder: number | null;
}

const LADDER = [
  'distant filtered teaser',
  'clear dry phrase',
  'phrase with harmony',
  'final-word echo',
  'chopped version',
  'pitched version in the build',
  'hook removed at the drop impact',
  'hook returns as rhythmic fragments',
  'full phrase returns in the final breakdown or chorus',
];

/**
 * Where the vocal appears, disappears and changes across an arrangement,
 * following the document's section logic and its hook ladder. The vocal is
 * held back in the intro, fullest in the breakdown, fragmented at drops and
 * richest at the end.
 */
export function vocalPlan(sections: PlannedSection[]): VocalCue[] {
  const peaks = sections.filter((s) => sectionFunction(s.name) === 'peak');
  const lastPeak = peaks.at(-1);
  let breaks = 0;
  return sections.map((s) => {
    const fn = sectionFunction(s.name);
    const cue = (treatment: string, ladder: number | null): VocalCue => ({ section: s.name, startBar: s.startBar, treatment, ladder });
    switch (fn) {
      case 'intro':
        return cue(`${LADDER[0]}: a single distant word or an atmosphere derived from the vocal; do not reveal the hook`, 1);
      case 'build':
        return s.energy >= 0.6
          ? cue(`${LADDER[5]}: shortened phrase, repeated word, rising reverb and delay feedback, accelerating stutter, a reverse swell into the drop`, 6)
          : cue(`${LADDER[1]}: the phrase clear and dry, once`, 2);
      case 'peak':
        return s === lastPeak
          ? cue('richest version: an extra double, a harmony, a changed delay throw and a different final-word treatment', 9)
          : cue(`${LADDER[6]}, then ${LADDER[7]}; let the synth lead answer the vocal`, 7);
      case 'break':
        breaks += 1;
        return cue(
          breaks === 1
            ? `fullest lyric, exposed and emotional; ${LADDER[2]}, wider harmonies, larger space, delay throw on the final word`
            : `${LADDER[4]}; a low-formant shadow under the line`,
          breaks === 1 ? 3 : 5,
        );
      case 'outro':
        return cue('no vocal, or filtered fragments thinning out', null);
      default:
        return cue('vocal optional here', null);
    }
  });
}
