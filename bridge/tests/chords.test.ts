/**
 * CHORDS.md as code: chord symbols, the eight templates, voice leading,
 * slash basses and the checks.
 */

import { describe, expect, it } from 'vitest';

import { checkChords, chordKnowledge, chordTemplate, parseChordSymbol, parseSlot, templateInKey, transposeSymbol, voiceLeadingReport, voiceProgression } from '../../agent/src/chords.js';

const pcs = (pitches: number[]) => [...new Set(pitches.map((p) => p % 12))].sort((a, b) => a - b);

describe('chord symbols', () => {
  it.each([
    ['F#m9', 6, [0, 3, 7, 10, 14]],
    ['Dmaj7', 2, [0, 4, 7, 11]],
    ['Aadd9', 9, [0, 4, 7, 14]],
    ['E6/9sus4', 4, [0, 5, 7, 9, 14]],
    ['Cm(add9)', 0, [0, 3, 7, 14]],
    ['A7alt', 9, [0, 4, 10, 13, 15]],
    ['G13', 7, [0, 4, 7, 10, 14, 21]],
    ['Dm11', 2, [0, 3, 7, 10, 14, 17]],
    ['Ebmaj9', 3, [0, 4, 7, 11, 14]],
  ])('parses %s', (symbol, root, intervals) => {
    const c = parseChordSymbol(symbol);
    expect(c.root).toBe(root);
    expect(c.intervals).toEqual(intervals);
    expect(c.bass).toBeNull();
  });

  it('tells a slash bass from the 9 in 6/9', () => {
    expect(parseChordSymbol('C/E').bass).toBe(4);
    expect(parseChordSymbol('Cmaj7/D').bass).toBe(2);
    expect(parseChordSymbol('E6/9sus4').bass).toBeNull();
  });

  it('splits a resolution slot such as Gsus4→G', () => {
    expect(parseSlot('Gsus4→G').map((c) => c.quality)).toEqual(['sus4', '']);
  });

  it('refuses an unknown quality with the known ones', () => {
    expect(() => parseChordSymbol('Cblah')).toThrow(/Known/);
  });
});

describe('progressions', () => {
  it('holds the eight CHORDS.md templates and every symbol parses', () => {
    const templates = chordKnowledge().templates;
    expect(Object.keys(templates)).toEqual(['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'MT1', 'MT2', 'MT3']);
    for (const t of Object.values(templates)) expect(() => voiceProgression(t.progression)).not.toThrow();
  });

  it('voices each chord with exactly its pitch classes', () => {
    const voiced = voiceProgression(chordTemplate('H01').progression);
    expect(pcs(voiced[0]!.pitches)).toEqual(pcs([6, 9, 13, 16, 20]));
    expect(pcs(voiced[1]!.pitches)).toEqual(pcs([2, 6, 9, 13]));
  });

  it('splits a resolution slot in time', () => {
    const voiced = voiceProgression(chordTemplate('H03').progression, { beatsPerChord: 4 });
    expect(voiced.slice(-2).map((c) => [c.symbol, c.beat, c.beats])).toEqual([['Gsus4', 12, 2], ['G', 14, 2]]);
  });

  it('stands slash chords on their bass note: H08 keeps a D pedal', () => {
    const voiced = voiceProgression(chordTemplate('H08').progression);
    for (const chord of voiced.slice(0, 3)) expect(Math.min(...chord.pitches) % 12).toBe(2);
    expect(Math.min(...voiceProgression(['C/E'])[0]!.pitches) % 12).toBe(4);
  });

  it('moves little between chords and keeps common tones', () => {
    for (const step of voiceLeadingReport(voiceProgression(chordTemplate('H01').progression))) {
      expect(step.motion).toBeLessThanOrEqual(8);
      expect(step.commonTones).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('transposition', () => {
  it('moves templates into a key and spells them for that key', () => {
    expect(templateInKey('MT1', 'F')).toEqual(['Fm', 'Eb', 'Db', 'Eb']);
    expect(templateInKey('MT3', 'A')).toEqual(['Am(add9)/A', 'F/A', 'G/A', 'Am/A']);
    expect(templateInKey('H01', 'F#')).toEqual(chordTemplate('H01').progression);
    expect(transposeSymbol('Gsus4→G', 2)).toBe('Asus4→A');
  });

  it('keeps a pedal on one note while the upper voices move', () => {
    const voiced = voiceProgression(templateInKey('MT3', 'F'));
    expect(new Set(voiced.map((c) => Math.min(...c.pitches))).size).toBe(1);
    expect(checkChords(voiced)).toEqual([]);
  });
});

describe('chord checks', () => {
  it('flags mud, over-extension and a jumpy change', () => {
    const text = checkChords([
      { symbol: 'Cm', pitches: [36, 39, 43], beat: 0, beats: 4 },
      { symbol: 'G13', pitches: [55, 59, 62, 65, 69, 76], beat: 4, beats: 4 },
      { symbol: 'C', pitches: [72, 76, 79], beat: 8, beats: 4 },
    ]).map((f) => f.message).join(' ');
    expect(text).toMatch(/muddy/);
    expect(text).toMatch(/6 voices/);
    expect(text).toMatch(/moves \d+ semitones/);
  });

  it('passes the deep house template', () => {
    expect(checkChords(voiceProgression(chordTemplate('H01').progression)).filter((f) => f.severity === 'warn')).toEqual([]);
  });
});
