/**
 * Identify an effect from audio (EFFECTS.md, "Codex-agent checklist").
 *
 * Infers which control variable is moving rather than guessing a plug-in:
 * onset spacing, pitch contour, brightness and amplitude periodicity, then
 * applies the documented classifier:
 *
 *   repeated hits similar, intervals growing, pitch stable -> retrigger deceleration
 *   intervals shrinking, pitch stable                       -> exponential ratchet
 *   everything falling in pitch while timing stretches      -> tape stop
 *   constant-rate repeats                                   -> beat repeat / gate
 *   brightness moving with steady timing                    -> filter sweep
 *
 * Hybrids are common, so the result carries the evidence and a confidence,
 * and is an auditory identification, never a claim about the original tool.
 */

import { spawn } from 'node:child_process';

import { Biquad } from './dsp.js';
import { yin } from './bass.js';
import { QcError } from './ffmpeg.js';

const FFMPEG = process.env.TROUBLEMAKER_FFMPEG ?? 'ffmpeg';
export const IDENTIFY_RATE = 22050;
const HOP_SECONDS = 0.005;

export interface EffectFeatures {
  onsets: number;
  /** Mean inter-onset interval (ms). */
  meanIoiMs: number | null;
  /** Ratio of the last intervals to the first: >1.5 slowing, <0.67 speeding up. */
  ioiRatio: number | null;
  /** Coefficient of variation of the intervals: low means a steady rate. */
  ioiRegularity: number | null;
  /** Pitch change across the excerpt in semitones (negative = falling). */
  pitchChangeSemitones: number | null;
  /** Brightness change (zero-crossing rate), last quarter over first quarter. */
  brightnessRatio: number;
  /** Strength of a periodic amplitude pattern, 0..1. */
  amplitudePeriodicity: number;
}

export interface Identification {
  effect: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  features: EffectFeatures;
  /** Always an auditory identification, not proof of the processor used. */
  evidenceKind: 'auditory';
}

export function decodeExcerpt(path: string, start = 0, duration?: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (start > 0) args.push('-ss', String(start));
    if (duration) args.push('-t', String(duration));
    args.push('-i', path, '-vn', '-ac', '1', '-ar', String(IDENTIFY_RATE), '-f', 'f32le', '-acodec', 'pcm_f32le', '-');
    const child = spawn(FFMPEG, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new QcError('DECODE_FAILED', `ffmpeg could not decode ${path}`));
      const data = Buffer.concat(chunks);
      const out = new Float32Array(Math.floor(data.length / 4));
      Buffer.from(out.buffer).set(data.subarray(0, out.length * 4));
      resolve(out);
    });
  });
}

/** Onset times (s) by peak-picking the rise of a short-term energy envelope. */
export function detectOnsets(samples: Float32Array, rate = IDENTIFY_RATE): number[] {
  const hop = Math.round(rate * HOP_SECONDS);
  const env: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j += 1) sum += samples[j]! * samples[j]!;
    env.push(10 * Math.log10(sum / hop + 1e-12));
  }
  const peak = Math.max(...env);
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let k = 2; k < env.length; k += 1) {
    const rise = env[k]! - Math.min(env[k - 1]!, env[k - 2]!);
    // A clear rise, loud enough to matter, and at least 15 ms after the last.
    if (rise > 6 && env[k]! > peak - 40 && (k - lastOnset) * HOP_SECONDS > 0.015) {
      onsets.push(k * HOP_SECONDS);
      lastOnset = k;
    }
  }
  return onsets;
}

