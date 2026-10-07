/**
 * EMOTION.md as code: the parts of sections 53-56 that can be measured from
 * the notes, and NEW-TRACK-DETAILED.md 22's 8-bar change rule.
 *
 * - 55, protect the peak: the highest note, the largest chord, the densest
 *   bar and the most layers should not be spent before the peak;
 * - 56, withholding: kick and bass taken away somewhere in the body of the
 *   track, so their return means something;
 * - 53, three levers: at each section change, how many independent
 *   dimensions move (layers, density, top, bottom, velocity);
 * - NEW-TRACK-DETAILED 22: an 8-bar boundary with no audible delta is fine,
 *   several in a row means the arrangement may be static.
 *
 * Surprise (54), the emotional sentence (3) and the arc (4) are judgement;
 * this module only supplies the evidence.
 */

import { barOf, onsetsPerBar, type Timeline } from './timeline.js';

export interface BlockFeatures {
  /** First bar of the block. */
  bar: number;
  layers: string[];
  onsets: number;
  top: number | null;
  bottom: number | null;
  velocity: number | null;
}

export interface EmotionFinding {
  severity: 'warn' | 'info';
  message: string;
}

/** What plays in each block of `size` bars. */
export function blockFeatures(timeline: Timeline, size = 8): BlockFeatures[] {
  const blocks: BlockFeatures[] = [];
  for (let first = 1; first <= timeline.bars; first += size) {
    const from = (first - 1) * timeline.beatsPerBar;
    const to = from + size * timeline.beatsPerBar;
    const layers: string[] = [];
    let onsets = 0, top: number | null = null, bottom: number | null = null, velocitySum = 0;
    for (const track of timeline.tracks) {
      const notes = track.notes.filter((n) => n.start >= from - 1e-6 && n.start < to - 1e-6);
      if (!notes.length) continue;
      layers.push(track.name);
      onsets += notes.length;
      for (const n of notes) {
        velocitySum += n.velocity;
        if (track.pitched) {
          top = top === null ? n.pitch : Math.max(top, n.pitch);
          bottom = bottom === null ? n.pitch : Math.min(bottom, n.pitch);
        }
      }
    }
    blocks.push({ bar: first, layers, onsets, top, bottom, velocity: onsets ? Math.round(velocitySum / onsets) : null });
  }
  return blocks;
}

/** The peak: the given bars, or the 16-bar span with the most layers (the later one on a tie). */
export function findPeak(timeline: Timeline, given?: { from: number; to: number }): { from: number; to: number } {
  if (given) return given;
  const blocks = blockFeatures(timeline, 16);
  let best = blocks[0];
  for (const b of blocks) if (best && (b.layers.length > best.layers.length || (b.layers.length === best.layers.length && b.onsets >= best.onsets))) best = b;
  const from = best?.bar ?? 1;
  return { from, to: Math.min(timeline.bars, from + 15) };
}

/** Largest number of distinct pitched notes sounding at once, and where it first happens. */
function largestChord(timeline: Timeline): { size: number; bar: number } | null {
  const notes = timeline.tracks
    .filter((t) => t.pitched && t.role !== 'bass')
    .flatMap((t) => t.notes)
    .sort((a, b) => a.start - b.start);
  let best: { size: number; bar: number } | null = null;
  let active: typeof notes = [];
  for (let i = 0; i < notes.length; ) {
    const t = notes[i]!.start;
    while (i < notes.length && notes[i]!.start <= t + 1e-6) active.push(notes[i++]!);
    active = active.filter((n) => n.start + n.duration > t + 1e-6);
    const size = new Set(active.map((n) => n.pitch)).size;
    if (!best || size > best.size) best = { size, bar: barOf(timeline, t) };
  }
  return best;
}

