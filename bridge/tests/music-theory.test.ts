import { describe, expect, it } from 'vitest';

import {
  barToBeat,
  barsToBeats,
  beatToBar,
  beatsPerBar,
  diatonicChord,
  makeRandom,
  midiToNoteName,
  noteNameToMidi,
  quantizeTime,
  scaleNotes,
  scalePitches,
  seedFrom,
  snapToScale,
} from '../../agent/src/music-theory.js';

describe('note names', () => {
  it("uses Ableton's octave numbering by default, so middle C is C3", () => {
    expect(noteNameToMidi('C3')).toBe(60);
    expect(midiToNoteName(60)).toBe('C3');
    expect(noteNameToMidi('F1')).toBe(41);
  });

  it('supports scientific pitch notation, where middle C is C4', () => {
    expect(noteNameToMidi('C4', 'scientific')).toBe(60);
    // The convention the implementation plan's example assumes.
    expect(noteNameToMidi('F1', 'scientific')).toBe(29);
  });

  it('handles accidentals in both directions', () => {
    expect(noteNameToMidi('C#3')).toBe(61);
    expect(noteNameToMidi('Db3')).toBe(61);
    expect(noteNameToMidi('Bb2')).toBe(58);
  });

  it('round-trips every MIDI pitch', () => {
    for (let pitch = 0; pitch <= 127; pitch += 1) {
      expect(noteNameToMidi(midiToNoteName(pitch))).toBe(pitch);
    }
  });

  it('rejects names outside MIDI range and malformed input', () => {
    expect(() => noteNameToMidi('C9')).toThrow(/0-127/);
    expect(() => noteNameToMidi('H3')).toThrow(/note name/);
    expect(() => noteNameToMidi('C')).toThrow(/octave/);
  });
});

describe('scales', () => {
  it('builds the scales the plan requires', () => {
    expect(scaleNotes('C', 'major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleNotes('C', 'natural minor')).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(scaleNotes('C', 'harmonic_minor')).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(scaleNotes('C', 'melodic minor')).toEqual([0, 2, 3, 5, 7, 9, 11]);
    expect(scaleNotes('C', 'dorian')).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(scaleNotes('C', 'phrygian')).toEqual([0, 1, 3, 5, 7, 8, 10]);
  });

  it('transposes the root correctly and wraps the octave', () => {
    expect(scaleNotes('F', 'minor').sort((a, b) => a - b)).toEqual([0, 1, 3, 5, 7, 8, 10]);
  });

  it('rejects an unknown scale with a usable message', () => {
    expect(() => scaleNotes('C', 'bebop')).toThrow(/Known scales/);
  });

  it('lists in-range scale pitches ascending', () => {
    const pitches = scalePitches('F', 'minor', 36, 48);
    expect(pitches).toEqual([36, 37, 39, 41, 43, 44, 46, 48]);
    expect(pitches.every((p, i, all) => i === 0 || p > all[i - 1]!)).toBe(true);
  });

  it('snaps out-of-key pitches to the nearest scale tone', () => {
    // 42 is F#2, not in F minor; 41 (F2) is a semitone below.
    expect(snapToScale(42, 'F', 'minor')).toBe(41);
    expect(snapToScale(41, 'F', 'minor')).toBe(41);
  });
});

describe('chords', () => {
  it('stacks diatonic thirds inside the scale', () => {
    // i in F minor at octave 3: F3, Ab3, C4.
    expect(diatonicChord('F', 'minor', 1, { octave: 3 })).toEqual([65, 68, 72]);
  });

  it('builds sevenths when asked for four notes', () => {
    expect(diatonicChord('C', 'major', 1, { octave: 3, size: 4 })).toEqual([60, 64, 67, 71]);
  });

  it('rejects a nonsense degree or size', () => {
    expect(() => diatonicChord('C', 'major', 0)).toThrow(/degree/);
    expect(() => diatonicChord('C', 'major', 1, { size: 9 })).toThrow(/size/);
  });
});

describe('bars and beats', () => {
  it('maps 1-based bars to 0-based beats as the plan specifies', () => {
    expect(barToBeat(1)).toBe(0);
    expect(barToBeat(2)).toBe(4);
    expect(barToBeat(9)).toBe(32);
  });

  it('inverts cleanly', () => {
    expect(beatToBar(0)).toEqual({ bar: 1, beatInBar: 0 });
    expect(beatToBar(33.5)).toEqual({ bar: 9, beatInBar: 1.5 });
  });

  it('respects other time signatures', () => {
    expect(beatsPerBar({ numerator: 3, denominator: 4 })).toBe(3);
    expect(beatsPerBar({ numerator: 7, denominator: 8 })).toBe(3.5);
    expect(barToBeat(3, { numerator: 3, denominator: 4 })).toBe(6);
    expect(barsToBeats(4, { numerator: 6, denominator: 8 })).toBe(12);
  });

  it('rejects zero and negative bars', () => {
    expect(() => barToBeat(0)).toThrow(/start at 1/);
    expect(() => beatToBar(-1)).toThrow(/start at 0/);
  });
});

describe('quantize', () => {
  it('snaps to the grid at full strength', () => {
    expect(quantizeTime(1.03, 0.25)).toBe(1);
    expect(quantizeTime(1.2, 0.25)).toBe(1.25);
  });

  it('moves partway at partial strength', () => {
    expect(quantizeTime(1.2, 0.25, 0.5)).toBeCloseTo(1.225, 6);
  });

  it('leaves the note alone at zero strength', () => {
    expect(quantizeTime(1.2, 0.25, 0)).toBe(1.2);
  });
});

describe('seeded randomness', () => {
  it('is reproducible, so the same prompt gives the same edit', () => {
    const a = makeRandom(42);
    const b = makeRandom(42);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it('differs between seeds and stays within 0..1', () => {
    const a = makeRandom(1);
    const b = makeRandom(2);
    expect(a()).not.toBe(b());
    const values = Array.from({ length: 500 }, () => makeRandom(7)());
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('derives a stable seed from text', () => {
    expect(seedFrom('Bass Main')).toBe(seedFrom('Bass Main'));
    expect(seedFrom('Bass Main')).not.toBe(seedFrom('Bass Alt'));
  });
});
