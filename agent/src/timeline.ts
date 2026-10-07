/**
 * The Arrangement as one timeline: every track's Arrangement clips with their
 * notes placed in arrangement beats, and what each track does in each bar.
 * The audits read this rather than Live, so they stay pure functions.
 *
 * A clip stores its notes in clip time, and an Arrangement clip plays from its
 * start marker. Measured on Live 12.4 by recording a placed clip's MIDI output
 * on a second track: a looped clip with its start marker at 4 played clip beats
 * 4-8, and an unlooped one played from its start marker to its end marker,
 * exactly as placeClipNotes predicts. A clip stretched longer than its loop
 * wraps from loop end back to loop start (Live's documented semantics); that
 * case could not be built through the API and is not yet measured, so such a
 * clip is marked `wrapped` and the audit says so.
 */

import type { Note } from '../../bridge/src/protocol.js';
import { inferTrackRole } from './composition.js';
import { voiceForPadName, type Voice } from './drums.js';
import { instrumentFor } from './orchestral.js';

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
  /** Audio clips: the source file, warping and transposition. */
  file_path?: string | null;
  warping?: boolean | null;
  pitch_coarse?: number;
  pitch_fine?: number;
  warp_markers?: Array<{ beat_time: number; sample_time: number }> | null;
  /** Audio clips: pitched notes detected in the file, already in arrangement beats. */
  audioNotes?: Array<{ pitch: number; start: number; duration: number; velocity: number }>;
  /** Audio clips: whether they were analysed, why not, and how much was voiced. */
  audioAnalysis?: { analysed: boolean; reason?: string; voicedShare: number };
}

export interface TrackData {
  track_id: number;
  name: string;
  /** Device class names, to recognise a Drum Rack. */
  devices?: string[];
  clips: ArrangementClipData[];
  /** Session clips by name, for comparing Arrangement copies. */
  session?: Array<{ name: string; slot: number; notes: Note[] }>;
  /** A Drum Rack's filled pads, so its kick, snare and hats can be told apart. */
  pads?: Array<{ note: number; name: string }>;
}

export interface TimelineNote {
  pitch: number;
  /** Arrangement beats. */
  start: number;
  duration: number;
  velocity: number;
  /** Index into the track's clips. */
  clip: number;
  /** Detected in an audio clip rather than written as MIDI: evidence, not fact. */
  audio?: boolean;
}

export interface TimelineTrack {
  id: number;
  name: string;
  role: string;
  pitched: boolean;
  clips: ArrangementClipData[];
  notes: TimelineNote[];
  /** Whether any clip is longer than its loop and had to be wrapped (not yet measured in Live). */
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

/** DRUMS.md voices grouped into the roles the audit reads. */
const VOICE_ROLE: Record<Voice, 'kick' | 'snare' | 'hats' | 'perc'> = {
  BD: 'kick',
  SD: 'snare', RS: 'snare', CP: 'snare',
  CH: 'hats', OH: 'hats', CY: 'hats', RD: 'hats',
  LT: 'perc', MT: 'perc', HT: 'perc', CB: 'perc',
};
const ROLE_LABEL: Record<string, string> = { kick: 'Kick', snare: 'Snare/Clap', hats: 'Hats', perc: 'Perc' };

/** A pad's role: by DRUMS.md voice, else by the words in its name, else percussion. */
export function padRole(name: string): 'kick' | 'snare' | 'hats' | 'perc' {
  const voice = voiceForPadName(name);
  if (voice) return VOICE_ROLE[voice];
  const role = inferTrackRole(name).role;
  return role === 'kick' || role === 'snare' || role === 'hats' ? role : 'perc';
}

/**
 * A Drum Rack track as one part per role ("Drums > Kick", "Drums > Hats"), so
 * the kick inside a rack anchors the beat-led and withholding checks and each
 * voice gets its own groove profile. The first part keeps the clips and the
 * Session copies, so clip-level checks see the track once.
 */
function splitDrumRack(track: TimelineTrack, pads: Array<{ note: number; name: string }>): TimelineTrack[] {
  const roleOf = new Map(pads.map((p) => [p.note, padRole(p.name)]));
  const groups = new Map<string, TimelineNote[]>();
  for (const n of track.notes) {
    const role = roleOf.get(n.pitch) ?? 'perc';
    groups.set(role, [...(groups.get(role) ?? []), n]);
  }
  const order = ['kick', 'snare', 'hats', 'perc'].filter((r) => groups.has(r));
  if (!order.length) return [track];
  // A rack with one role keeps its own name ("Hats", not "Hats > Hats").
  if (order.length === 1) return [{ ...track, role: order[0]! }];
  return order.map((role, i) => ({
    ...track,
    name: `${track.name} > ${ROLE_LABEL[role]}`,
    role,
    notes: groups.get(role)!,
    clips: i === 0 ? track.clips : [],
    session: i === 0 ? track.session : [],
  }));
}
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
  const wrapped = passes > 1;
  return { notes: out.sort((a, b) => a.start - b.start || a.pitch - b.pitch), wrapped };
}

/**
 * A track's role: an explicit one, else 'orchestral' for a named orchestral
 * instrument (Cathedral's "Double Bass" is not the DJ's bass), else the guess
 * from the name.
 */
export function trackRole(name: string, roles: Record<string, string> = {}): string {
  if (roles[name]) return roles[name]!;
  if (instrumentFor(name)) return 'orchestral';
  return inferTrackRole(name).role;
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
  const out: TimelineTrack[] = tracks.flatMap((t) => {
    const role = trackRole(t.name, options.roles);
    let wrapped = false;
    const notes: TimelineNote[] = [];
    t.clips.forEach((clip, i) => {
      if (!clip.is_midi_clip) {
        for (const n of clip.audioNotes ?? []) notes.push({ ...n, clip: i, audio: true });
        return;
      }
      const placed = placeClipNotes(clip, i);
      wrapped ||= placed.wrapped;
      notes.push(...placed.notes);
    });
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const track: TimelineTrack = {
      id: t.track_id,
      name: t.name,
      role,
      pitched: isPitched(t.name, role, t.devices, options.unpitched),
      clips: t.clips,
      notes,
      wrapped,
      session: t.session ?? [],
    };
    const isRack = t.devices?.includes('DrumGroupDevice') && t.pads?.length && !options.roles?.[t.name];
    return isRack ? splitDrumRack(track, t.pads!) : [track];
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

/** Whether most of `a`'s notes are `b`'s at the same moment, in unison or octaves: a double, not a part. */
export function doublesTrack(a: TimelineTrack, b: TimelineTrack): boolean {
  const at = new Map<number, number[]>();
  for (const n of b.notes) at.set(Math.round(n.start * 4), [...(at.get(Math.round(n.start * 4)) ?? []), n.pitch]);
  const hits = a.notes.filter((n) => (at.get(Math.round(n.start * 4)) ?? []).some((p) => (n.pitch - p) % 12 === 0)).length;
  return a.notes.length > 0 && hits / a.notes.length >= 0.8 && b.notes.length >= a.notes.length;
}

export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
