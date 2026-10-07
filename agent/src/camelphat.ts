/**
 * CAMELPHAT.md section 6, "Checks, as numbers": a lead measured against the
 * TPS x CamelPhat pack's 34 lead files. The line is measured against its own
 * anchor - its most-played pitch - never against a guessed key (AGENTS.md
 * Gotchas: a key-finder on a single line is circular).
 *
 * The numbers catch a bad lead; they do not make a good one (AGENTS.md
 * *Leads*, step 6). Hook, meaning, register and expression come first.
 */

import type { Note } from '../../bridge/src/protocol.js';

export interface LeadCheck {
  check: string;
  value: string;
  pass: boolean;
  rule: string;
}

const STEPS_332 = new Set([0, 3, 6, 8, 11, 14]);
const STEPS_DOTTED = new Set([0, 3, 6, 9, 12, 15]);

/**
 * `notes` in one time base (a clip's, or arrangement beats). Loops are the
 * units the pack was measured in: pass each clip's notes separately when the
 * part is made of several loops, or the whole part for a single one.
 */
export function checkLeadNumbers(notes: Note[] | Array<{ pitch: number; start: number; duration: number }>, beatsPerBar = 4): LeadCheck[] {
  const line = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  if (!line.length) return [];
  const step = beatsPerBar / 16;
  const barOf = (t: number) => Math.floor(t / beatsPerBar + 1e-6);
  const stepOf = (t: number) => Math.round((t - barOf(t) * beatsPerBar) / step) % 16;

  // Anchor: the most-played pitch.
  const counts = new Map<number, number>();
  for (const n of line) counts.set(n.pitch, (counts.get(n.pitch) ?? 0) + 1);
  const anchor = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];

  // Per bar: onsets, rhythm vector, downbeat note.
  const bars = new Map<number, { onsets: number; rhythm: string[]; downbeat: number | null }>();
  for (const n of line) {
    const b = barOf(n.start);
    const entry = bars.get(b) ?? { onsets: 0, rhythm: new Array<string>(16).fill('.'), downbeat: null };
    const s = stepOf(n.start);
    if (entry.rhythm[s] === '.') entry.onsets += 1;
    entry.rhythm[s] = 'x';
    if (s === 0 && entry.downbeat === null) entry.downbeat = n.pitch;
    bars.set(b, entry);
  }
  const perBar = [...bars.values()].map((b) => b.onsets).sort((a, b) => a - b);
  const medianOnsets = perBar[Math.floor(perBar.length / 2)]!;
  const withDownbeat = [...bars.values()].filter((b) => b.downbeat !== null);
  const downbeatAnchor = withDownbeat.filter((b) => b.downbeat === anchor).length;
  const rhythms = new Set([...bars.values()].map((b) => b.rhythm.join('')));

  // Onsets (one per time position) on the 3-3-2 or dotted steps.
  const starts = [...new Set(line.map((n) => n.start))];
  const on332 = starts.filter((t) => STEPS_332.has(stepOf(t))).length / starts.length;
  const onDotted = starts.filter((t) => STEPS_DOTTED.has(stepOf(t))).length / starts.length;

  // Pitch: distinct, range, register; the top line when notes stack.
  const pitches = line.map((n) => n.pitch);
  const low = Math.min(...pitches);
  const high = Math.max(...pitches);
  const top = starts.sort((a, b) => a - b).map((t) => Math.max(...line.filter((n) => n.start === t).map((n) => n.pitch)));

  // Leaps of 5+ semitones that continue the previous interval's direction.
  let leaps = 0, chained = 0;
  for (let i = 1; i < top.length; i += 1) {
    const interval = top[i]! - top[i - 1]!;
    if (Math.abs(interval) < 5) continue;
    leaps += 1;
    const before = i > 1 ? top[i - 1]! - top[i - 2]! : 0;
    if (before !== 0 && Math.sign(before) === Math.sign(interval)) chained += 1;
  }

  // Note length where the next onset is a dotted 8th away.
  const dottedLengths: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    const next = line.find((n) => n.start > line[i]!.start + 1e-6);
    if (next && Math.abs(next.start - line[i]!.start - 3 * step) < 0.02) dottedLengths.push(line[i]!.duration / step);
  }
  dottedLengths.sort((a, b) => a - b);
  const dottedLength = dottedLengths.length ? dottedLengths[Math.floor(dottedLengths.length / 2)]! : null;

  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const anchorShare = (counts.get(anchor) ?? 0) / line.length;
  const checks: LeadCheck[] = [
    { check: 'Onsets a bar', value: `${medianOnsets} (median)`, pass: medianOnsets >= 2 && medianOnsets <= 6, rule: '2-6' },
    { check: 'Anchor share', value: `${pct(anchorShare)} (anchor MIDI ${anchor})`, pass: anchorShare >= 0.33, rule: '>= 33 % (pack median 50 %)' },
    {
      check: 'Downbeat note is the anchor',
      value: withDownbeat.length ? `${downbeatAnchor} of ${withDownbeat.length} bars` : 'no downbeat notes',
      pass: withDownbeat.length > 0 && downbeatAnchor / withDownbeat.length > 0.5,
      rule: 'in most bars',
    },
    {
      check: 'On the 3-3-2 / dotted steps',
      value: `${pct(on332)} on 3-3-2, ${pct(onDotted)} on dotted`,
      pass: Math.max(on332, onDotted) >= 0.57,
      rule: '>= 57 %',
    },
    { check: 'Distinct rhythms across the loop', value: String(rhythms.size), pass: rhythms.size <= 2, rule: '<= 2' },
    { check: 'Distinct pitches', value: String(counts.size), pass: counts.size <= 6, rule: '<= 6' },
    { check: 'Range', value: `${high - low} semitones`, pass: high - low <= 12, rule: '<= 12 semitones' },
    {
      check: 'Leaps that chain in one direction',
      value: leaps ? `${chained} of ${leaps} (${pct(chained / leaps)})` : 'no leaps',
      pass: !leaps || chained / leaps < 0.15,
      rule: '< 15 % (pack 7 %)',
    },
    {
      check: 'Register',
      value: `lowest MIDI ${low}, highest MIDI ${high}`,
      pass: low >= 53 && low <= 60 && high >= 60 && high <= 67,
      rule: 'lowest 53-60, highest 60-67',
    },
    {
      check: 'Note length at a dotted-8th gap',
      value: dottedLength === null ? 'no dotted-8th gaps' : `${Math.round(dottedLength * 100) / 100} 16ths (median)`,
      pass: dottedLength === null || (dottedLength >= 1 && dottedLength <= 2),
      rule: '1-2 16ths',
    },
  ];
  return checks;
}
