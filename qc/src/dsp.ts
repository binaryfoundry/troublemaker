/**
 * Streaming signal statistics over interleaved stereo float samples.
 *
 * Designed to run over a whole track without holding it in memory: feed it
 * chunks as ffmpeg decodes them, then read the summary. Band energies use
 * 4th-order Butterworth band-pass filters (two cascaded biquads per edge; 8th
 * order at the 30 Hz infra edge, see STEEP_EDGE_HZ),
 * which is plenty of separation for tonal-balance comparison against
 * references - this is not a measurement-grade analyser and does not pretend
 * to be.
 */

import type { BandEnergy, SignalStats } from './types.js';

export interface BandSpec {
  name: string;
  lowHz: number;
  highHz: number;
}

/** Bands chosen around the decisions a club master actually turns on. */
export const BANDS: BandSpec[] = [
  { name: 'infra', lowHz: 0, highHz: 30 },
  { name: 'sub', lowHz: 30, highHz: 60 },
  { name: 'low-bass', lowHz: 60, highHz: 120 },
  { name: 'upper-bass', lowHz: 120, highHz: 250 },
  { name: 'low-mid', lowHz: 250, highHz: 500 },
  { name: 'mid', lowHz: 500, highHz: 2000 },
  { name: 'presence', lowHz: 2000, highHz: 5000 },
  { name: 'brilliance', lowHz: 5000, highHz: 10000 },
  { name: 'air', lowHz: 10000, highHz: 0 },
];

export const LOW_SPLIT_HZ = 120;

const CLIP_LEVEL = 0.9995;
const CLIP_RUN = 3;
const SILENCE = 1e-9;
/** Total cancellation reads as this rather than an unreadable -117 dB. */
const MONO_LOSS_FLOOR = -60;
const SIDE_FLOOR = -60;
const RELATIVE_FLOOR = -90;

/** RBJ cookbook biquad, transposed direct form II. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  static lowpass(sampleRate: number, hz: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * hz) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 - cos) / 2 / a0,
      (1 - cos) / a0,
      (1 - cos) / 2 / a0,
      (-2 * cos) / a0,
      (1 - alpha) / a0,
    );
  }

  static highpass(sampleRate: number, hz: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * hz) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 + cos) / 2 / a0,
      -(1 + cos) / a0,
      (1 + cos) / 2 / a0,
      (-2 * cos) / a0,
      (1 - alpha) / a0,
    );
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Butterworth 4th order = two 2nd-order sections with these Qs. */
const BUTTERWORTH_4_Q = [0.5411961, 1.3065630];
/** Butterworth 8th order = four sections. */
const BUTTERWORTH_8_Q = [0.5097955, 0.6013449, 0.8999762, 2.5629154];
/**
 * Edges at or below this use 8th order. A sub fundamental sits only a few
 * semitones above the 30 Hz infra edge (D1 is 36.7 Hz): a 4th-order edge let it
 * read as infra, 7.7 dB down, and flagged rumble that a brick-wall FFT showed was
 * not there (Threshold's low-end audit). 8th order puts it 14 dB down.
 */
const STEEP_EDGE_HZ = 40;

class BandFilter {
  private readonly stages: Biquad[] = [];

  constructor(sampleRate: number, lowHz: number, highHz: number) {
    const nyquist = sampleRate / 2;
    const qs = (hz: number) => (hz <= STEEP_EDGE_HZ ? BUTTERWORTH_8_Q : BUTTERWORTH_4_Q);
    if (lowHz > 0) {
      for (const q of qs(lowHz)) this.stages.push(Biquad.highpass(sampleRate, lowHz, q));
    }
    if (highHz > 0 && highHz < nyquist * 0.95) {
      for (const q of qs(highHz)) this.stages.push(Biquad.lowpass(sampleRate, highHz, q));
    }
  }

  process(x: number): number {
    let y = x;
    for (const stage of this.stages) y = stage.process(y);
    return y;
  }
}

export function toDb(power: number): number {
  return power > SILENCE * SILENCE ? 10 * Math.log10(power) : -200;
}

/**
 * Accumulates every statistic in one pass. Feed interleaved stereo samples
 * with push(), then call result().
 */
