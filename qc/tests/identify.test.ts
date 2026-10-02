import { describe, expect, it } from 'vitest';

import { classify, detectOnsets, extractFeatures, IDENTIFY_RATE } from '../src/identify.js';

const RATE = IDENTIFY_RATE;

/** Short tone bursts at the given times, each at its own frequency. */
function bursts(times: number[], hz: number[] | number, seconds: number, burstSeconds = 0.012): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  times.forEach((t, k) => {
    const f = Array.isArray(hz) ? hz[k]! : hz;
    const start = Math.round(t * RATE);
    const n = Math.round(burstSeconds * RATE);
    for (let i = 0; i < n && start + i < out.length; i += 1) {
      const env = Math.exp(-i / (n / 4));
      out[start + i] = (out[start + i] ?? 0) + 0.6 * env * Math.sin((2 * Math.PI * f * i) / RATE);
    }
  });
  return out;
}

/** Event times whose spacing grows (or shrinks) by a constant ratio. */
function geometricTimes(first: number, ratio: number, count: number): number[] {
  const times = [0.05];
  let gap = first;
  for (let i = 1; i < count; i += 1) {
    times.push(times[i - 1]! + gap);
    gap *= ratio;
  }
  return times;
}

describe('onset detection', () => {
  it('finds each burst', () => {
    const times = [0.1, 0.3, 0.5, 0.7];
    expect(detectOnsets(bursts(times, 800, 1))).toHaveLength(4);
  });
});

describe('effect identification', () => {
  it('hears the roulette wheel slowing down as retrigger deceleration', () => {
    const times = geometricTimes(0.03, 1.18, 16);
    const id = classify(extractFeatures(bursts(times, 700, times.at(-1)! + 0.3, 0.06)));
    expect(id.effect).toBe('retrigger_deceleration');
    expect(id.features.ioiRatio!).toBeGreaterThan(1.6);
  });

  it('hears shrinking intervals as an exponential ratchet', () => {
    const times = geometricTimes(0.3, 0.85, 16);
    const id = classify(extractFeatures(bursts(times, 700, times.at(-1)! + 0.3, 0.06)));
    expect(id.effect).toBe('exponential_ratchet');
  });

  it('separates a tape stop: spacing grows and pitch falls together', () => {
    const times = geometricTimes(0.05, 1.15, 14);
    const hz = times.map((_, i) => 800 * Math.pow(0.5, i / 6)); // falls two octaves-ish
    const id = classify(extractFeatures(bursts(times, hz, times.at(-1)! + 0.3, 0.06)));
    expect(id.effect).toBe('tape_stop');
    expect(id.features.pitchChangeSemitones!).toBeLessThan(-6);
  });

  it('hears a steady repeat rate as a gate or beat repeat', () => {
    const times = Array.from({ length: 16 }, (_, i) => 0.05 + i * 0.121);
    const id = classify(extractFeatures(bursts(times, 600, 2.2, 0.06)));
    expect(['trance_gate', 'beat_repeat']).toContain(id.effect);
  });

  it('hears brightness opening with no timing change as a filter sweep', () => {
    const seconds = 2;
    const out = new Float32Array(seconds * RATE);
    let seed = 7;
    let y = 0;
    for (let i = 0; i < out.length; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const noise = seed / 2147483648 - 0.5;
      // One-pole low-pass whose cutoff opens over time.
      const cutoff = 200 * Math.pow(60, i / out.length);
      const a = Math.exp((-2 * Math.PI * cutoff) / RATE);
      y = (1 - a) * noise + a * y;
      out[i] = y * 4;
    }
    const id = classify(extractFeatures(out));
    expect(id.effect).toBe('filter_sweep');
    expect(id.features.brightnessRatio).toBeGreaterThan(1.8);
  });

  it('always labels the result as an auditory identification', () => {
    const id = classify(extractFeatures(bursts([0.1, 0.5], 500, 1)));
    expect(id.evidenceKind).toBe('auditory');
  });
});
