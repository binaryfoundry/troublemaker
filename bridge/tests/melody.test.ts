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
