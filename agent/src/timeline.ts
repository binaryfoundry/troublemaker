/**
 * The Arrangement as one timeline: every track's Arrangement clips with their
 * notes placed in arrangement beats, and what each track does in each bar.
 * The audits read this rather than Live, so they stay pure functions.
 *
 * A clip stores its notes in clip time. Placing a clip in the Arrangement
 * plays it from its start marker; a looped clip wraps from loop end back to
 * loop start until the Arrangement clip ends (Live's documented Clip
 * semantics). Clips placed by this project span exactly one pass from beat 0,
 * so the mapping is usually a plain offset; a clip that needed wrapping is
 * marked, so a finding that depends on it can say so.
 */

import type { Note } from '../../bridge/src/protocol.js';
import { inferTrackRole } from './composition.js';

/** One Arrangement clip as the bridge reports it, with its notes if MIDI. */
export interface ArrangementClipData {
  name: string;
  start: number;
  end: number;
  is_midi_clip: boolean;
  arrangement_index: number;
  /** In clip time, as live.get_notes returns them. */
  notes?: Note[];
  start_marker?: number;
  end_marker?: number;
  loop_start?: number;
  loop_end?: number;
  looping?: boolean;
}

export interface TrackData {
  track_id: number;
  name: string;
  /** Device class names, to recognise a Drum Rack. */
  devices?: string[];
  clips: ArrangementClipData[];
  /** Session clips by name, for comparing Arrangement copies. */
  session?: Array<{ name: string; slot: number; notes: Note[] }>;
}

export interface TimelineNote {
  pitch: number;
  /** Arrangement beats. */
  start: number;
  duration: number;
  velocity: number;
  /** Index into the track's clips. */
  clip: number;
}

export interface TimelineTrack {
  id: number;
  name: string;
  role: string;
  pitched: boolean;
  clips: ArrangementClipData[];
  notes: TimelineNote[];
  /** Whether any clip had to be wrapped or offset by its markers. */
  wrapped: boolean;
  session: Array<{ name: string; slot: number; notes: Note[] }>;
}

export interface Timeline {
  beatsPerBar: number;
  /** Last clip end, in beats. */
  lengthBeats: number;
  /** Whole bars covering the arrangement. */
  bars: number;
  tracks: TimelineTrack[];
}

export interface TimelineOptions {
  beatsPerBar?: number;
  /** Track name -> role, overriding the guess from the name. */
  roles?: Record<string, string>;
  /** Track names to treat as unpitched (drums, noise FX). */
  unpitched?: string[];
}

const DRUM_ROLES = new Set(['kick', 'snare', 'hats', 'perc']);
const EPS = 1e-6;

/** A clip's notes in arrangement beats, wrapped by its markers. */
export function placeClipNotes(clip: ArrangementClipData, index = 0): { notes: TimelineNote[]; wrapped: boolean } {
  const notes = (clip.notes ?? []).filter((n) => !n.mute);
  const span = clip.end - clip.start;
  if (!notes.length || span <= 0) return { notes: [], wrapped: false };
  const marker = clip.start_marker ?? 0;
  const looping = clip.looping ?? false;
  const loopStart = clip.loop_start ?? 0;
  const loopEnd = clip.loop_end ?? span;
  const endMarker = clip.end_marker ?? marker + span;

  const out: TimelineNote[] = [];
  let elapsed = 0;
  let position = marker;
  let passes = 0;
  while (elapsed < span - EPS) {
    const segmentEnd = looping ? loopEnd : endMarker;
    const length = segmentEnd - position;
    if (length <= EPS) break;
    for (const n of notes) {
      if (n.start < position - EPS || n.start >= segmentEnd - EPS) continue;
      const at = clip.start + elapsed + (n.start - position);
      if (at >= clip.end - EPS) continue;
      out.push({
        pitch: n.pitch,
        start: round(at),
        duration: round(Math.min(n.duration, clip.end - at)),
        velocity: n.velocity,
        clip: index,
      });
    }
    elapsed += length;
    passes += 1;
    if (!looping) break;
    position = loopStart;
    if (passes > 4096) break;
  }
  const wrapped = marker !== 0 || passes > 1;
  return { notes: out.sort((a, b) => a.start - b.start || a.pitch - b.pitch), wrapped };
}

/** Whether a track carries pitched material, from its role, devices and name. */
export function isPitched(name: string, role: string, devices: string[] = [], unpitched: string[] = []): boolean {
  if (unpitched.some((u) => u.toLowerCase() === name.toLowerCase())) return false;
  if (DRUM_ROLES.has(role)) return false;
  if (devices.includes('DrumGroupDevice')) return false;
  return !/\b(drums?|beats?|breaks?|grooves?|loops?)\b/i.test(name);
}

export function buildTimeline(tracks: TrackData[], options: TimelineOptions = {}): Timeline {
  const beatsPerBar = options.beatsPerBar ?? 4;
  const out: TimelineTrack[] = tracks.map((t) => {
    const role = options.roles?.[t.name] ?? inferTrackRole(t.name).role;
    let wrapped = false;
    const notes: TimelineNote[] = [];
    t.clips.forEach((clip, i) => {
      const placed = placeClipNotes(clip, i);
      wrapped ||= placed.wrapped;
      notes.push(...placed.notes);
    });
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return {
      id: t.track_id,
      name: t.name,
      role,
      pitched: isPitched(t.name, role, t.devices, options.unpitched),
      clips: t.clips,
      notes,
      wrapped,
      session: t.session ?? [],
    };
  });
  const lengthBeats = Math.max(0, ...tracks.flatMap((t) => t.clips.map((c) => c.end)));
  return { beatsPerBar, lengthBeats, bars: Math.ceil(lengthBeats / beatsPerBar - EPS), tracks: out };
}

/** 1-based bar of a beat. */
export function barOf(timeline: Timeline, beat: number): number {
  return Math.floor(beat / timeline.beatsPerBar + EPS) + 1;
}

/** Onsets per bar (index 0 = bar 1). */
export function onsetsPerBar(timeline: Timeline, track: TimelineTrack): number[] {
  const counts = new Array<number>(timeline.bars).fill(0);
  for (const n of track.notes) {
    const bar = barOf(timeline, n.start);
    if (bar >= 1 && bar <= timeline.bars) counts[bar - 1]! += 1;
  }
  return counts;
}

/** Bars (1-based) in which a track has a note sounding - a held chord counts until it ends. */
export function soundingBars(timeline: Timeline, track: TimelineTrack): Set<number> {
  const bars = new Set<number>();
  for (const n of track.notes) {
    const last = barOf(timeline, Math.max(n.start, n.start + n.duration - 1e-3));
    for (let bar = barOf(timeline, n.start); bar <= last; bar += 1) bars.add(bar);
  }
  return bars;
}

/**
 * Where a track enters and leaves: runs of sounding bars separated by at least
 * `minGap` silent bars. A short gap (a breath, a fill) does not split a run.
 */
export function activitySpans(timeline: Timeline, track: TimelineTrack, minGap = 4): Array<{ from: number; to: number }> {
  const bars = [...soundingBars(timeline, track)].sort((a, b) => a - b);
  const spans: Array<{ from: number; to: number }> = [];
  for (const bar of bars) {
    const last = spans.at(-1);
    if (last && bar - last.to <= minGap) last.to = bar;
    else spans.push({ from: bar, to: bar });
  }
  return spans;
}

export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
