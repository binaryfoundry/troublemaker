import { describe, expect, it } from 'vitest';

import {
  DRUMS,
  arpeggio,
  chordProgression,
  fourOnTheFloorKick,
  mergePatterns,
  offbeatHat,
  repeatPattern,
  rollingBass,
  sixteenthHats,
  slicePattern,
  snareRoll,
  toNotes,
} from '../../agent/src/patterns.js';
import { validateArgs } from '../src/validation.js';

/** Every generator must produce notes the bridge will actually accept. */
function assertWritable(notes: ReturnType<typeof toNotes>): void {
  expect(() =>
    validateArgs('live.replace_notes', { track_id: 1, clip_slot: 0, notes }),
  ).not.toThrow();
}

describe('four on the floor', () => {
  it('puts a kick on every beat of a bar', () => {
    const pattern = fourOnTheFloorKick({ bars: 1 });
    expect(pattern.length_beats).toBe(4);
    expect(pattern.events.map((e) => e.beat)).toEqual([0, 1, 2, 3]);
    expect(pattern.events.every((e) => e.pitch === DRUMS.kick)).toBe(true);
  });

  it('scales to four bars', () => {
    expect(fourOnTheFloorKick({ bars: 4 }).events).toHaveLength(16);
  });

  it('accents the bar downbeat', () => {
    const events = fourOnTheFloorKick({ bars: 2, seed: 1 }).events;
    expect(events[0]!.velocity).toBeGreaterThan(events[1]!.velocity);
  });

  it('is deterministic for a given seed', () => {
    expect(fourOnTheFloorKick({ bars: 2, seed: 9 })).toEqual(
      fourOnTheFloorKick({ bars: 2, seed: 9 }),
    );
  });

  it('produces writable notes', () => {
    assertWritable(toNotes(fourOnTheFloorKick({ bars: 4 })));
  });
});

