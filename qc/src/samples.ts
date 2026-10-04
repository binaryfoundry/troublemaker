/**
 * A measured sample library. Every WAV is classified from its pack's folder
 * structure (role, key and BPM from names) and measured on the dimensions
 * Ableton_Sound_Selection_Expert.md asks a selector to judge: transient
 * (attack time, click), envelope (tail length), frequency footprint (band
 * energy, sub weight, brightness), tonal versus noisy (stable pitch) and
 * stereo width. Measurements rank candidates; listening still decides.
 *
 * Results are cached by path and modification time, so a rescan only
 * analyses new or changed files.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { SignalAccumulator } from './dsp.js';
import { probe, streamPcm } from './ffmpeg.js';
import { hzToMidi, midiName, yin } from './bass.js';

export interface SampleEntry {
  path: string;
  /** Path inside the library, with '/' separators. */
  relative: string;
  pack: string;
  name: string;
  role: string;
  /** Finer kind within the role: uplifter, downlifter, reese, loop... */
  kind: string | null;
  loop: boolean;
  key: string | null;
  bpm: number | null;
  durationSeconds: number;
  /** Time from 10% to 90% of the peak envelope, in ms. */
  attackMs: number;
  /** Time from the peak until the envelope falls 30 dB, in ms. */
  tailMs: number;
  /** Energy below 60 Hz as a share of the total, in dB. */
  subDb: number;
  /** Energy 2-10 kHz as a share of the total, in dB: brightness and click. */
  brightDb: number;
  /** Energy-weighted spectral centre, Hz (from band energies). */
  centroidHz: number;
  /** Side relative to mid, dB; very negative is mono. */
  widthDb: number;
  /** Stable fundamental, if the sound is tonal. */
  pitchHz: number | null;
  note: string | null;
  mtimeMs: number;
}

const ANALYSIS_RATE = 44100;
const ANALYSIS_SECONDS = 4;
const CACHE_VERSION = 2;

const ROLE_RULES: Array<[RegExp, string, string | null]> = [
  [/\bdrum loops?|\btop loops?|\bloops?\b/i, 'loop', 'loop'],
  [/\bkicks?\b/i, 'kick', null],
  [/\bclaps?\b/i, 'clap', null],
  [/\bsnaps?\b/i, 'clap', 'snap'],
  [/\bsnares?\b/i, 'snare', null],
  [/\bhats?\b|\bhihat|\bhi-hat/i, 'hats', null],
  [/\bcymbals?|\bcrash|\bride\b/i, 'hats', 'cymbal'],
  [/\bpercussion|\bpercs?\b|\bshaker|\brim\b|\btoms?\b|\bconga|\bbongo/i, 'perc', null],
  [/\bfills?\b/i, 'perc', 'fill'],
  [/uplifters?|risers?/i, 'fx', 'uplifter'],
  [/downlifters?|impacts?/i, 'fx', 'downlifter'],
  [/white noise|noise/i, 'fx', 'noise'],
  [/ambience|atmos|texture|drone/i, 'atmosphere', 'ambience'],
  [/foley/i, 'perc', 'foley'],
  [/reeses?|growls?|glitch bass|bass/i, 'bass', null],
  [/analog|synth shots?|stab|pluck|lead|chord/i, 'lead', null],
  [/vocals?|vox|raps?|voice/i, 'vocal', null],
  [/\bfx\b|misc/i, 'fx', 'misc'],
];

/** Role from the folders and name, most specific folder first. */
export function classifySample(relativePath: string): { role: string; kind: string | null; loop: boolean } {
  // Underscores and dashes separate words in sample names ("ETCT1_Loops_Full_...").
  const parts = relativePath.split('/').map((p) => p.replace(/[_-]+/g, ' '));
  for (const part of [...parts].reverse()) {
    for (const [pattern, role, kind] of ROLE_RULES) {
      if (pattern.test(part)) return { role, kind: kind ?? (/reese/i.test(part) ? 'reese' : /growl/i.test(part) ? 'growl' : null), loop: role === 'loop' };
    }
  }
  return { role: 'unknown', kind: null, loop: false };
}

