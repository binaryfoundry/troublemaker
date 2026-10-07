/**
 * ffmpeg / ffprobe wrappers.
 *
 * Loudness and true peak come from ffmpeg's ebur128 filter, which implements
 * ITU-R BS.1770 - standards-compatible measurement is not something to
 * reimplement. Raw PCM for the spectrum/stereo pass is streamed from ffmpeg
 * so a long track never has to fit in memory.
 */

import { spawn } from 'node:child_process';

import type { FileInfo, LoudnessStats } from './types.js';

const FFMPEG = process.env.TROUBLEMAKER_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.TROUBLEMAKER_FFPROBE ?? 'ffprobe';

export class QcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QcError';
  }
}

export function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new QcError(
              'FFMPEG_MISSING',
              `'${command}' was not found. Install ffmpeg and put it on PATH, or set ` +
                'TROUBLEMAKER_FFMPEG / TROUBLEMAKER_FFPROBE.',
            )
          : error,
      );
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        reject(new QcError('DECODE_FAILED', `${command} exited with ${code}: ${tail(stderr)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-3).join(' | ');
}

function sectionArgs(start?: number, duration?: number): string[] {
  const args: string[] = [];
  if (start !== undefined && start > 0) args.push('-ss', String(start));
  if (duration !== undefined && duration > 0) args.push('-t', String(duration));
  return args;
}

export async function probe(path: string): Promise<FileInfo> {
  const { stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample,sample_fmt:format=duration',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<Record<string, string | number>>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  if (!stream) throw new QcError('NO_AUDIO', `${path} contains no audio stream.`);
  const bits = Number(stream.bits_per_raw_sample ?? stream.bits_per_sample ?? 0);
  return {
    path,
    codec: String(stream.codec_name ?? '?'),
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    bitDepth: bits > 0 ? bits : null,
    sampleFormat: String(stream.sample_fmt ?? '?'),
    durationSeconds: Number(parsed.format?.duration ?? 0),
  };
}

/** Parse ebur128's end-of-run summary and its per-frame short-term readings. */
export function parseEbur128(stderr: string): {
  loudness: Omit<LoudnessStats, 'plrDb' | 'shortTermMaxLufs'>;
  shortTerm: number[];
} {
  const shortTerm: number[] = [];
  for (const match of stderr.matchAll(/\bS:\s*(-?[\d.]+|-inf)/g)) {
    shortTerm.push(match[1] === '-inf' ? -120 : Number(match[1]));
  }
  const summaryIndex = stderr.lastIndexOf('Summary:');
  if (summaryIndex < 0) throw new QcError('LOUDNESS_FAILED', 'ebur128 produced no summary.');
  const summary = stderr.slice(summaryIndex);

  const number = (pattern: RegExp, label: string): number => {
    const match = pattern.exec(summary);
    if (!match) throw new QcError('LOUDNESS_FAILED', `ebur128 summary had no ${label}.`);
    return match[1] === '-inf' ? -120 : Number(match[1]);
  };

  return {
    loudness: {
      integratedLufs: number(/I:\s*(-?[\d.]+|-inf)\s*LUFS/, 'integrated loudness'),
      loudnessRangeLu: number(/LRA:\s*(-?[\d.]+)\s*LU/, 'loudness range'),
      samplePeakDbfs: number(/Sample peak:\s*Peak:\s*(-?[\d.]+|-inf)/, 'sample peak'),
      truePeakDbtp: number(/True peak:\s*Peak:\s*(-?[\d.]+|-inf)/, 'true peak'),
    },
    shortTerm,
  };
}

export async function measureLoudness(
  path: string,
  start?: number,
  duration?: number,
): Promise<{ loudness: LoudnessStats; shortTerm: number[] }> {
  const { stderr } = await run(FFMPEG, [
    '-hide_banner',
    '-nostats',
    ...sectionArgs(start, duration),
    '-i',
    path,
    // Downloads often embed cover art as a video stream; ignore it.
    '-vn',
    '-filter_complex',
    'ebur128=peak=true+sample:framelog=info',
    '-f',
    'null',
    '-',
  ]);
  const { loudness, shortTerm } = parseEbur128(stderr);
  // The first 3 s of short-term readings cover a partially filled window.
  const settled = shortTerm.slice(Math.min(30, Math.floor(shortTerm.length / 2)));
  const shortTermMaxLufs = Math.max(-120, ...settled);
  return {
    loudness: {
      ...loudness,
      shortTermMaxLufs,
      plrDb: Math.round((loudness.truePeakDbtp - loudness.integratedLufs) * 100) / 100,
    },
    shortTerm,
  };
}

/**
 * Decode to interleaved stereo float32 and hand each chunk to `onChunk`.
 * Mono sources are duplicated to both channels without a pan law, so a mono
 * file measures as perfectly correlated rather than 3 dB down.
 */
export function streamPcm(
  path: string,
  sampleRate: number,
  onChunk: (samples: Float32Array) => void,
  options: { start?: number; duration?: number; channels: number },
): Promise<void> {
  const filter = options.channels === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : ['-ac', '2'];
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    ...sectionArgs(options.start, options.duration),
    '-i',
    path,
    '-vn',
    ...filter,
    '-ar',
    String(sampleRate),
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    '-',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    let carry: Buffer = Buffer.alloc(0);
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = data.length - (data.length % 8);
      if (usable > 0) {
        // Copy into an aligned buffer; Float32Array needs 4-byte alignment.
        const aligned = new Float32Array(usable / 4);
        Buffer.from(aligned.buffer).set(data.subarray(0, usable));
        onChunk(aligned);
      }
      carry = data.subarray(usable);
    });
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new QcError('FFMPEG_MISSING', `'${FFMPEG}' was not found on PATH.`)
          : error,
      ),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new QcError('DECODE_FAILED', `ffmpeg exited with ${code}: ${tail(Buffer.concat(err).toString())}`),
        );
      } else {
        resolve();
      }
    });
  });
}
