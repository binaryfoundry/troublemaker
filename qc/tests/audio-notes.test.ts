/**
 * Pitched notes from audio clips: the warp-marker mapping, the loop wrap,
 * segmentation, and the whole analysis on synthetic tones through a fake
 * decoder (no ffmpeg needed).
 */

import { describe, expect, it } from 'vitest';

import { audioClipNotes, beatToSeconds, clipBeatAt, segmentPitches, type AudioClipInfo } from '../src/audio-notes.js';
import { IDENTIFY_RATE } from '../src/identify.js';

/** A mono buffer with one sine per segment: [fromSeconds, toSeconds, hz or 0 for silence]. */
function tones(segments: Array<[number, number, number]>): Float32Array {
  const end = Math.max(...segments.map((s) => s[1]));
  const out = new Float32Array(Math.ceil(end * IDENTIFY_RATE));
  for (const [from, to, hz] of segments) {
    if (!hz) continue;
    for (let i = Math.floor(from * IDENTIFY_RATE); i < Math.min(out.length, to * IDENTIFY_RATE); i += 1) {
      out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / IDENTIFY_RATE);
    }
  }
  return out;
}

// 120 BPM: one beat is half a second.
const MARKERS = [{ beat_time: 0, sample_time: 0 }, { beat_time: 32, sample_time: 16 }];

describe('audio clip mapping', () => {
  it('maps clip beats to file seconds through the warp markers', () => {
    expect(beatToSeconds(MARKERS, 4)).toBe(2);
    // A slower second half: beats 8-16 span 6 seconds.
    const varied = [{ beat_time: 0, sample_time: 0 }, { beat_time: 8, sample_time: 4 }, { beat_time: 16, sample_time: 10 }];
    expect(beatToSeconds(varied, 12)).toBe(7);
    expect(beatToSeconds(varied, 20)).toBe(13); // extrapolated with the last slope
  });

  it('wraps a looped clip like a MIDI clip and starts from its start marker', () => {
    const clip: AudioClipInfo = { start: 64, end: 80, start_marker: 4, loop_start: 4, loop_end: 8, looping: true };
    expect(clipBeatAt(clip, 64)).toBe(4);
    expect(clipBeatAt(clip, 67)).toBe(7);
    expect(clipBeatAt(clip, 68)).toBe(4);
    expect(clipBeatAt({ ...clip, looping: false }, 68)).toBe(8);
  });

  it('keeps runs of one pitch at least an 8th long', () => {
    const frames = [
      { beat: 0, pitch: 57 }, { beat: 0.25, pitch: 57 }, { beat: 0.5, pitch: 57 },
      { beat: 0.75, pitch: 64 }, // a single 16th: dropped
      { beat: 1, pitch: null },
      { beat: 1.25, pitch: 60 }, { beat: 1.5, pitch: 60 },
    ];
    expect(segmentPitches(frames)).toEqual([
      { pitch: 57, start: 0, duration: 0.75, velocity: 100 },
      { pitch: 60, start: 1.25, duration: 0.5, velocity: 100 },
    ]);
  });
});

describe('audioClipNotes', () => {
  // A3 for beats 0-4, silence for 4-8, C4 for 8-12.
  const file = tones([[0, 2, 220], [2, 4, 0], [4, 6, 261.63]]);
  const decode = async () => file;
  const clip: AudioClipInfo = { start: 0, end: 12, file_path: 'vocal.wav', warping: true, warp_markers: MARKERS, start_marker: 0, looping: false };

  it('finds the pitches and where they sit, and how much was voiced', async () => {
    const result = await audioClipNotes(clip, decode);
    expect(result.analysed).toBe(true);
    expect(result.voicedShare).toBeGreaterThan(0.9);
    expect(result.notes.map((n) => n.pitch)).toEqual([57, 60]);
    expect(result.notes[0]!.start).toBe(0);
    expect(result.notes[1]!.start).toBeGreaterThanOrEqual(8);
    expect(result.notes[1]!.start).toBeLessThan(8.5);
  });

  it('adds the clip\'s transposition', async () => {
    const result = await audioClipNotes({ ...clip, pitch_coarse: 1 }, decode);
    expect(result.notes.map((n) => n.pitch)).toEqual([58, 61]);
  });

  it('declines an unwarped clip rather than guess its mapping', async () => {
    const result = await audioClipNotes({ ...clip, warping: false }, decode);
    expect(result).toMatchObject({ analysed: false, notes: [] });
    expect(result.reason).toMatch(/unwarped/);
  });

  it('reports a file it cannot decode instead of failing the audit', async () => {
    const result = await audioClipNotes(clip, async () => { throw new Error('missing'); });
    expect(result.analysed).toBe(false);
    expect(result.reason).toMatch(/could not decode/);
  });
});
