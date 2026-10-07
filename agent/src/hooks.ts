/**
 * HOOKS.md as code: the measurable half of the hook audit (section 42).
 *
 * - the arrangement map (41): first hint, first full appearance, where it is
 *   removed and where it returns;
 * - introduce, remove, return (11): is it gone long enough to be missed;
 * - hook length (18): the repeating nucleus should be four bars or shorter;
 * - repetition versus variation (12, 33, 36): about 80 % identity per return;
 * - register against the sustained parts: a hook that plays the pad's own
 *   notes fuses into it (AGENTS.md *Leads*, Threshold v3);
 * - every other pitched part that quotes the hook's cell - teases and
 *   callbacks to check, or a second hook competing with it (9, 34).
 *
 * What the hook is, whether it can be described in a sentence, remembered or
 * hummed, is judgement and the user's listening tests; this module does not
 * pretend to answer it.
 */

import { activitySpans, barOf, type Timeline, type TimelineNote, type TimelineTrack } from './timeline.js';

export interface HookMap {
  track: string;
  firstHint: number | null;
  firstFull: number | null;
  spans: Array<{ from: number; to: number }>;
  removedAt: number | null;
  returnsAt: number | null;
  /** Bars in the repeating nucleus, or null if none within four bars. */
  nucleusBars: number | null;
  /** Median share of the nucleus kept on each return of it. */
  identity: number | null;
}

export interface HookFinding {
  severity: 'warn' | 'info';
  message: string;
}

const STEP = 0.25;

type Event = string; // "step:pitch" within a bar

function barEvents(timeline: Timeline, notes: TimelineNote[]): Map<number, Set<Event>> {
  const bars = new Map<number, Set<Event>>();
  for (const n of notes) {
    const bar = barOf(timeline, n.start);
    const step = Math.round((n.start - (bar - 1) * timeline.beatsPerBar) / STEP);
    const set = bars.get(bar) ?? new Set<Event>();
    set.add(`${step}:${n.pitch}`);
    bars.set(bar, set);
  }
  return bars;
}

const jaccard = (a: Set<Event>, b: Set<Event>) => {
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((x) => b.has(x)).length / union.size;
};

/** The smallest of 1, 2 or 4 bars that the part mostly repeats at. */
export function nucleusLength(bars: Map<number, Set<Event>>, from: number, to: number): number | null {
  for (const period of [1, 2, 4]) {
    let compared = 0, equal = 0;
    for (let bar = from + period; bar <= to; bar += 1) {
      const a = bars.get(bar), b = bars.get(bar - period);
      if (!a || !b) continue;
      compared += 1;
      if (jaccard(a, b) >= 0.8) equal += 1;
    }
    if (compared >= period && equal / compared >= 0.75) return period;
  }
  return null;
}

export function hookMap(timeline: Timeline, hook: TimelineTrack): HookMap {
  const spans = activitySpans(timeline, hook, 4);
  const bars = barEvents(timeline, hook.notes);
  const counts = [...bars.entries()].map(([bar, set]) => ({ bar, n: set.size }));
  const sorted = counts.map((c) => c.n).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const full = counts.filter((c) => c.n >= median * 0.5).map((c) => c.bar).sort((a, b) => a - b);
  const firstFull = full[0] ?? null;
  const firstHint = counts.length ? Math.min(...counts.map((c) => c.bar)) : null;

  let removedAt: number | null = null, returnsAt: number | null = null;
  if (firstFull !== null) {
    const index = spans.findIndex((s) => s.to >= firstFull);
    if (index >= 0 && index < spans.length - 1) {
      removedAt = spans[index]!.to + 1;
      returnsAt = spans[index + 1]!.from;
    }
  }

  let nucleusBars: number | null = null;
  let identity: number | null = null;
  const main = spans.find((s) => firstFull !== null && s.to >= firstFull);
  if (main && firstFull !== null) {
    nucleusBars = nucleusLength(bars, firstFull, main.to);
    if (nucleusBars) {
      const shares: number[] = [];
      for (const span of spans) {
        for (let bar = Math.max(span.from, firstFull); bar <= span.to; bar += 1) {
          const offset = (bar - firstFull) % nucleusBars;
          const reference = bars.get(firstFull + offset);
          const here = bars.get(bar);
          if (reference && here && bar >= firstFull + nucleusBars) shares.push(jaccard(reference, here));
        }
      }
      shares.sort((a, b) => a - b);
      identity = shares.length ? Math.round(shares[Math.floor(shares.length / 2)]! * 100) / 100 : null;
    }
  }
  return { track: hook.name, firstHint, firstFull, spans, removedAt, returnsAt, nucleusBars, identity };
}

/** Parts that hold notes: chords and pads, strings, or anything whose median note lasts a beat. */
function isSustained(track: TimelineTrack): boolean {
  if (track.role === 'chords') return true;
  if (/\b(pads?|strings?|choir|organ|drone|violins?|violas?|cellos?|ensemble)\b/i.test(track.name)) return true;
  const lengths = track.notes.map((n) => n.duration).sort((a, b) => a - b);
  return lengths.length > 0 && lengths[Math.floor(lengths.length / 2)]! >= 1;
}