export class SignalAccumulator {
  private readonly midFilters: BandFilter[];
  private readonly sideFilters: BandFilter[];
  private readonly bandMid: Float64Array;
  private readonly bandSide: Float64Array;
  private readonly lowL: BandFilter;
  private readonly lowR: BandFilter;

  private frames = 0;
  private sumL = 0;
  private sumR = 0;
  private sumL2 = 0;
  private sumR2 = 0;
  private sumLR = 0;
  private sumMid2 = 0;
  private lowL2 = 0;
  private lowR2 = 0;
  private lowLR = 0;
  private lowMid2 = 0;
  private clippedRuns = 0;
  private runL = 0;
  private runR = 0;
  // Brick-wall infra: the mid signal low-passed at 120 Hz and decimated to
  // about 690 Hz (aliasing over 120 dB down), analysed by FFT at the end.
  private readonly infraLow: BandFilter;
  private readonly decimation: number;
  private readonly decimated: number[] = [];
  private decimationPhase = 0;

  constructor(
    readonly sampleRate: number,
    readonly bands: BandSpec[] = BANDS,
  ) {
    this.midFilters = bands.map((b) => new BandFilter(sampleRate, b.lowHz, b.highHz));
    this.sideFilters = bands.map((b) => new BandFilter(sampleRate, b.lowHz, b.highHz));
    this.bandMid = new Float64Array(bands.length);
    this.bandSide = new Float64Array(bands.length);
    this.lowL = new BandFilter(sampleRate, 0, LOW_SPLIT_HZ);
    this.lowR = new BandFilter(sampleRate, 0, LOW_SPLIT_HZ);
    this.infraLow = new BandFilter(sampleRate, 0, LOW_SPLIT_HZ);
    this.decimation = Math.max(1, Math.round(sampleRate / 690));
  }

  /** Interleaved L,R,L,R... float samples. */
  push(samples: Float32Array): void {
    const bandCount = this.bands.length;
    for (let i = 0; i + 1 < samples.length; i += 2) {
      const l = samples[i]!;
      const r = samples[i + 1]!;
      this.frames += 1;

      this.sumL += l;
      this.sumR += r;
      this.sumL2 += l * l;
      this.sumR2 += r * r;
      this.sumLR += l * r;

      const mid = (l + r) / 2;
      const side = (l - r) / 2;
      this.sumMid2 += mid * mid;

      const low = this.infraLow.process(mid);
      if (++this.decimationPhase >= this.decimation) {
        this.decimationPhase = 0;
        this.decimated.push(low);
      }

      for (let b = 0; b < bandCount; b += 1) {
        const m = this.midFilters[b]!.process(mid);
        const s = this.sideFilters[b]!.process(side);
        this.bandMid[b]! += m * m;
        this.bandSide[b]! += s * s;
      }

      const ll = this.lowL.process(l);
      const lr = this.lowR.process(r);
      this.lowL2 += ll * ll;
      this.lowR2 += lr * lr;
      this.lowLR += ll * lr;
      const lowMid = (ll + lr) / 2;
      this.lowMid2 += lowMid * lowMid;

      this.runL = Math.abs(l) >= CLIP_LEVEL ? this.runL + 1 : 0;
      this.runR = Math.abs(r) >= CLIP_LEVEL ? this.runR + 1 : 0;
      if (this.runL === CLIP_RUN) this.clippedRuns += 1;
      if (this.runR === CLIP_RUN) this.clippedRuns += 1;
    }
  }