export function keyFromName(name: string): string | null {
  const m = /(?:^|[\s_\-(])([A-G](?:#|b)?)(m|min|maj)?(?=[\s_\-).]|$)/.exec(name.replace(/\.[a-z0-9]+$/i, ''));
  return m ? `${m[1]}${m[2] === 'm' || m[2] === 'min' ? 'm' : ''}` : null;
}

export function bpmFromName(name: string, loop = false): number | null {
  const m = /(\d{2,3})\s*bpm/i.exec(name);
  if (m) return Number(m[1]);
  if (!loop) return null;
  // Loops often carry a bare tempo between separators: "..._140_1.wav".
  const bare = /(?:^|[\s_\-])(\d{2,3})(?=[\s_\-.])/.exec(name);
  const bpm = bare ? Number(bare[1]) : NaN;
  return bpm >= 60 && bpm <= 200 ? bpm : null;
}

function bandCentre(low: number, high: number): number {
  return high === 0 ? 14000 : low === 0 ? 20 : Math.sqrt(low * high);
}

export async function analyzeSample(path: string, root: string): Promise<SampleEntry> {
  const info = await probe(path);
  const rel = relative(root, path).split(sep).join('/');
  const { role, kind, loop } = classifySample(rel);
  const acc = new SignalAccumulator(ANALYSIS_RATE);
  const mono: number[] = [];
  await streamPcm(path, ANALYSIS_RATE, (chunk) => {
    acc.push(chunk);
    for (let i = 0; i < chunk.length; i += 2) mono.push((chunk[i]! + chunk[i + 1]!) / 2);
  }, { duration: ANALYSIS_SECONDS, channels: 2 });
  const stats = acc.result();

  // Envelope in 2 ms frames.
  const frame = Math.round(ANALYSIS_RATE * 0.002);
  const env: number[] = [];
  for (let i = 0; i + frame <= mono.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j += 1) s += mono[j]! * mono[j]!;
    env.push(Math.sqrt(s / frame));
  }
  const peak = Math.max(1e-9, ...env);
  const peakAt = env.indexOf(peak);
  const firstAbove = (level: number) => env.findIndex((v) => v >= peak * level);
  const attackMs = Math.max(0, (firstAbove(0.9) - Math.max(0, firstAbove(0.1))) * 2);
  let tailEnd = peakAt;
  for (let i = env.length - 1; i > peakAt; i -= 1) {
    if (env[i]! >= peak * 10 ** (-30 / 20)) { tailEnd = i; break; }
  }
  const tailMs = (tailEnd - peakAt) * 2;

  const power = stats.bands.map((b) => 10 ** (b.midDb / 10) + 10 ** (b.sideDb / 10));
  const total = power.reduce((a, b) => a + b, 0) || 1e-12;
  const share = (names: string[]) => 10 * Math.log10(Math.max(1e-12, stats.bands.reduce((s, b, i) => s + (names.includes(b.name) ? power[i]! : 0), 0) / total));
  const centroidHz = stats.bands.reduce((s, b, i) => s + bandCentre(b.lowHz, b.highHz) * power[i]!, 0) / total;
  const mid = stats.bands.reduce((s, b) => s + 10 ** (b.midDb / 10), 0);
  const side = stats.bands.reduce((s, b) => s + 10 ** (b.sideDb / 10), 0);

  // A stable pitch on the body after the attack: consistent YIN estimates across windows.
  const floats = Float32Array.from(mono);
  const start = Math.min(floats.length, (peakAt + 10) * frame);
  const window = Math.round(ANALYSIS_RATE * 0.06);
  const estimates: number[] = [];
  for (let at = start; at + window < Math.min(floats.length, start + ANALYSIS_RATE * 0.5); at += window) {
    const hz = yin(floats, at, window, ANALYSIS_RATE, 30, 1200);
    if (hz) estimates.push(hz);
  }
  let pitchHz: number | null = null;
  if (estimates.length >= 2) {
    const sorted = [...estimates].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const agree = estimates.filter((h) => Math.abs(1200 * Math.log2(h / median)) < 50).length;
    if (agree / estimates.length >= 0.6) pitchHz = Math.round(median * 10) / 10;
  }

  return {
    path,
    relative: rel,
    pack: rel.split('/')[0] ?? '',
    name: basename(path),
    role,
    kind,
    loop,
    key: keyFromName(basename(path)),
    bpm: bpmFromName(basename(path), loop),
    durationSeconds: Math.round(info.durationSeconds * 1000) / 1000,
    attackMs: Math.round(attackMs),
    tailMs: Math.round(tailMs),
    subDb: Math.round(share(['infra', 'sub']) * 10) / 10,
    brightDb: Math.round(share(['presence', 'brilliance']) * 10) / 10,
    centroidHz: Math.round(centroidHz),
    widthDb: Math.round(10 * Math.log10(Math.max(1e-12, side) / Math.max(1e-12, mid)) * 10) / 10,
    pitchHz,
    note: pitchHz ? midiName(Math.round(hzToMidi(pitchHz))) : null,
    mtimeMs: statSync(path).mtimeMs,
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Ableton projects keep copies of samples; index the packs, not the projects.
      if (/project files|backup|ableton project info|stems|master/i.test(entry.name)) continue;
      walk(full, out);
    } else if (/\.(wav|aif|aiff|flac)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export interface SampleIndex {
  root: string;
  entries: SampleEntry[];
}

export async function scanSamples(
  root: string,
  options: { cacheDir?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<SampleIndex> {
  if (!existsSync(root)) throw new Error(`Sample folder ${root} does not exist.`);
  const cacheDir = options.cacheDir ?? join(process.env.TROUBLEMAKER_DATA_DIR ?? '.troublemaker', 'samples');
  const cacheFile = join(cacheDir, `${Buffer.from(root).toString('base64url')}.json`);
  let cache: Record<string, SampleEntry> = {};
  if (existsSync(cacheFile)) {
    const parsed = JSON.parse(readFileSync(cacheFile, 'utf8')) as { version: number; entries: SampleEntry[] };
    if (parsed.version === CACHE_VERSION) cache = Object.fromEntries(parsed.entries.map((e) => [e.path, e]));
  }
  const files = walk(root);
  const entries: SampleEntry[] = [];
  let done = 0;
  for (const file of files) {
    const cached = cache[file];
    if (cached && cached.mtimeMs === statSync(file).mtimeMs) {
      entries.push(cached);
    } else {
      try {
        entries.push(await analyzeSample(file, root));
      } catch {
        // Unreadable file: skip it.
      }
    }
    done += 1;
    options.onProgress?.(done, files.length);
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ version: CACHE_VERSION, entries }), 'utf8');
  return { root, entries };
}