/** The hook's opening cell: up to five onsets as (gap in steps, interval). */
function cellOf(notes: TimelineNote[], from: number): Array<{ gap: number; interval: number }> | null {
  const line = topLine(notes.filter((n) => n.start >= from)).slice(0, 5);
  if (line.length < 3) return null;
  return line.slice(1).map((n, i) => ({ gap: Math.round((n.start - line[i]!.start) / STEP), interval: n.pitch - line[i]!.pitch }));
}

function topLine(notes: TimelineNote[]): TimelineNote[] {
  const byStart = new Map<number, TimelineNote>();
  for (const n of notes) {
    const current = byStart.get(n.start);
    if (!current || n.pitch > current.pitch) byStart.set(n.start, n);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** Bars where `track` plays the cell (any transposition), at most one per bar. */
export function findCell(timeline: Timeline, track: TimelineTrack, cell: Array<{ gap: number; interval: number }>): number[] {
  const line = topLine(track.notes);
  const found = new Set<number>();
  for (let i = 0; i + cell.length < line.length; i += 1) {
    let match = true;
    for (let k = 0; k < cell.length; k += 1) {
      const a = line[i + k]!, b = line[i + k + 1]!;
      if (Math.round((b.start - a.start) / STEP) !== cell[k]!.gap || b.pitch - a.pitch !== cell[k]!.interval) {
        match = false;
        break;
      }
    }
    if (match) found.add(barOf(timeline, line[i]!.start));
  }
  return [...found].sort((a, b) => a - b);
}

export function checkHook(timeline: Timeline, hook: TimelineTrack): { map: HookMap; findings: HookFinding[] } {
  const map = hookMap(timeline, hook);
  const findings: HookFinding[] = [];

  if (map.firstFull === null) {
    return { map, findings: [{ severity: 'warn', message: `${hook.name} has no notes in the Arrangement.` }] };
  }
  if (map.removedAt === null) {
    findings.push({
      severity: 'warn',
      message: `${hook.name} is never removed after it arrives at bar ${map.firstFull}. HOOKS 11: introduce, remove, return - the absence of the hook is part of the arrangement.`,
    });
  } else if (map.returnsAt !== null && map.returnsAt - map.removedAt < 8) {
    findings.push({
      severity: 'info',
      message: `${hook.name} is out for ${map.returnsAt - map.removedAt} bars (bars ${map.removedAt}-${map.returnsAt - 1}). HOOKS 11 and 42: is that long enough to be missed?`,
    });
  }
  if (map.nucleusBars === null) {
    findings.push({
      severity: 'warn',
      message: `${hook.name} does not repeat within four bars from bar ${map.firstFull}. HOOKS 18: if the listener needs eight bars to identify it, find the smaller motif inside.`,
    });
  }
  if (map.identity !== null && map.identity < 0.6) {
    findings.push({
      severity: 'warn',
      message: `${hook.name} keeps ${Math.round(map.identity * 100)} % of its nucleus on a typical return. HOOKS 12 and 36: keep about 80 % of the identity, vary about 20 %.`,
    });
  }

  // Register against the sustained parts.
  const sustained = timeline.tracks.filter((t) => t !== hook && t.pitched && t.notes.length && isSustained(t));
  if (sustained.length && hook.notes.length) {
    const shared = hook.notes.filter((h) =>
      sustained.some((t) => t.notes.some((n) => n.pitch === h.pitch && n.start <= h.start + 1e-6 && n.start + n.duration > h.start + 1e-6)),
    ).length;
    const share = shared / hook.notes.length;
    if (share > 0.3) {
      findings.push({
        severity: 'warn',
        message: `${Math.round(share * 100)} % of ${hook.name}'s notes are pitches a sustained part (${sustained.map((t) => t.name).join(', ')}) is holding at that moment. A hook that plays the pad's own notes fuses into it (AGENTS.md *Leads*, Threshold v3): move it clear of their register.`,
      });
    }
  }

  // Other parts quoting the hook's cell.
  const cell = cellOf(hook.notes, (map.firstFull - 1) * timeline.beatsPerBar);
  if (cell) {
    for (const other of timeline.tracks.filter((t) => t !== hook && t.pitched && t.notes.length)) {
      const bars = findCell(timeline, other, cell);
      if (bars.length) {
        findings.push({
          severity: 'info',
          message: `${other.name} quotes ${hook.name}'s opening cell at ${summariseBars(bars)}. Intended tease or callback, or a second hook (HOOKS 9, 34)? When the hook changes, these have to change with it.`,
        });
      }
    }
  }
  return { map, findings };
}

export function summariseBars(bars: number[], max = 6): string {
  const shown = bars.slice(0, max).map((b) => `bar ${b}`).join(', ');
  return bars.length > max ? `${shown} and ${bars.length - max} more` : shown;
}
