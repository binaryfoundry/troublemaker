/**
 * Bassline analysis of a released track: what it plays, when, and how it sits.
 *
 * Works on the loudest section (the drop), decoded to mono at a low rate -
 * everything that matters for a bassline lives below 200 Hz. Extracts:
 *
 *  - beat phase, from the kick's attack folded at the tagged tempo;
 *  - a 16-step rhythm: where in the bar bass notes start;
 *  - the pitch on each step (YIN pitch tracking on the low band), its
 *    consistency across bars, and the overall root;
 *  - the sidechain shape: how far the low end ducks around each kick and how
 *    quickly it recovers.
 *
 * A pragmatic analyser for borrowing a feel, not a transcription tool: a step
 * shared with the kick is flagged, and a pitch only counts when it repeats.
 */

import { spawn } from 'node:child_process';

import { Biquad } from './dsp.js';
import { analyzeFile } from './analyze.js';
import { QcError } from './ffmpeg.js';

const FFMPEG = process.env.TROUBLEMAKER_FFMPEG ?? 'ffmpeg';
const RATE = 11025;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MIN_HZ = 30;
const MAX_HZ = 200;

export interface BassStep {
  step: number;
  /** Mean low-band level on this 16th, relative to the loudest step (dB). */
  levelDb: number;
  /** True when a bass note starts here. */
  onset: boolean;
  /** On a beat, where the kick also lands - pitch is less certain. */
  sharedWithKick: boolean;
  /** Most common MIDI note on this step across bars, if one is consistent. */
  pitch: number | null;
  pitchName: string | null;
  /** Fraction of bars agreeing on that pitch. */
  pitchConfidence: number;
}

export interface BassProfile {
  file: string;
  bpm: number;
  section: { startSeconds: number; durationSeconds: number };
  bars: number;
  steps: BassStep[];
  /** Pitch classes weighted by low-band energy, strongest first. */
  pitchClasses: Array<{ name: string; weight: number }>;
  root: string | null;
  /** Typical octave of the fundamental, as a MIDI note range. */
  register: { low: number; high: number } | null;
  /** Low-band dip around the kick: max minus min within a beat (dB). */
  sidechainDepthDb: number;
  /** Time after the beat for the low end to recover to within 3 dB of its peak (ms). */
  sidechainRecoveryMs: number;
  /** Fraction of each 16th the bass sounds, from the envelope: short = plucky. */
  gate: number;
  /** From the full analysis of the same section. */
  subToLowBassDb: number;
  lowMonoLossDb: number;
  keyTag: string | null;
}

function decodeMono(path: string, start: number, duration: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        '-hide_banner', '-loglevel', 'error',
        '-ss', String(start), '-t', String(duration),
        '-i', path, '-vn', '-ac', '1', '-ar', String(RATE),
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-',
      ],
      { windowsHide: true },
    );
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

function filtered(samples: Float32Array, stages: Biquad[]): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    let y = samples[i]!;
    for (const s of stages) y = s.process(y);
    out[i] = y;
  }
  return out;
}

function rmsDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, samples.length);
  for (let i = from; i < end; i += 1) sum += samples[i]! * samples[i]!;
  const mean = sum / Math.max(1, end - from);
  return mean > 1e-12 ? 10 * Math.log10(mean) : -120;
}

/** YIN fundamental estimate on a window, in Hz, or null if unvoiced. */
export function yin(
  samples: Float32Array,
  from: number,
  length: number,
  rate = RATE,
  minHz = MIN_HZ,
  maxHz = MAX_HZ,
): number | null {
  const minTau = Math.floor(rate / maxHz);
  const maxTau = Math.ceil(rate / minHz);
  const w = length - maxTau;
  if (w < minTau * 2 || from + length > samples.length) return null;
  const d = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < w; i += 1) {
      const delta = samples[from + i]! - samples[from + i + tau]!;
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const cmnd = new Float64Array(maxTau + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    running += d[tau]!;
    cmnd[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
  }
  let best = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cmnd[tau]! < 0.2) {
      while (tau + 1 <= maxTau && cmnd[tau + 1]! < cmnd[tau]!) tau += 1;
      best = tau;
      break;
    }
  }
  if (best < 0) return null;
  // Parabolic interpolation for sub-sample accuracy.
  const a = cmnd[best - 1] ?? cmnd[best]!;
  const b = cmnd[best]!;
  const c = cmnd[best + 1] ?? cmnd[best]!;
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return rate / (best + (Number.isFinite(shift) ? shift : 0));
}