function zeroCrossingRate(samples: Float32Array, from: number, to: number): number {
  let crossings = 0;
  for (let i = from + 1; i < to; i += 1) if ((samples[i - 1]! >= 0) !== (samples[i]! >= 0)) crossings += 1;
  return crossings / Math.max(1, to - from);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

export function extractFeatures(samples: Float32Array, rate = IDENTIFY_RATE): EffectFeatures {
  const onsets = detectOnsets(samples, rate);
  const iois = onsets.slice(1).map((t, i) => t - onsets[i]!);
  const quarter = Math.max(1, Math.floor(iois.length / 4));
  const ioiRatio = iois.length >= 4 ? mean(iois.slice(-quarter)) / mean(iois.slice(0, quarter)) : null;
  const ioiMean = iois.length ? mean(iois) : null;
  const ioiRegularity =
    iois.length >= 3 ? Math.sqrt(mean(iois.map((d) => (d - ioiMean!) ** 2))) / ioiMean! : null;

  // Pitch at the start and end: the median of YIN estimates over each quarter.
  const lowpassed = new Float32Array(samples.length);
  const lp = [Biquad.lowpass(rate, 1200), Biquad.lowpass(rate, 1200)];
  for (let i = 0; i < samples.length; i += 1) lowpassed[i] = lp.reduce((y, s) => s.process(y), samples[i]!);
  const pitchAt = (from: number, to: number): number | null => {
    const hz: number[] = [];
    const window = Math.round(rate * 0.04);
    for (let i = from; i + window < to; i += Math.round(window / 2)) {
      const f = yin(lowpassed, i, window, rate, 60, 1200);
      if (f !== null) hz.push(f);
    }
    if (hz.length < 3) return null;
    hz.sort((a, b) => a - b);
    return hz[Math.floor(hz.length / 2)]!;
  };
  const q = Math.floor(samples.length / 4);
  const p0 = pitchAt(0, q);
  const p1 = pitchAt(samples.length - q, samples.length);
  const pitchChangeSemitones = p0 && p1 ? 12 * Math.log2(p1 / p0) : null;

  const brightnessRatio = zeroCrossingRate(samples, samples.length - q, samples.length) /
    Math.max(1e-6, zeroCrossingRate(samples, 0, q));

  // Periodicity of the amplitude envelope: the best normalised autocorrelation
  // between 50 ms and 1 s.
  const hop = Math.round(rate * 0.01);
  const env: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j += 1) sum += Math.abs(samples[j]!);
    env.push(sum / hop);
  }
  const envMean = mean(env);
  const centred = env.map((v) => v - envMean);
  const energy = centred.reduce((s, v) => s + v * v, 0) || 1;
  let best = 0;
  for (let lag = 5; lag <= Math.min(100, Math.floor(centred.length / 2)); lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i += 1) sum += centred[i]! * centred[i + lag]!;
    best = Math.max(best, sum / energy);
  }

  return {
    onsets: onsets.length,
    meanIoiMs: ioiMean === null ? null : Math.round(ioiMean * 1000),
    ioiRatio: ioiRatio === null ? null : round(ioiRatio),
    ioiRegularity: ioiRegularity === null ? null : round(ioiRegularity),
    pitchChangeSemitones: pitchChangeSemitones === null ? null : round(pitchChangeSemitones),
    brightnessRatio: round(brightnessRatio),
    amplitudePeriodicity: round(Math.max(0, best)),
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The EFFECTS.md classifier over extracted features. */
export function classify(f: EffectFeatures): Identification {
  const evidence: string[] = [];
  const pitchFall = f.pitchChangeSemitones !== null && f.pitchChangeSemitones <= -3;
  const pitchStable = f.pitchChangeSemitones !== null && Math.abs(f.pitchChangeSemitones) < 1.5;
  const slowing = f.ioiRatio !== null && f.ioiRatio >= 1.6;
  const speeding = f.ioiRatio !== null && f.ioiRatio <= 0.62;
  const steady = f.ioiRegularity !== null && f.ioiRegularity < 0.15 && f.onsets >= 6;
  const result = (effect: string, confidence: Identification['confidence']): Identification => ({
    effect, confidence, evidence, features: f, evidenceKind: 'auditory',
  });

  if (f.ioiRatio !== null) evidence.push(`intervals change by x${f.ioiRatio} from start to end (${f.onsets} onsets)`);
  if (f.pitchChangeSemitones !== null) evidence.push(`pitch moves ${f.pitchChangeSemitones} semitones`);

  if (slowing && pitchFall) {
    evidence.push('timing stretches while pitch falls together: variable-speed playback');
    return result('tape_stop', f.pitchChangeSemitones! <= -6 ? 'high' : 'medium');
  }
  if (slowing && (pitchStable || f.pitchChangeSemitones === null)) {
    evidence.push('repeats spread out while each hit keeps its pitch');
    return result('retrigger_deceleration', pitchStable ? 'high' : 'medium');
  }
  if (speeding && (pitchStable || f.pitchChangeSemitones === null)) {
    evidence.push('repeats crowd together while each hit keeps its pitch');
    return result('exponential_ratchet', pitchStable ? 'high' : 'medium');
  }
  if (pitchFall && f.onsets < 4) {
    evidence.push('pitch falls without a repeated rhythm and without stretching events');
    return result('pitch_dive', 'medium');
  }
  if (steady) {
    evidence.push(`a steady rate of repeats every ~${f.meanIoiMs} ms`);
    return result(f.meanIoiMs !== null && f.meanIoiMs < 80 ? 'beat_repeat' : 'trance_gate', 'medium');
  }
  if (f.brightnessRatio >= 1.8 || f.brightnessRatio <= 0.55) {
    evidence.push(`brightness ${f.brightnessRatio > 1 ? 'rises' : 'falls'} by x${f.brightnessRatio} with no timing change`);
    return result('filter_sweep', 'medium');
  }
  if (f.amplitudePeriodicity >= 0.5) {
    evidence.push(`strongly periodic level (${f.amplitudePeriodicity}): gating, tremolo or sidechain`);
    return result('sidechain_pump', 'low');
  }
  evidence.push('no single moving variable stands out; possibly a hybrid or a reverb/delay tail');
  return result('unknown', 'low');
}

export async function identifyEffect(path: string, start = 0, duration?: number): Promise<Identification> {
  return classify(extractFeatures(await decodeExcerpt(path, start, duration)));
}
