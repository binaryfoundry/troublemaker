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

import { doublesTrack, type Timeline, type TimelineTrack } from './timeline.js';

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
  /** A groove part that doubles or quotes another's rhythm: that part's name. */
  follows?: string;
  /** A pitch cycle of this many notes turning against the beat. */
  cycle?: number;
  /** Mostly on 8th-note-triplet positions, against the straight grid. */
  triplets?: boolean;
  /** A velocity-accent cycle of this many notes turning against the beat. */
  accentCycle?: number;
}

export interface GrooveFinding {
  severity: 'warn' | 'info';
  message: string;
}

/** 48 steps a bar: 16ths and 8th-note triplets both land exactly. */
const STEPS = 48;

/** A bar's onsets on the 48-step grid (4/4). */
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
 * Works on any grid that divides the bar into four beats.
 */
export function isDisplacedBar(v: boolean[]): boolean {
  const beat = v.length / 4;
  if (same(v, rotate(v, beat))) return false;
  const offBeat = v.filter((on, i) => on && i % beat !== 0).length;
  return offBeat >= 2;
}

/**
 * A pitch cycle that turns against the beat: a stream of at least two notes a
 * beat whose pitches repeat every k notes, where k does not fit the notes in a
 * beat (4 against 3, 5 against 4). Its onsets can be perfectly regular and it
 * is still a groove layer - Cathedral's triplet arp, Black Glass's 5-cycle.
 * Returns the share of 4-bar windows that hold such a cycle, and the cycle.
 */
export function pitchCycle(timeline: Timeline, track: TimelineTrack): { share: number; cycle: number | null } {
  return streamCycle(timeline, track, 'pitch');
}

/**
 * The same test on velocity accents: a stream whose accents repeat every k
 * notes against the beat (Black Glass's arp, a 3-step accent cycle on 16ths).
 * A window counts only if its velocities split into clear accents (at least
 * 15 apart); humanised velocity does not repeat at 90 % and is not a cycle.
 */
export function accentCycle(timeline: Timeline, track: TimelineTrack): { share: number; cycle: number | null } {
  return streamCycle(timeline, track, 'accent');
}

function streamCycle(timeline: Timeline, track: TimelineTrack, kind: 'pitch' | 'accent'): { share: number; cycle: number | null } {
  const windowBeats = 4 * timeline.beatsPerBar;
  const top = new Map<number, { pitch: number; velocity: number }>();
  for (const n of track.notes) {
    const at = Math.round(n.start * 12) / 12;
    const current = top.get(at);
    if (!current || n.pitch > current.pitch) top.set(at, { pitch: n.pitch, velocity: Math.max(n.velocity, current?.velocity ?? 0) });
    else current.velocity = Math.max(current.velocity, n.velocity);
  }
  const line = [...top.entries()].sort((a, b) => a[0] - b[0]);
  const windows = new Map<number, typeof line>();
  for (const entry of line) {
    const w = Math.floor(entry[0] / windowBeats);
    windows.set(w, [...(windows.get(w) ?? []), entry]);
  }
  let counted = 0, cycling = 0;
  const cycles = new Map<number, number>();
  for (const notes of windows.values()) {
    if (notes.length < 8) continue;
    const beats = new Set(notes.map(([t]) => Math.floor(t + 1e-6))).size;
    const perBeat = Math.round(notes.length / beats);
    if (perBeat < 2) continue;
    let seq: number[];
    if (kind === 'pitch') {
      seq = notes.map(([, n]) => n.pitch);
    } else {
      const velocities = notes.map(([, n]) => n.velocity);
      const low = Math.min(...velocities), high = Math.max(...velocities);
      if (high - low < 15) continue;
      seq = velocities.map((v) => (v >= (low + high) / 2 ? 1 : 0));
    }
    counted += 1;
    // From k = 1: a held-pitch stream (a KBBB roll on one root) repeats every note.
    for (let k = 1; k <= 8 && k < seq.length / 2; k += 1) {
      let match = 0;
      for (let i = 0; i + k < seq.length; i += 1) if (seq[i] === seq[i + k]) match += 1;
      if (match / (seq.length - k) < 0.9) continue;
      // The smallest repeating period decides; it turns against the beat only if neither divides the other.
      if (k % perBeat !== 0 && perBeat % k !== 0) {
        cycling += 1;
        cycles.set(k, (cycles.get(k) ?? 0) + 1);
      }
      break;
    }
  }
  const cycle = [...cycles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { share: counted ? cycling / counted : 0, cycle };
}

export function grooveProfile(timeline: Timeline, track: TimelineTrack): GrooveProfile {
  const vectors = barVectors(timeline, track);
  const active = [...vectors.values()];
  const displaced = active.filter(isDisplacedBar).length;
  const onsets = [...new Set(track.notes.map((n) => Math.round(n.start * 12) / 12))].sort((a, b) => a - b);
  let dotted = 0;
  for (let i = 1; i < onsets.length; i += 1) if (Math.abs(onsets[i]! - onsets[i - 1]! - 0.75) < 0.02) dotted += 1;
  const onBeat = onsets.filter((t) => Math.abs(t - Math.round(t)) < 0.02).length;
  // Triplet positions (a third and two thirds of a beat) are off the straight 16th grid.
  const onTriplet = onsets.filter((t) => {
    const frac = t - Math.floor(t + 1e-6);
    return Math.abs(frac - 1 / 3) < 0.02 || Math.abs(frac - 2 / 3) < 0.02;
  }).length;
  const triplets = onsets.length >= 8 && onTriplet / onsets.length >= 0.4;

  const gates: number[] = [];
  const notes = [...track.notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i < notes.length - 1; i += 1) {
    const gap = notes[i + 1]!.start - notes[i]!.start;
    if (gap > 1e-6 && gap <= timeline.beatsPerBar) gates.push(notes[i]!.duration / gap);
  }
  gates.sort((a, b) => a - b);

  const syncopatedShare = active.length ? displaced / active.length : 0;
  const cycle = track.pitched ? pitchCycle(timeline, track) : { share: 0, cycle: null };
  const accents = accentCycle(timeline, track);
  let role: GrooveRole;
  if (!active.length) role = 'silent';
  else if (track.role === 'kick') role = 'anchor';
  else if (syncopatedShare >= 0.5 || cycle.share >= 0.5 || accents.share >= 0.5 || triplets) role = 'groove';
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
    ...(cycle.share >= 0.5 && cycle.cycle ? { cycle: cycle.cycle } : {}),
    ...(triplets ? { triplets: true } : {}),
    ...(accents.share >= 0.5 && accents.cycle ? { accentCycle: accents.cycle } : {}),
  };
}