export function hzToMidi(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

/** Live's note naming: middle C (60) is C3. */
export function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 2}`;
}

export async function analyzeBass(
  path: string,
  options: { bpm?: number; sectionSeconds?: number } = {},
): Promise<BassProfile> {
  const full = await analyzeFile(path, { sectionSeconds: options.sectionSeconds ?? 30 });
  const bpm = options.bpm ?? (await tagBpm(path));
  if (!bpm) {
    throw new QcError('NO_TEMPO', `${path} has no BPM tag; pass --bpm.`);
  }
  const { startSeconds, durationSeconds } = full.section.range;
  const mono = await decodeMono(path, startSeconds, durationSeconds);

  const beatSamples = (RATE * 60) / bpm;
  const hop = beatSamples / 16; // a 64th note
  const hops = Math.floor(mono.length / hop);

  // 1. Beat phase: the kick's attack (1.5-4.5 kHz) folded over one beat.
  const attack = filtered(mono, [Biquad.highpass(RATE, 1500), Biquad.highpass(RATE, 1500)]);
  const attackEnv: number[] = [];
  for (let h = 0; h < hops; h += 1) attackEnv.push(rmsDb(attack, Math.round(h * hop), Math.round((h + 1) * hop)));
  const fold = new Array(16).fill(0);
  for (let h = 1; h < hops; h += 1) fold[h % 16] += Math.max(0, attackEnv[h]! - attackEnv[h - 1]!);
  const phaseHop = fold.indexOf(Math.max(...fold));

  // 2. The low band: 35-150 Hz for the rhythm, 30-200 Hz lowpassed for pitch.
  const low = filtered(mono, [
    Biquad.highpass(RATE, 35), Biquad.highpass(RATE, 35),
    Biquad.lowpass(RATE, 150), Biquad.lowpass(RATE, 150),
  ]);
  const pitchBand = filtered(mono, [Biquad.lowpass(RATE, MAX_HZ), Biquad.lowpass(RATE, MAX_HZ), Biquad.highpass(RATE, MIN_HZ)]);

  const startHop = phaseHop;
  const bars = Math.floor((hops - startHop) / 64);
  if (bars < 2) throw new QcError('TOO_SHORT', 'The section is too short to read a bassline from.');

  const lowEnv: number[] = [];
  for (let h = 0; h < hops; h += 1) lowEnv.push(rmsDb(low, Math.round(h * hop), Math.round((h + 1) * hop)));

  // Per-step level, onsets and pitch, collected over every bar.
  const stepLevels = Array.from({ length: 16 }, () => [] as number[]);
  const stepOnsets = new Array(16).fill(0);
  const stepPitches = Array.from({ length: 16 }, () => [] as number[]);
  const pitchWeights = new Array(12).fill(0);
  const midiSeen: number[] = [];

  for (let bar = 0; bar < bars; bar += 1) {
    for (let step = 0; step < 16; step += 1) {
      const h0 = startHop + bar * 64 + step * 4;
      const level = (lowEnv[h0]! + lowEnv[h0 + 1]! + lowEnv[h0 + 2]! + lowEnv[h0 + 3]!) / 4;
      stepLevels[step]!.push(level);
      // An onset: the step's first two hops rise clearly over the hop before.
      const rise = Math.max(lowEnv[h0]!, lowEnv[h0 + 1]!) - (lowEnv[h0 - 1] ?? -120);
      if (rise >= 3) stepOnsets[step] += 1;

      // Pitch over the body of the step (skip the first hop, where attacks smear).
      const from = Math.round((h0 + 1) * hop);
      const length = Math.max(Math.round(3 * hop), Math.ceil((RATE / MIN_HZ) * 2.5));
      const hz = yin(pitchBand, from, length);
      if (hz !== null && hz >= MIN_HZ && hz <= MAX_HZ && level > -60) {
        const midi = hzToMidi(hz);
        stepPitches[step]!.push(midi);
        midiSeen.push(midi);
        pitchWeights[((midi % 12) + 12) % 12] += 10 ** (level / 20);
      }
    }
  }

  const loudest = Math.max(...stepLevels.map((ls) => mean(ls)));
  const steps: BassStep[] = stepLevels.map((levels, step) => {
    const pitches = stepPitches[step]!;
    const mode = modeOf(pitches);
    const confidence = pitches.length ? pitches.filter((p) => p === mode).length / bars : 0;
    const stable = mode !== null && confidence >= 0.4;
    return {
      step,
      levelDb: round(mean(levels) - loudest),
      onset: stepOnsets[step] / bars >= 0.5,
      sharedWithKick: step % 4 === 0,
      pitch: stable ? mode : null,
      pitchName: stable ? midiName(mode!) : null,
      pitchConfidence: round(confidence),
    };
  });

  // 3. Sidechain shape: the low band folded over one beat.
  const beatFold = new Array(16).fill(0);
  const beatCount = new Array(16).fill(0);
  for (let h = startHop; h < hops; h += 1) {
    beatFold[(h - startHop) % 16] += lowEnv[h]!;
    beatCount[(h - startHop) % 16] += 1;
  }
  const beatShape = beatFold.map((v, i) => v / Math.max(1, beatCount[i]));
  const peak = Math.max(...beatShape);
  const trough = Math.min(...beatShape);
  const troughAt = beatShape.indexOf(trough);
  let recoveryHop = troughAt;
  while (recoveryHop < 16 && beatShape[recoveryHop]! < peak - 3) recoveryHop += 1;
  const hopMs = (60_000 / bpm) / 16;

  // Gate: fraction of hops within 6 dB of each step's own peak.
  let sounding = 0;
  let counted = 0;
  for (let h = startHop; h + 4 <= hops; h += 4) {
    const stepPeak = Math.max(lowEnv[h]!, lowEnv[h + 1]!, lowEnv[h + 2]!, lowEnv[h + 3]!);
    if (stepPeak < peak - 20) continue;
    for (let k = 0; k < 4; k += 1) {
      counted += 1;
      if (lowEnv[h + k]! >= stepPeak - 6) sounding += 1;
    }
  }

  const totalWeight = pitchWeights.reduce((a, b) => a + b, 0) || 1;
  const pitchClasses = pitchWeights
    .map((w, i) => ({ name: NOTE_NAMES[i]!, weight: round(w / totalWeight) }))
    .filter((p) => p.weight >= 0.03)
    .sort((a, b) => b.weight - a.weight);

  const band = (name: string) => full.section.bands.find((b) => b.name === name)!.midDb;
  const sortedMidi = [...midiSeen].sort((a, b) => a - b);

  return {
    file: path,
    bpm,
    section: { startSeconds, durationSeconds },
    bars,
    steps,
    pitchClasses,
    root: pitchClasses[0]?.name ?? null,
    register: sortedMidi.length
      ? {
          low: sortedMidi[Math.floor(sortedMidi.length * 0.1)]!,
          high: sortedMidi[Math.floor(sortedMidi.length * 0.9)]!,
        }
      : null,
    sidechainDepthDb: round(peak - trough),
    sidechainRecoveryMs: Math.round((recoveryHop - troughAt) * hopMs),
    gate: round(counted ? sounding / counted : 0),
    subToLowBassDb: round(band('sub') - band('low-bass')),
    lowMonoLossDb: full.section.stereo.lowMonoLossDb,
    keyTag: await tagKey(path),
  };
}

async function probeTag(path: string, names: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', path], {
      windowsHide: true,
    });
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('close', () => {
      try {
        const tags = (JSON.parse(Buffer.concat(out).toString()) as { format?: { tags?: Record<string, string> } })
          .format?.tags ?? {};
        const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
        for (const n of names) {
          const v = lower.get(n.toLowerCase());
          if (v) return resolve(String(v));
        }
      } catch {
        // fall through
      }
      resolve(null);
    });
    child.on('error', () => resolve(null));
  });
}

async function tagBpm(path: string): Promise<number | null> {
  const value = Number(await probeTag(path, ['BPM', 'TBPM', 'tempo']));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function tagKey(path: string): Promise<string | null> {
  return probeTag(path, ['INITIAL_KEY', 'TKEY', 'key']);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : -120;
}

function modeOf(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A readable summary of a bass profile. */
export function formatBassProfile(profile: BassProfile): string {
  // Level per 16th as a bar: # loudest, + within 3 dB, - within 6 dB, . quieter.
  const level = profile.steps
    .map((s) => (s.levelDb >= -1 ? '#' : s.levelDb >= -3 ? '+' : s.levelDb >= -6 ? '-' : '.'))
    .join('');
  const bars = (row: string) => `|${row.slice(0, 4)}|${row.slice(4, 8)}|${row.slice(8, 12)}|${row.slice(12, 16)}|`;
  const pitched = profile.steps
    .filter((s) => s.pitchName)
    .map((s) => `${s.step + 1}:${s.pitchName}(${Math.round(s.pitchConfidence * 100)}%)`)
    .join('  ');
  const legato = profile.gate > 0.85;
  return [
    `BASS PROFILE: ${profile.file}`,
    `  tempo ${profile.bpm} BPM, ${profile.bars} bars of the drop from ${profile.section.startSeconds.toFixed(1)} s`,
    `  key tag ${profile.keyTag ?? '?'}; strongest pitch classes: ${profile.pitchClasses.map((p) => `${p.name} ${(p.weight * 100).toFixed(0)}%`).join(', ')}`,
    profile.register ? `  register ${midiName(profile.register.low)}..${midiName(profile.register.high)} (fundamental)` : '',
    `  level per 16th (# loudest, + within 3 dB, - within 6 dB):`,
    `    ${bars(level)}`,
    pitched ? `  steady pitches by step: ${pitched}` : '  pitches: not consistent enough to read',
    `  feel: ${legato ? 'legato, notes run into each other' : profile.gate < 0.55 ? 'short, plucky notes' : 'medium-length notes'} ` +
      `(sounds ${(profile.gate * 100).toFixed(0)}% of each 16th)`,
    `  kick ducking: ${profile.sidechainDepthDb.toFixed(1)} dB, recovered within ${profile.sidechainRecoveryMs} ms`,
    `  sub vs low-bass: ${profile.subToLowBassDb > 0 ? '+' : ''}${profile.subToLowBassDb.toFixed(1)} dB; low-end mono loss ${profile.lowMonoLossDb.toFixed(1)} dB`,
  ]
    .filter(Boolean)
    .join('\n');
}
