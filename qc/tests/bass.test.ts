import { describe, expect, it } from 'vitest';

import { hzToMidi, midiName, yin } from '../src/bass.js';
import { bassFromFeel } from '../../agent/src/patterns.js';

const RATE = 11025;

function sine(hz: number, seconds = 0.2): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

describe('pitch tracking', () => {
  it('finds the fundamental of a bass tone', () => {
    for (const hz of [43.65, 55, 87.31, 130.8]) {
      const found = yin(sine(hz), 0, 2000)!;
      expect(Math.abs(found - hz) / hz).toBeLessThan(0.01);
    }
  });

  it('returns null for silence', () => {
    expect(yin(new Float32Array(3000), 0, 2000)).toBeNull();
  });

  it("names notes the way Live's piano roll does", () => {
    expect(hzToMidi(43.65)).toBe(29);
    expect(midiName(29)).toBe('F0');
    expect(midiName(60)).toBe('C3');
    expect(midiName(34)).toBe('A#0');
  });
});

describe('bassFromFeel', () => {
  // The Aname / Fehrplay profile: F0 after each kick, Bb on steps 4 and 16.
  const steps = Array.from({ length: 16 }, (_, step) => ({
    step,
    levelDb: step % 4 === 1 ? 0 : -2,
    sharedWithKick: step % 4 === 0,
    pitch: step === 3 || step === 15 ? 34 : step % 4 === 1 ? 29 : null,
  }));
  const feel = { steps, gate: 0.92, rootMidi: 29 };

  it('leaves the kick 16ths empty and keeps the rest of the roll', () => {
    const pattern = bassFromFeel(feel, { bars: 1 });
    expect(pattern.events.map((e) => e.beat * 4)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]);
  });

  it('keeps the reference pitches, filling unsteady steps with the root', () => {
    const pitches = bassFromFeel(feel, { bars: 1 }).events.map((e) => e.pitch);
    expect(pitches[2]).toBe(34); // step 4: Bb
    expect(pitches[1]).toBe(29); // step 3: no steady pitch -> root
  });

  it('transposes, for synths that add a sub-octave', () => {
    expect(bassFromFeel(feel, { bars: 1, transpose: 12 }).events[0]!.pitch).toBe(41);
  });

  it('turns the gate into note length and level into accents', () => {
    const events = bassFromFeel(feel, { bars: 1 }).events;
    expect(events[0]!.duration).toBeCloseTo(0.23, 2);
    expect(events[0]!.velocity).toBeGreaterThan(events[1]!.velocity);
  });

  it('can keep the kick 16ths when a sidechain will duck them', () => {
    expect(bassFromFeel(feel, { bars: 1, skipKickSteps: false }).events).toHaveLength(16);
  });

  it('repeats the bar across the requested length', () => {
    expect(bassFromFeel(feel, { bars: 4 }).events).toHaveLength(48);
  });
});