/**
 * Groove parts that only repeat another's rhythm: an octave double, or hints
 * and quotes of the hook's cell. The part that runs longest leads; another
 * follows it when it doubles it (unison or octaves at the same moments) or when
 * at least 60 % of its displaced bars are covered by one of the leader's bar
 * patterns. Measured on Threshold (Lead Oct, the pizzicato hook hints) and
 * Cathedral (Violin II doubling the arp at the peak).
 */
function followers(timeline: Timeline, grooves: GrooveProfile[]): Map<string, string> {
  const tracks = new Map(timeline.tracks.map((t) => [t.name, t]));
  const patterns = new Map(grooves.map((g) => [g.track, [...barVectors(timeline, tracks.get(g.track)!).values()].filter(isDisplacedBar)]));
  const covers = (big: boolean[], small: boolean[]) => small.every((on, i) => !on || big[i]);
  const covered = (part: string, leader: string) => {
    const own = patterns.get(part)!, theirs = patterns.get(leader)!;
    return own.length > 0 && own.filter((v) => theirs.some((w) => covers(w, v))).length >= 0.6 * own.length;
  };
  const order = [...grooves].sort((a, b) => b.activeBars - a.activeBars);
  const follows = new Map<string, string>();
  for (const part of order) {
    const leader = order.find(
      (l) =>
        l !== part && !follows.has(l.track) && l.activeBars >= part.activeBars &&
        (doublesTrack(tracks.get(part.track)!, tracks.get(l.track)!) || covered(part.track, l.track)),
    );
    if (leader) follows.set(part.track, leader.track);
  }
  return follows;
}

/** Sections 9, 15, 22 and 26: one stable anchor, exactly one groove layer. */
export function checkGroove(timeline: Timeline): { profiles: GrooveProfile[]; findings: GrooveFinding[] } {
  const profiles = timeline.tracks.filter((t) => t.notes.length).map((t) => grooveProfile(timeline, t));
  const findings: GrooveFinding[] = [];
  const grooves = profiles.filter((p) => p.role === 'groove');
  const follows = followers(timeline, grooves);
  for (const p of profiles) if (follows.has(p.track)) p.follows = follows.get(p.track);
  const layers = grooves.filter((g) => !follows.has(g.track));
  const describe = (g: GrooveProfile) => {
    const with_ = grooves.filter((x) => follows.get(x.track) === g.track).map((x) => x.track);
    const ways = [
      g.cycle ? `a ${g.cycle}-note pitch cycle against the beat` : '',
      g.accentCycle ? `a ${g.accentCycle}-note accent cycle against the beat` : '',
      g.triplets ? 'triplets against the straight grid' : '',
      g.syncopatedShare >= 0.5 ? `${pct(g.syncopatedShare)} of bars displaced` : '',
    ].filter(Boolean);
    const how = ways.join(', ');
    return `${g.track} (${how}${with_.length ? `; ${with_.join(', ')} double or quote its rhythm` : ''})`;
  };

  if (layers.length > 1) {
    findings.push({
      severity: 'warn',
      message: `${layers.length} groove layers: ${layers.map(describe).join(', ')}. GROOVE.md wants one: "if everything is syncopated, nothing sounds syncopated". Keep the strongest, straighten or thin the others - unless the brief asks for more.`,
    });
  } else if (layers.length === 1 && follows.size) {
    findings.push({ severity: 'info', message: `One groove layer: ${describe(layers[0]!)}.` });
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