  result(): SignalStats {
    const n = Math.max(1, this.frames);
    const midPower = this.sumMid2 / n;
    const midDb = toDb(midPower);

    const bands: BandEnergy[] = this.bands.map((spec, b) => {
      const bandMidDb = toDb(this.bandMid[b]! / n);
      const bandSideDb = toDb(this.bandSide[b]! / n);
      return {
        name: spec.name,
        lowHz: spec.lowHz,
        highHz: spec.highHz,
        midDb: round(bandMidDb),
        sideDb: round(bandSideDb),
        midRelativeDb: round(Math.max(RELATIVE_FLOOR, bandMidDb - midDb)),
        // Clamped: a band with no side signal is "effectively mono", not -200 dB.
        sideToMidDb: round(Math.max(SIDE_FLOOR, Math.min(-SIDE_FLOOR, bandSideDb - bandMidDb))),
      };
    });

    const stereoPower = (this.sumL2 + this.sumR2) / 2 / n;
    const lowStereoPower = (this.lowL2 + this.lowR2) / 2 / n;

    return {
      bands,
      stereo: {
        correlation: round(correlation(this.sumLR, this.sumL2, this.sumR2), 4),
        lowCorrelation: round(correlation(this.lowLR, this.lowL2, this.lowR2), 4),
        monoLossDb: round(Math.max(MONO_LOSS_FLOOR, toDb(midPower) - toDb(stereoPower))),
        lowMonoLossDb: round(
          Math.max(MONO_LOSS_FLOOR, toDb(this.lowMid2 / n) - toDb(lowStereoPower)),
        ),
      },
      integrity: {
        clippedRuns: this.clippedRuns,
        dcOffset: [round(this.sumL / n, 6), round(this.sumR / n, 6)],
        silentChannel: this.sumL2 / n < SILENCE || this.sumR2 / n < SILENCE,
      },
      rmsDb: round(toDb(stereoPower)),
      frames: this.frames,
      infraToSubDb: infraToSub(this.decimated, this.sampleRate / this.decimation),
    };
  }
}

/**
 * Energy below 30 Hz relative to 30-60 Hz, by Welch-averaged FFT: a brick-wall
 * split. The band filters' skirts read a low sub fundamental (E1, 41 Hz) as
 * infra - Black Glass showed "+9 dB of infra" that the FFT put level with
 * Pryda's "The Return". Null when the signal is too short or has no sub.
 */
export function infraToSub(x: number[], rate: number): number | null {
  const n = 1024;
  if (x.length < n) return null;
  const psd = new Float64Array(n / 2);
  for (let start = 0; start + n <= x.length; start += n / 2) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i += 1) re[i] = x[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im);
    for (let k = 0; k < n / 2; k += 1) psd[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  let infra = 0, sub = 0;
  for (let k = 1; k < n / 2; k += 1) {
    const hz = (k * rate) / n;
    if (hz < 30) infra += psd[k]!;
    else if (hz < 60) sub += psd[k]!;
  }
  if (sub <= 1e-20) return null;
  return round(10 * Math.log10(Math.max(infra, 1e-30) / sub));
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(angle * k), wi = Math.sin(angle * k);
        const a = i + k, b = i + k + len / 2;
        const vr = re[b]! * wr - im[b]! * wi;
        const vi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a] = re[a]! + vr;
        im[a] = im[a]! + vi;
      }
    }
  }
}

function correlation(lr: number, l2: number, r2: number): number {
  const denominator = Math.sqrt(l2 * r2);
  return denominator > 0 ? lr / denominator : 1;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The loudest stretch of a short-term loudness series (100 ms steps).
 * Used to compare drop to drop rather than whole track to whole track.
 */
export function loudestWindow(
  series: number[],
  windowSeconds: number,
  stepSeconds = 0.1,
): { startSeconds: number; meanLufs: number } {
  const width = Math.max(1, Math.round(windowSeconds / stepSeconds));
  // The first 3 s of short-term loudness are its window filling up: they read
  // far below the audio (down to -70) and are not the music's level. On a
  // whole track the loudest window never starts there, but a 30 s capture has
  // to include them, and they pulled a -11.8 LUFS capture down to -16.1.
  const warmup = Math.round(3 / stepSeconds);
  const skip = series.length > warmup * 2 ? warmup : 0;
  const usable = series.slice(skip);
  if (usable.length <= width) {
    const finite = usable.filter((v) => v > -70);
    const mean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : -70;
    return { startSeconds: 0, meanLufs: round(mean) };
  }
  let sum = 0;
  for (let i = 0; i < width; i += 1) sum += Math.max(usable[i]!, -70);
  let best = sum;
  let bestStart = 0;
  for (let i = width; i < usable.length; i += 1) {
    sum += Math.max(usable[i]!, -70) - Math.max(usable[i - width]!, -70);
    if (sum > best) {
      best = sum;
      bestStart = i - width + 1;
    }
  }
  // Short-term loudness lags by its 3 s window; shift back so the section
  // covers the audio that produced the reading.
  const start = Math.max(0, (bestStart + skip + 1) * stepSeconds - 3);
  return { startSeconds: round(start, 1), meanLufs: round(best / width) };
}
