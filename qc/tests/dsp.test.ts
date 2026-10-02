import { describe, expect, it } from 'vitest';

import { BANDS, SignalAccumulator, loudestWindow } from '../src/dsp.js';
import { parseEbur128 } from '../src/ffmpeg.js';

const RATE = 48000;

/** Interleaved stereo float samples from per-channel functions of time. */
function stereo(seconds: number, left: (t: number) => number, right = left): Float32Array {
  const frames = Math.round(seconds * RATE);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const t = i / RATE;
    out[i * 2] = left(t);
    out[i * 2 + 1] = right(t);
  }
  return out;
}

const sine = (hz: number, amp = 0.5) => (t: number) => amp * Math.sin(2 * Math.PI * hz * t);

function analyse(samples: Float32Array) {
  const acc = new SignalAccumulator(RATE);
  acc.push(samples);
  return acc.result();
}

function band(result: ReturnType<typeof analyse>, name: string) {
  return result.bands.find((b) => b.name === name)!;
}

describe('band energy', () => {
  it('puts a 45 Hz tone in the sub band', () => {
    const result = analyse(stereo(2, sine(45)));
    const loudest = [...result.bands].sort((a, b) => b.midDb - a.midDb)[0]!;
    expect(loudest.name).toBe('sub');
    expect(band(result, 'sub').midRelativeDb).toBeGreaterThan(-1.5);
  });

  it('puts a 3 kHz tone in the presence band and keeps the sub band quiet', () => {
    const result = analyse(stereo(2, sine(3000)));
    expect(band(result, 'presence').midRelativeDb).toBeGreaterThan(-1.5);
    expect(band(result, 'sub').midRelativeDb).toBeLessThan(-60);
  });

  it('covers the spectrum with no gaps between bands', () => {
    for (let i = 1; i < BANDS.length; i += 1) {
      expect(BANDS[i]!.lowHz).toBe(BANDS[i - 1]!.highHz);
    }
  });

  it('measures a band level independently of overall loudness', () => {
    const quiet = analyse(stereo(2, (t) => sine(45, 0.1)(t) + sine(3000, 0.1)(t)));
    const loud = analyse(stereo(2, (t) => sine(45, 0.5)(t) + sine(3000, 0.5)(t)));
    expect(band(quiet, 'sub').midRelativeDb).toBeCloseTo(band(loud, 'sub').midRelativeDb, 1);
  });
});

describe('stereo', () => {
  it('reads identical channels as fully correlated and mono-safe', () => {
    const result = analyse(stereo(1, sine(60)));
    expect(result.stereo.correlation).toBeCloseTo(1, 3);
    expect(result.stereo.lowMonoLossDb).toBeCloseTo(0, 1);
  });

  it('reads inverted bass as cancelling in mono', () => {
    const result = analyse(stereo(1, sine(60), (t) => -sine(60)(t)));
    expect(result.stereo.lowCorrelation).toBeCloseTo(-1, 3);
    expect(result.stereo.lowMonoLossDb).toBeLessThanOrEqual(-59);
    expect(band(result, 'low-bass').sideToMidDb).toBe(60);
  });

  it('reads uncorrelated channels as about 3 dB down in mono', () => {
    let seed = 1;
    const noise = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const result = analyse(stereo(1, () => noise(), () => noise()));
    expect(Math.abs(result.stereo.correlation)).toBeLessThan(0.05);
    expect(result.stereo.monoLossDb).toBeCloseTo(-3, 0);
  });

  it('clamps side energy in a purely mono band to the floor', () => {
    expect(band(analyse(stereo(1, sine(60))), 'low-bass').sideToMidDb).toBe(-60);
  });
});

describe('integrity', () => {
  it('counts runs of full-scale samples as clipping', () => {
    const clipped = stereo(1, (t) => Math.max(-1, Math.min(1, 3 * Math.sin(2 * Math.PI * 100 * t))));
    expect(analyse(clipped).integrity.clippedRuns).toBeGreaterThan(100);
  });

  it('does not count a clean full-range sine as clipping', () => {
    expect(analyse(stereo(1, sine(100, 0.99))).integrity.clippedRuns).toBe(0);
  });

  it('measures DC offset per channel', () => {
    const result = analyse(stereo(1, (t) => 0.01 + sine(100, 0.2)(t), sine(100, 0.2)));
    expect(result.integrity.dcOffset[0]).toBeCloseTo(0.01, 3);
    expect(Math.abs(result.integrity.dcOffset[1])).toBeLessThan(1e-3);
  });

  it('flags a silent channel', () => {
    expect(analyse(stereo(1, sine(100), () => 0)).integrity.silentChannel).toBe(true);
  });

  it('gives the same answer however the stream is chunked', () => {
    const samples = stereo(1, (t) => sine(45)(t) + sine(5000, 0.2)(t));
    const whole = analyse(samples);
    const acc = new SignalAccumulator(RATE);
    for (let i = 0; i < samples.length; i += 1000) acc.push(samples.subarray(i, i + 1000));
    expect(acc.result()).toEqual(whole);
  });
});

describe('loudest window', () => {
  it('finds the drop in a short-term loudness series', () => {
    const series = [
      ...Array(300).fill(-14), // 30 s intro
      ...Array(300).fill(-7), // 30 s drop
      ...Array(300).fill(-12),
    ];
    const window = loudestWindow(series, 30);
    expect(window.meanLufs).toBeCloseTo(-7, 1);
    // Shifted back by the 3 s short-term window: the drop audio starts at 30 s.
    expect(window.startSeconds).toBeGreaterThan(25);
    expect(window.startSeconds).toBeLessThan(31);
  });

  it('handles a series shorter than the window', () => {
    expect(loudestWindow([-10, -10], 30).meanLufs).toBe(-10);
  });
});

describe('ebur128 parsing', () => {
  const sample = `
[Parsed_ebur128_0 @ 0x1] t: 0.1  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x1] t: 3.1  TARGET:-23 LUFS    M: -8.1 S:  -8.4     I: -8.3 LUFS       LRA:   1.0 LU
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -8.3 LUFS
    Threshold: -18.3 LUFS

  Loudness range:
    LRA:         4.2 LU
    Threshold: -28.3 LUFS

  Sample peak:
    Peak:       -1.2 dBFS

  True peak:
    Peak:       -0.6 dBFS
`;

  it('reads the summary', () => {
    const { loudness } = parseEbur128(sample);
    expect(loudness).toEqual({
      integratedLufs: -8.3,
      loudnessRangeLu: 4.2,
      samplePeakDbfs: -1.2,
      truePeakDbtp: -0.6,
    });
  });

  it('reads the short-term series', () => {
    expect(parseEbur128(sample).shortTerm).toEqual([-120.7, -8.4]);
  });

  it('reads silence as a floor rather than failing', () => {
    const silent = sample.replace('I:          -8.3 LUFS', 'I:          -inf LUFS');
    expect(parseEbur128(silent).loudness.integratedLufs).toBe(-120);
  });

  it('fails clearly when ffmpeg produced no summary', () => {
    expect(() => parseEbur128('garbage')).toThrow(/no summary/);
  });
});
