/**
 * GROOVE.md as code: classify each rhythmic part as anchor, groove or
 * ornament (section 15), and check the hierarchy - one stable anchor, exactly
 * one groove layer, the kick straight (sections 9, 22, 26).
 *
 * The classification is by onset pattern, not by name. A groove layer is
 * displaced against the pulse: its bar pattern does not repeat on the beat
 * and lands off it (3/16 spacing, 3-3-2 cells, syncopated stabs). A part
 * that repeats every beat reinforces the pulse even when it is busy - 16th
 * hats, an offbeat bass, a KBBB roll - so it is not a groove layer.
 * LFO rates are invisible here; a synced LFO that syncopates still has to be
 * counted by hand.
 */

import type { Timeline, TimelineTrack } from './timeline.js';

export type GrooveRole = 'anchor' | 'groove' | 'ornament' | 'straight' | 'silent';

export interface GrooveProfile {
  track: string;
  role: GrooveRole;
  /** Bars with onsets. */
  activeBars: number;
  /** Share of active bars whose pattern is displaced against the beat. */
  syncopatedShare: number;
  /** Share of successive onset gaps that are a dotted 8th (3/16). */
  dottedShare: number;
  /** Share of onsets on the beat. */
  onBeatShare: number;
  /** Median note length over the gap to the next onset. */
  gate: number | null;
}

export interface GrooveFinding {
  severity: 'warn' | 'info';
  message: string;
}

const STEPS = 16;

/** A bar's onsets as 16 steps (4/4). */
function barVectors(timeline: Timeline, track: TimelineTrack): Map<number, boolean[]> {
  const step = timeline.beatsPerBar / STEPS;
  const bars = new Map<number, boolean[]>();
  for (const n of track.notes) {
    const bar = Math.floor(n.start / timeline.beatsPerBar + 1e-6);
    const index = Math.round((n.start - bar * timeline.beatsPerBar) / step);
    if (index < 0 || index >= STEPS) continue;
    const v = bars.get(bar) ?? new Array<boolean>(STEPS).fill(false);
    v[index] = true;
    bars.set(bar, v);
  }
  return bars;
}

const rotate = (v: boolean[], by: number) => v.map((_, i) => v[(i + by) % v.length]!);
const same = (a: boolean[], b: boolean[]) => a.every((x, i) => x === b[i]);

/**
 * A bar is displaced when its pattern does not repeat on the beat and at least
 * two onsets fall off it. One stray off-beat hit is an ornament, not a groove.
 */
export function isDisplacedBar(v: boolean[]): boolean {
  if (same(v, rotate(v, 4))) return false;
  const offBeat = v.filter((on, i) => on && i % 4 !== 0).length;
  return offBeat >= 2;
}

export function grooveProfile(timeline: Timeline, track: TimelineTrack): GrooveProfile {
  const vectors = barVectors(timeline, track);
  const active = [...vectors.values()];
  const displaced = active.filter(isDisplacedBar).length;
  const onsets = [...new Set(track.notes.map((n) => Math.round(n.start * 4) / 4))].sort((a, b) => a - b);
  let dotted = 0;
  for (let i = 1; i < onsets.length; i += 1) if (Math.abs(onsets[i]! - onsets[i - 1]! - 0.75) < 0.02) dotted += 1;
  const onBeat = onsets.filter((t) => Math.abs(t - Math.round(t)) < 0.02).length;

  const gates: number[] = [];
  const notes = [...track.notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i < notes.length - 1; i += 1) {
    const gap = notes[i + 1]!.start - notes[i]!.start;
    if (gap > 1e-6 && gap <= timeline.beatsPerBar) gates.push(notes[i]!.duration / gap);
  }
  gates.sort((a, b) => a - b);

  const syncopatedShare = active.length ? displaced / active.length : 0;
  let role: GrooveRole;
  if (!active.length) role = 'silent';
  else if (track.role === 'kick') role = 'anchor';
  else if (syncopatedShare >= 0.5) role = 'groove';
  else if (syncopatedShare >= 0.1) role = 'ornament';
  else role = 'straight';

  return {
    track: track.name,
    role,
    activeBars: active.length,
    syncopatedShare: round2(syncopatedShare),
    dottedShare: round2(onsets.length > 1 ? dotted / (onsets.length - 1) : 0),
    onBeatShare: round2(onsets.length ? onBeat / onsets.length : 0),
    gate: gates.length ? round2(gates[Math.floor(gates.length / 2)]!) : null,
  };
}

/** Sections 9, 15, 22 and 26: one stable anchor, exactly one groove layer. */
export function checkGroove(timeline: Timeline): { profiles: GrooveProfile[]; findings: GrooveFinding[] } {
  const profiles = timeline.tracks.filter((t) => t.notes.length).map((t) => grooveProfile(timeline, t));
  const findings: GrooveFinding[] = [];
  const grooves = profiles.filter((p) => p.role === 'groove');

  if (grooves.length > 1) {
    findings.push({
      severity: 'warn',
      message: `${grooves.length} groove layers: ${grooves.map((g) => `${g.track} (${pct(g.syncopatedShare)} of bars displaced)`).join(', ')}. GROOVE.md wants one: "if everything is syncopated, nothing sounds syncopated". Keep the strongest, straighten or thin the others - unless the brief asks for more.`,
    });
  } else if (!grooves.length) {
    findings.push({
      severity: 'info',
      message: 'No part is displaced against the beat. That is fine if intended; GROOVE.md 15 says a healthy arrangement normally has an anchor, a groove and ornaments.',
    });
  }

  for (const kick of timeline.tracks.filter((t) => t.role === 'kick' && t.notes.length)) {
    const off = kick.notes.filter((n) => Math.abs(n.start - Math.round(n.start)) > 0.02).length;
    if (off / kick.notes.length > 0.05) {
      findings.push({
        severity: 'warn',
        message: `${kick.name}: ${off} of ${kick.notes.length} hits are off the beat. GROOVE.md 9: keep the kick predictable and let another part move.`,
      });
    }
  }

  for (const g of grooves) {
    if (g.gate !== null && g.gate >= 0.95) {
      findings.push({
        severity: 'info',
        message: `${g.track}: notes fill ${pct(g.gate)} of the gap to the next onset. GROOVE.md 4 and 22: note length shorter than spacing leaves room for the groove.`,
      });
    }
  }
  return { profiles, findings };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 100)} %`;
