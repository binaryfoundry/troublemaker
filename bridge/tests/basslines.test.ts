/**
 * BASSLINES.md as code: the pattern library, transposition, development
 * form, the repeat-merging fix and the troubleshooting checks.
 */

import { describe, expect, it } from 'vitest';

import { bassPattern, bassPatternNames, checkBassline, developBar, mergeRepeats, parseBassGrid } from '../../agent/src/basslines.js';
import { bassFromFeel } from '../../agent/src/patterns.js';

describe('bass pattern library', () => {
  it('holds the BASSLINES.md, MELODIC-TECHNO.md and ERIC.md patterns', () => {
    expect(bassPatternNames()).toEqual([
      'house_offbeat', 'house_harmonic', 'rolling_techno', 'sparse_techno', 'dnb_sub', 'dubstep_halftime_sub', 'ukg_shuffle', 'dnb_reese_upper', 'melodic_techno_syncopated', 'progressive_rolling', 'progressive_octave',
    ]);
    for (const name of bassPatternNames()) expect(bassPattern(name).events.length).toBeGreaterThan(0);
  });

  it('reads the notation: rests, ties and note/velocity in scientific pitch', () => {
    const events = parseBassGrid('C1/112 ~ — — | — G1/94 — — | Bb0/103 — C1/108 — | — — G0/90 —');
    expect(events[0]).toMatchObject({ beat: 0, pitch: 24, velocity: 112 });
    expect(events[0]!.duration).toBeCloseTo(0.475, 6);
    expect(events.map((e) => e.pitch)).toEqual([24, 31, 22, 24, 19]);
  });

  it('puts the house offbeat line on the offbeats, clear of the kick', () => {
    const p = bassPattern('house_offbeat');
    expect(p.events.map((e) => e.beat)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(checkBassline(p, { kicks: [0, 1, 2, 3] })).toEqual([]);
  });

  it('transposes the shortest way, keeping the register', () => {
    const c = bassPattern('house_offbeat').events.map((e) => e.pitch);
    expect(bassPattern('house_offbeat', { root: 'F' }).events.map((e) => e.pitch)).toEqual(c.map((p) => p + 5));
    expect(bassPattern('house_offbeat', { root: 'G' }).events.map((e) => e.pitch)).toEqual(c.map((p) => p - 5));
  });
});

describe('melodic techno bass', () => {
  it('plays MELODIC-TECHNO.md’s two bars in D, answering the kick rather than sitting on it', () => {
    const p = bassPattern('melodic_techno_syncopated');
    expect(p.length_beats).toBe(8);
    expect(p.events[0]).toMatchObject({ beat: 0.5, pitch: 38, velocity: 103 });
    expect(p.events.map((e) => e.pitch % 12)).toEqual([2, 2, 9, 0, 2, 5, 0, 9]);
    expect(checkBassline(p, { kicks: [0, 1, 2, 3, 4, 5, 6, 7] })).toEqual([]);
  });

  it('moves into the track key from D', () => {
    expect(bassPattern('melodic_techno_syncopated', { root: 'F' }).events[0]!.pitch).toBe(41);
  });
});

describe('progressive house basses', () => {
  it('rolls between the kicks with short notes that do not restart into each other', () => {
    const p = bassPattern('progressive_rolling', { root: 'F' });
    expect(p.events.some((e) => Math.abs(e.beat - Math.round(e.beat)) < 1e-6)).toBe(false);
    expect(checkBassline(p, { bpm: 126, kicks: [0, 1, 2, 3] })).toEqual([]);
  });
});

describe('development form', () => {
  const bar = parseBassGrid('— — C2/108 — | — — G1/96 — | — — Bb1/102 — | — — G1/94 —');

  it('A2 makes exactly one change', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const a2 = developBar(bar, 'A2', seed);
      const changes = a2.length === bar.length ? bar.filter((e, i) => a2[i]!.pitch !== e.pitch).length : bar.length - a2.length;
      expect(changes).toBe(1);
    }
  });

  it('B thins the line, A3 lifts the last note an octave and approaches the next downbeat', () => {
    expect(developBar(bar, 'B').length).toBeLessThan(bar.length);
    const a3 = developBar(bar, 'A3');
    expect(a3.find((e) => e.beat === 3.5)!.pitch).toBe(bar.at(-1)!.pitch + 12);
    expect(a3.some((e) => e.beat === 3.75)).toBe(true);
  });

  it('builds A A2 B A3 sections, each opening on the familiar bar', () => {
    const p = bassPattern('house_offbeat', { form: true, barsPerSection: 2 });
    expect(p.length_beats).toBe(32);
    const barAt = (n: number) => p.events.filter((e) => e.beat >= n * 4 && e.beat < n * 4 + 4).map((e) => [e.pitch, e.beat - n * 4]);
    expect(barAt(2)).toEqual(barAt(0));
    expect(barAt(6)).toEqual(barAt(0));
  });
});

describe('bass checks', () => {
  it('flags the end-to-end build bass: sixteen envelope restarts a bar, and fixes it by merging', () => {
    const steps = Array.from({ length: 16 }, (_, step) => ({ step, levelDb: 0, sharedWithKick: step % 4 === 0, pitch: 29 }));
    const bass = bassFromFeel({ steps, gate: 0.92, rootMidi: 29 }, { bars: 1, skipKickSteps: false, transpose: 12 });
    const before = checkBassline(bass);
    expect(before.some((f) => /restart the envelope/.test(f.message))).toBe(true);
    const merged = mergeRepeats(bass);
    expect(merged.events.length).toBeLessThan(bass.events.length);
    expect(checkBassline(merged).some((f) => /restart the envelope/.test(f.message))).toBe(false);
  });

  it('warns about a fundamental below 40 Hz in a sub, not in an upper layer', () => {
    const low = bassPattern('dnb_sub');
    expect(checkBassline(low, { bpm: 174 }).some((f) => /below ~40 Hz/.test(f.message))).toBe(true);
    expect(checkBassline(low, { bpm: 174, layer: 'upper' }).some((f) => /below ~40 Hz/.test(f.message))).toBe(false);
  });

  it('flags clicky short notes, overlaps, polyphony, kick stacking and off-chord strong beats', () => {
    const p = { length_beats: 4, events: [
      { beat: 0, pitch: 41, duration: 0.03, velocity: 100 },
      { beat: 1, pitch: 41, duration: 1.5, velocity: 100 },
      { beat: 2, pitch: 44, duration: 0.5, velocity: 100 },
      { beat: 3, pitch: 42, duration: 0.25, velocity: 100 },
      { beat: 3, pitch: 46, duration: 0.25, velocity: 100 },
    ] };
    const text = checkBassline(p, { kicks: [0, 1, 2, 3], chords: [[41, 44, 48]], beatsPerChord: 4 }).map((f) => f.message).join(' ');
    expect(text).toMatch(/shorter than 30 ms/);
    expect(text).toMatch(/overlap/);
    expect(text).toMatch(/stacked notes/);
    expect(text).toMatch(/start with the kick/);
    expect(text).toMatch(/not in the sounding chord/);
  });
});