describe('hats', () => {
  it('places offbeat hats on the and of every beat', () => {
    expect(offbeatHat({ bars: 1 }).events.map((e) => e.beat)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it('places sixteenth hats on every sixteenth', () => {
    const events = sixteenthHats({ bars: 1 }).events;
    expect(events).toHaveLength(16);
    expect(events[1]!.beat).toBe(0.25);
  });

  it('accents eighths above the sixteenths between them', () => {
    const events = sixteenthHats({ bars: 1, seed: 3 }).events;
    expect(events[0]!.velocity).toBeGreaterThan(events[1]!.velocity);
  });
});

describe('snare roll', () => {
  it('accelerates and gets louder towards the end', () => {
    const events = snareRoll({ bars: 1, seed: 1 }).events;
    expect(events.length).toBeGreaterThan(4);
    const firstGap = events[1]!.beat - events[0]!.beat;
    const lastGap = events.at(-1)!.beat - events.at(-2)!.beat;
    expect(lastGap).toBeLessThan(firstGap);
    expect(events.at(-1)!.velocity).toBeGreaterThan(events[0]!.velocity);
  });

  it('stays inside the clip', () => {
    const pattern = snareRoll({ bars: 2 });
    expect(Math.max(...pattern.events.map((e) => e.beat))).toBeLessThan(pattern.length_beats);
  });
});

describe('rolling bass', () => {
  it('stays in key', () => {
    const pattern = rollingBass({ bars: 2, root: 'F', scale: 'minor', seed: 5 });
    const fMinorClasses = new Set([5, 7, 8, 10, 0, 1, 3]);
    expect(pattern.events.every((e) => fMinorClasses.has(e.pitch % 12))).toBe(true);
  });

  it('leaves the downbeat free for the kick', () => {
    const pattern = rollingBass({ bars: 2, root: 'F', seed: 5 });
    expect(pattern.events.some((e) => e.beat % 1 === 0)).toBe(false);
  });

  it('respects the low pitch floor', () => {
    const pattern = rollingBass({ bars: 2, root: 'F', lowPitch: 36, seed: 5 });
    expect(Math.min(...pattern.events.map((e) => e.pitch))).toBeGreaterThanOrEqual(36);
  });

  it('gets busier as density rises', () => {
    const sparse = rollingBass({ bars: 4, root: 'F', density: 0.2, seed: 5 });
    const dense = rollingBass({ bars: 4, root: 'F', density: 1, seed: 5 });
    expect(dense.events.length).toBeGreaterThan(sparse.events.length);
  });

  it('produces writable notes', () => {
    assertWritable(toNotes(rollingBass({ bars: 4, root: 'F', seed: 2 })));
  });
});

describe('arpeggio', () => {
  it('cycles the supplied pitches', () => {
    const pattern = arpeggio({ bars: 1, pitches: [60, 63, 67], division: 0.5 });
    expect(pattern.events.map((e) => e.pitch)).toEqual([60, 63, 67, 60, 63, 67, 60, 63]);
  });

  it('reverses when asked to run down', () => {
    const pattern = arpeggio({ bars: 1, pitches: [60, 63, 67], division: 1, direction: 'down' });
    expect(pattern.events.slice(0, 3).map((e) => e.pitch)).toEqual([67, 63, 60]);
  });

  it('refuses to arpeggiate nothing', () => {
    expect(() => arpeggio({ bars: 1, pitches: [] })).toThrow(/at least one pitch/);
  });
});

describe('chord progression', () => {
  it('writes one chord per bar for each degree', () => {
    const pattern = chordProgression({ root: 'F', scale: 'minor', degrees: [1, 6, 3, 7] });
    expect(pattern.length_beats).toBe(16);
    expect(new Set(pattern.events.map((e) => e.beat))).toEqual(new Set([0, 4, 8, 12]));
  });

  it('stops each chord short of the next so voices do not overlap', () => {
    const pattern = chordProgression({ root: 'F', scale: 'minor', degrees: [1, 6] });
    for (const event of pattern.events) {
      expect(event.beat + event.duration).toBeLessThanOrEqual(
        Math.ceil((event.beat + 1) / 4) * 4,
      );
    }
  });
});

describe('pattern algebra', () => {
  it('repeats a one-bar idea across a longer span', () => {
    const repeated = repeatPattern(fourOnTheFloorKick({ bars: 1 }), 16);
    expect(repeated.length_beats).toBe(16);
    expect(repeated.events).toHaveLength(16);
    expect(Math.max(...repeated.events.map((e) => e.beat))).toBe(15);
  });

  it('never writes past the requested length', () => {
    const repeated = repeatPattern(fourOnTheFloorKick({ bars: 4 }), 10);
    expect(repeated.events.every((e) => e.beat < 10)).toBe(true);
  });

  it('merges layers and keeps the longest length', () => {
    const merged = mergePatterns(fourOnTheFloorKick({ bars: 1 }), offbeatHat({ bars: 2 }));
    expect(merged.length_beats).toBe(8);
    expect(merged.events).toHaveLength(4 + 8);
  });

  it('slices a window and rebases it to zero', () => {
    const sliced = slicePattern(fourOnTheFloorKick({ bars: 4 }), 4, 8);
    expect(sliced.length_beats).toBe(4);
    expect(sliced.events.map((e) => e.beat)).toEqual([0, 1, 2, 3]);
  });
});

describe('toNotes', () => {
  it('sorts by time and rounds to clean beat values', () => {
    const notes = toNotes({
      length_beats: 4,
      events: [
        { beat: 2, pitch: 40, duration: 0.25, velocity: 100 },
        { beat: 0, pitch: 36, duration: 0.25, velocity: 100 },
      ],
    });
    expect(notes.map((n) => n.start)).toEqual([0, 2]);
  });

  it('clamps velocity into the writable range', () => {
    const notes = toNotes({
      length_beats: 4,
      events: [{ beat: 0, pitch: 36, duration: 1, velocity: 300 }],
    });
    expect(notes[0]!.velocity).toBe(127);
  });
});