export function checkEmotion(
  timeline: Timeline,
  options: { peak?: { from: number; to: number }; introBars?: number; outroBars?: number } = {},
): { peak: { from: number; to: number }; blocks: BlockFeatures[]; findings: EmotionFinding[] } {
  const findings: EmotionFinding[] = [];
  const peak = findPeak(timeline, options.peak);
  const blocks = blockFeatures(timeline, 8);
  const before = (bar: number) => bar < peak.from;

  // 55: protect the peak.
  const pitched = timeline.tracks.filter((t) => t.pitched && t.notes.length);
  const allPitched = pitched.flatMap((t) => t.notes.map((n) => ({ ...n, track: t.name })));
  if (allPitched.length) {
    const highest = Math.max(...allPitched.map((n) => n.pitch));
    const first = allPitched.filter((n) => n.pitch === highest).sort((a, b) => a.start - b.start)[0]!;
    const bar = barOf(timeline, first.start);
    if (before(bar)) {
      findings.push({
        severity: 'warn',
        message: `The highest note (MIDI ${highest}, ${first.track}) first sounds at bar ${bar}, before the peak at bars ${peak.from}-${peak.to}. EMOTION 55: save it for the climax.`,
      });
    }
  }
  const chord = largestChord(timeline);
  if (chord && chord.size > 1 && before(chord.bar)) {
    findings.push({
      severity: 'info',
      message: `The largest chord (${chord.size} pitches at once) first sounds at bar ${chord.bar}, before the peak at bar ${peak.from}. EMOTION 55: the largest chord is a peak resource.`,
    });
  }
  const perBar = new Array<number>(timeline.bars).fill(0);
  for (const t of timeline.tracks) onsetsPerBar(timeline, t).forEach((n, i) => (perBar[i]! += n));
  const densest = Math.max(...perBar);
  const densestBar = perBar.indexOf(densest) + 1;
  if (densest > 0 && before(densestBar)) {
    findings.push({
      severity: 'info',
      message: `The busiest bar (${densest} onsets) is bar ${densestBar}, before the peak at bar ${peak.from}. EMOTION 55: maximum rhythmic density is a peak resource.`,
    });
  }
  const mostLayers = Math.max(...blocks.map((b) => b.layers.length));
  const firstMost = blocks.find((b) => b.layers.length === mostLayers);
  if (firstMost && before(firstMost.bar) && firstMost.bar + 8 <= peak.from) {
    findings.push({
      severity: 'info',
      message: `All ${mostLayers} layers already play at bars ${firstMost.bar}-${firstMost.bar + 7}, before the peak at bar ${peak.from}. EMOTION 55, ORCHESTRAL 46: a climax cannot feel large if everything was large before it.`,
    });
  }

  // 56: withholding the kick and the bass in the body of the track.
  const intro = options.introBars ?? 32;
  const outro = options.outroBars ?? 32;
  for (const role of ['kick', 'bass']) {
    const tracks = timeline.tracks.filter((t) => t.role === role && t.notes.length);
    if (!tracks.length) continue;
    const playing = new Set<number>();
    for (const t of tracks) onsetsPerBar(timeline, t).forEach((n, i) => n > 0 && playing.add(i + 1));
    let run = 0, longest = 0;
    for (let bar = intro + 1; bar <= timeline.bars - outro; bar += 1) {
      run = playing.has(bar) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    // Only where the body between the DJ intro and outro is long enough to withhold anything in.
    if (timeline.bars - outro - intro >= 16 && longest < 8) {
      findings.push({
        severity: 'info',
        message: `The ${role} is never out for 8 bars or more between bar ${intro + 1} and bar ${timeline.bars - outro}. EMOTION 56: withhold something the listener wants, then return it.`,
      });
    }
  }

  // 53: levers at each section change; NEW-TRACK-DETAILED 22: static stretches.
  let still = 0;
  for (let i = 1; i < blocks.length; i += 1) {
    const a = blocks[i - 1]!, b = blocks[i]!;
    const levers: string[] = [];
    const entered = b.layers.filter((l) => !a.layers.includes(l));
    const left = a.layers.filter((l) => !b.layers.includes(l));
    if (entered.length || left.length) levers.push('layers');
    if (a.onsets && Math.abs(b.onsets - a.onsets) / a.onsets >= 0.25) levers.push('density');
    if (a.top !== null && b.top !== null && Math.abs(b.top - a.top) >= 3) levers.push('top');
    if ((a.bottom === null) !== (b.bottom === null) || (a.bottom !== null && b.bottom !== null && Math.abs(b.bottom - a.bottom) >= 3)) levers.push('bottom');
    if (a.velocity !== null && b.velocity !== null && Math.abs(b.velocity - a.velocity) >= 8) levers.push('velocity');

    const section = (b.bar - 1) % 16 === 0 && (entered.length + left.length >= 2);
    if (section && levers.length < 3) {
      findings.push({
        severity: 'info',
        message: `Bar ${b.bar}: a section change (${[...entered.map((l) => `+${l}`), ...left.map((l) => `-${l}`)].join(' ')}) moves ${levers.length} lever${levers.length === 1 ? '' : 's'} (${levers.join(', ') || 'none'}). EMOTION 53: change at least three dimensions for an emotional change.`,
      });
    }
    still = levers.length ? 0 : still + 1;
    if (still === 3) {
      findings.push({
        severity: 'info',
        message: `No audible delta at bars ${b.bar - 16}, ${b.bar - 8} and ${b.bar}: no layer, density, register or velocity change. NEW-TRACK-DETAILED 22: fine if the groove's hypnosis needs it, otherwise the arrangement is static.`,
      });
    }
  }
  return { peak, blocks, findings };
}
