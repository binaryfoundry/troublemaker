/**
 * Pitched notes from an Arrangement audio clip, so the track audit can see a
 * vocal or a sampled hook rather than only where its clips sit.
 *
 * Decode the clip's file, map each arrangement 16th to file time through
 * Live's warp markers (the clip's own beat time, wrapped by its loop exactly
 * as a MIDI clip's - measured on Live 12.4, see agent/src/timeline.ts), track
 * the fundamental there with YIN, add the clip's transposition, and keep runs
 * that hold one pitch for at least an 8th.
 *
 * Monophonic sources only. Rap, noise and chords give few or no notes, and the
 * result says how much of the clip was voiced so a reader can weigh it.
 * Unwarped clips are not analysed: how their markers map to the file has not
 * been measured, and guessing would place every note wrongly.
 */

import { yin, hzToMidi } from './bass.js';
import { decodeExcerpt, IDENTIFY_RATE } from './identify.js';

export interface WarpMarker {
  beat_time: number;
  sample_time: number;
}

export interface AudioClipInfo {
  start: number;
  end: number;
  start_marker?: number;
  loop_start?: number;
  loop_end?: number;
  looping?: boolean;
  file_path?: string | null;
  warping?: boolean | null;
  pitch_coarse?: number;
  pitch_fine?: number;
  warp_markers?: WarpMarker[] | null;
}

export interface AudioNote {
  pitch: number;
  /** Arrangement beats. */
  start: number;
  duration: number;
  velocity: number;
}

export interface AudioNotesResult {
  analysed: boolean;
  reason?: string;
  notes: AudioNote[];
  /** Share of audible 16ths that had a stable pitch. */
  voicedShare: number;
}

const STEP = 0.25;
const WINDOW = 2048;
const MIN_HZ = 70;
const MAX_HZ = 1000;
const GATE_DB = -45;

/** File seconds at a clip beat, piecewise linear through the warp markers, extrapolated at the ends. */
export function beatToSeconds(markers: WarpMarker[], beat: number): number {
  const m = [...markers].sort((a, b) => a.beat_time - b.beat_time);
  if (m.length === 1) return m[0]!.sample_time;
  let i = 1;
  while (i < m.length - 1 && beat > m[i]!.beat_time) i += 1;
  const a = m[i - 1]!, b = m[i]!;
  const slope = (b.sample_time - a.sample_time) / (b.beat_time - a.beat_time || 1);
  return a.sample_time + (beat - a.beat_time) * slope;
}

/** The clip beat playing at an arrangement beat, wrapped by the loop like a MIDI clip. */
export function clipBeatAt(clip: AudioClipInfo, arrangementBeat: number): number {
  const marker = clip.start_marker ?? 0;
  const position = marker + (arrangementBeat - clip.start);
  if (!clip.looping) return position;
  const loopStart = clip.loop_start ?? 0;
  const loopEnd = clip.loop_end ?? position + 1;
  const length = loopEnd - loopStart;
  if (position < loopEnd || length <= 0) return position;
  return loopStart + ((position - loopEnd) % length);
}

/** Runs of one pitch, at least `minFrames` 16ths long, as notes. */
export function segmentPitches(frames: Array<{ beat: number; pitch: number | null }>, minFrames = 2): AudioNote[] {
  const notes: AudioNote[] = [];
  let run: { pitch: number; start: number; count: number } | null = null;
  const close = () => {
    if (run && run.count >= minFrames) notes.push({ pitch: run.pitch, start: run.start, duration: run.count * STEP, velocity: 100 });
    run = null;
  };
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]!;
    const contiguous = run !== null && Math.abs(f.beat - (run.start + run.count * STEP)) < 1e-6;
    if (f.pitch !== null && run && contiguous && f.pitch === run.pitch) {
      run.count += 1;
      continue;
    }
    close();
    if (f.pitch !== null) run = { pitch: f.pitch, start: f.beat, count: 1 };
  }
  close();
  return notes;
}

function rmsDb(samples: Float32Array, from: number, length: number): number {
  let sum = 0;
  const end = Math.min(samples.length, from + length);
  for (let i = Math.max(0, from); i < end; i += 1) sum += samples[i]! * samples[i]!;
  const mean = sum / Math.max(1, end - from);
  return mean > 1e-12 ? 10 * Math.log10(mean) : -120;
}

export async function audioClipNotes(
  clip: AudioClipInfo,
  decode: (path: string) => Promise<Float32Array> = (path) => decodeExcerpt(path),
): Promise<AudioNotesResult> {
  if (!clip.file_path) return { analysed: false, reason: 'no file path', notes: [], voicedShare: 0 };
  if (!clip.warping) return { analysed: false, reason: 'unwarped (its marker mapping is not measured)', notes: [], voicedShare: 0 };
  if (!clip.warp_markers || clip.warp_markers.length < 2) {
    return { analysed: false, reason: 'no warp markers reported', notes: [], voicedShare: 0 };
  }
  let samples: Float32Array;
  try {
    samples = await decode(clip.file_path);
  } catch (error) {
    return { analysed: false, reason: `could not decode (${error instanceof Error ? error.message : String(error)})`, notes: [], voicedShare: 0 };
  }
  const transpose = (clip.pitch_coarse ?? 0) + Math.round((clip.pitch_fine ?? 0) / 100);
  const frames: Array<{ beat: number; pitch: number | null }> = [];
  let audible = 0, voiced = 0;
  for (let beat = clip.start; beat < clip.end - 1e-6; beat += STEP) {
    const seconds = beatToSeconds(clip.warp_markers, clipBeatAt(clip, beat));
    const from = Math.round(seconds * IDENTIFY_RATE);
    if (from < 0 || from + WINDOW > samples.length || rmsDb(samples, from, WINDOW) < GATE_DB) {
      frames.push({ beat, pitch: null });
      continue;
    }
    audible += 1;
    const hz = yin(samples, from, WINDOW, IDENTIFY_RATE, MIN_HZ, MAX_HZ);
    const pitch = hz ? hzToMidi(hz) + transpose : null;
    if (pitch !== null) voiced += 1;
    frames.push({ beat, pitch });
  }
  return { analysed: true, notes: segmentPitches(frames), voicedShare: audible ? voiced / audible : 0 };
}
