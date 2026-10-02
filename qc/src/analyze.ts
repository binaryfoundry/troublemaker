/**
 * Analyse one exported audio file.
 *
 * Two passes: ebur128 for loudness and true peak over the whole file, then a
 * PCM pass for spectrum, stereo and integrity - over the whole file and over
 * the comparable section (the loudest stretch, i.e. the drop, unless the
 * caller names one). Comparing drop to drop is what makes a reference
 * comparison meaningful; whole-track averages are dominated by arrangement.
 */

import { SignalAccumulator, loudestWindow } from './dsp.js';
import { measureLoudness, probe, streamPcm, QcError } from './ffmpeg.js';
import type { Analysis, Section } from './types.js';

export interface AnalyzeOptions {
  /** Explicit comparable section in seconds. Defaults to the loudest window. */
  section?: { start: number; duration: number };
  /** Length of the auto-detected loudest window. 30 s is ~16 bars at 128 BPM. */
  sectionSeconds?: number;
}

export async function analyzeFile(path: string, options: AnalyzeOptions = {}): Promise<Analysis> {
  const file = await probe(path);
  if (!Number.isFinite(file.sampleRate) || file.sampleRate <= 0) {
    throw new QcError('BAD_FILE', `${path} reports no sample rate.`);
  }
  if (file.channels < 1 || file.channels > 2) {
    throw new QcError(
      'UNSUPPORTED_CHANNELS',
      `${path} has ${file.channels} channels; QC handles mono and stereo masters.`,
    );
  }

  const { loudness, shortTerm } = await measureLoudness(path);

  const sectionSeconds = Math.min(options.sectionSeconds ?? 30, file.durationSeconds);
  let range: Section;
  let shortTermMeanLufs: number;
  if (options.section) {
    range = {
      startSeconds: options.section.start,
      durationSeconds: options.section.duration,
      source: 'user',
    };
    const from = Math.round(options.section.start * 10);
    const to = from + Math.round(options.section.duration * 10);
    const slice = shortTerm.slice(from, to).filter((v) => v > -70);
    shortTermMeanLufs = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : -70;
  } else if (file.durationSeconds <= sectionSeconds + 0.5) {
    range = { startSeconds: 0, durationSeconds: file.durationSeconds, source: 'whole' };
    shortTermMeanLufs = loudness.shortTermMaxLufs;
  } else {
    const loudest = loudestWindow(shortTerm, sectionSeconds);
    range = { startSeconds: loudest.startSeconds, durationSeconds: sectionSeconds, source: 'auto-loudest' };
    shortTermMeanLufs = loudest.meanLufs;
  }

  const whole = new SignalAccumulator(file.sampleRate);
  await streamPcm(path, file.sampleRate, (chunk) => whole.push(chunk), { channels: file.channels });

  const sectionStats =
    range.source === 'whole'
      ? whole.result()
      : await (async () => {
          const acc = new SignalAccumulator(file.sampleRate);
          await streamPcm(path, file.sampleRate, (chunk) => acc.push(chunk), {
            channels: file.channels,
            start: range.startSeconds,
            duration: range.durationSeconds,
          });
          return acc.result();
        })();

  return {
    file,
    loudness,
    shortTermSeries: shortTerm,
    whole: whole.result(),
    section: { ...sectionStats, range, shortTermMeanLufs: Math.round(shortTermMeanLufs * 100) / 100 },
  };
}
