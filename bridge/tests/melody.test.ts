/**
 * EDM-TIPS.md melody method as code: rhythm first, chord tones on strong
 * beats, a recognisable repeated motif, a varied answer and a resolution.
 */

import { describe, expect, it } from 'vitest';

import { checkMelody, checkMelodyShape, motifMelody, motifRhythm } from '../../agent/src/melody.js';
import { progression } from '../../agent/src/music-theory.js';

const chords = progression('F', 'minor', [1, 6, 3, 7], { voicing: 'seventh' });
const options = { chords, beatsPerChord: 4, root: 'F' };
const bar = (p: ReturnType<typeof motifMelody>, n: number) => p.events.filter((e) => e.beat >= n * 4 && e.beat < n * 4 + 4);

describe('motif melody', () => {
  it('starts the motif rhythm on the downbeat with the requested number of notes', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const r = motifRhythm(5, seed);
      expect(r[0]).toBe(0);
      expect(r.length).toBe(5);
    }
  });

  it('repeats the rhythm in A bars and answers it in the B bar', () => {
    const p = motifMelody({ ...options, seed: 3 });
    const rhythm = (n: number) => bar(p, n).map((e) => e.beat - n * 4);
    expect(rhythm(1)).toEqual(rhythm(0));
    expect(rhythm(2)).toEqual(rhythm(0));
    expect(rhythm(3)).not.toEqual(rhythm(0));
  });

  it('puts chord tones on the strong beats, stays in a singable range and resolves to the tonic', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const p = motifMelody({ ...options, seed });
      expect(checkMelody(p, options).filter((f) => f.severity === 'warn'), `seed ${seed}`).toEqual([]);
      expect(p.events.at(-1)!.pitch % 12).toBe(5);
    }
  });

  it('is reproducible for a seed', () => {
    expect(motifMelody({ ...options, seed: 7 })).toEqual(motifMelody({ ...options, seed: 7 }));
  });

  it('flags a melody that ignores the harmony and sprawls', () => {
    const bad = { length_beats: 4, events: [0, 1, 2, 3].map((beat, i) => ({ beat, pitch: [61, 85, 62, 86][i]!, duration: 0.5, velocity: 100 })) };
    const text = checkMelody(bad, options).map((f) => f.message).join(' ');
    expect(text).toMatch(/chord tones/);
    expect(text).toMatch(/spans/);
  });
});

describe('melodic techno motif', () => {
  it('holds MELODIC-TECHNO.md\u2019s two-bar motif and moves it into a key', async () => {
    const { templateMotif } = await import('../../agent/src/melody.js');
    const d = templateMotif();
    expect(d.length_beats).toBe(8);
    expect(d.events.map((e) => e.pitch % 12)).toEqual([9, 0, 2, 5, 4, 2, 9, 1]);
    expect(templateMotif('F').events[0]!.pitch).toBe(d.events[0]!.pitch + 3);
  });

  it('varies one dimension at a time without rewriting the motif', async () => {
    const { templateMotif, varyMotif } = await import('../../agent/src/melody.js');
    const base = templateMotif();
    const opts = { root: 'D', seed: 2 };
    const pitches = (p: typeof base) => p.events.map((e) => e.pitch);
    const beats = (p: typeof base) => p.events.map((e) => e.beat);

    const octave = varyMotif(base, 'octave', opts);
    expect(pitches(octave).filter((p, i) => p !== pitches(base)[i]).length).toBe(1);
    expect(beats(octave)).toEqual(beats(base));

    const rhythm = varyMotif(base, 'rhythm', opts);
    expect(pitches(rhythm)).toEqual(pitches(base));
    expect(beats(rhythm).filter((b, i) => b !== beats(base)[i]).length).toBe(1);

    const last = varyMotif(base, 'last_note', opts);
    expect(pitches(last).slice(0, -1)).toEqual(pitches(base).slice(0, -1));
    expect(last.events.at(-1)!.pitch).not.toBe(base.events.at(-1)!.pitch);

    expect(pitches(varyMotif(base, 'velocity', opts))).toEqual(pitches(base));
    expect(pitches(varyMotif(base, 'gate', opts))).toEqual(pitches(base));
    expect(pitches(varyMotif(base, 'register', opts))).toEqual(pitches(base).map((p) => p - 12));
  });
});

/**
 * MELODY.md's phrase-shape checks. These exist because of a real failure: a
 * lead was written whose sixteen bars all started on the tonic. Every note was
 * a chord tone and the range and leaps were fine, so the EDM-TIPS checks above
 * passed it - and it still sounded like an exercise.
 */
describe('checkMelodyShape (MELODY.md)', () => {
  const roots = [9, 5, 0, 7]; // A F C G
  const shapeOptions = { chords, chordRoots: roots, beatsPerChord: 16, root: 'A', barsPerPhrase: 8 };

  /** Three notes a bar on the dotted-8th positions, pitches given per chord. */
  const build = (perChord: number[][], bars = 16) => ({
    length_beats: bars * 4,
    events: Array.from({ length: bars }, (_, b) =>
      [0, 1.5, 2.75].map((offset, i) => ({
        beat: b * 4 + offset,
        pitch: perChord[Math.floor(b / 4) % perChord.length]![i]!,
        duration: 0.7,
        velocity: 90,
      })),
    ).flat(),
  });

  it('catches a melody that starts every bar on the tonic', () => {
    // The exact shape of the original mistake: A C E over all four chords.
    const melody = build([[81, 84, 88], [81, 84, 88], [81, 84, 88], [81, 84, 88]]);
    const findings = checkMelodyShape(melody, shapeOptions);
    expect(findings.some((f) => f.severity === 'warn' && /start on the tonic/.test(f.message))).toBe(true);
  });

  it('passes the rewritten melody, which targets thirds and sevenths', () => {
    // Am7 C E G, Fmaj7 same (recoloured), Cadd9 G E D, Gsus4 D G A.
    const melody = build([[84, 88, 91], [84, 88, 91], [91, 88, 86], [86, 91, 93]]);
    const findings = checkMelodyShape(melody, shapeOptions);
    expect(findings.filter((f) => f.severity === 'warn')).toEqual([]);
  });

  it('warns when most notes land on the root of the chord beneath them', () => {
    const melody = build([[81, 81, 81], [77, 77, 77], [84, 84, 84], [79, 79, 79]]);
    const findings = checkMelodyShape(melody, shapeOptions);
    expect(findings.some((f) => /land on the root/.test(f.message))).toBe(true);
  });

  it('notices when every bar has the same contour', () => {
    const melody = build([[84, 88, 91], [84, 88, 91], [84, 88, 91], [84, 88, 91]]);
    const findings = checkMelodyShape(melody, shapeOptions);
    expect(findings.some((f) => /same up contour/.test(f.message))).toBe(true);
  });

  it('notices identical pitches over every chord', () => {
    const melody = build([[84, 88, 91], [84, 88, 91], [84, 88, 91], [84, 88, 91]]);
    const findings = checkMelodyShape(melody, shapeOptions);
    expect(findings.some((f) => /identical pitches over every chord/.test(f.message))).toBe(true);
  });

  it('reports an empty melody rather than throwing', () => {
    expect(checkMelodyShape({ length_beats: 64, events: [] }, shapeOptions)).toEqual([
      { severity: 'warn', message: 'The melody is empty.' },
    ]);
  });
});
