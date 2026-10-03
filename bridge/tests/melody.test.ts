/**
 * EDM-TIPS.md melody method as code: rhythm first, chord tones on strong
 * beats, a recognisable repeated motif, a varied answer and a resolution.
 */

import { describe, expect, it } from 'vitest';

import { checkMelody, motifMelody, motifRhythm } from '../../agent/src/melody.js';
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
