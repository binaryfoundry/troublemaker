/**
 * ABLETON_VOCALS_EXPERT.md, the API-actionable parts: chop phrases, the
 * chop checker and the vocal plan.
 */

import { describe, expect, it } from 'vitest';

import { checkChops, vocalChop, vocalPlan } from '../../agent/src/vocals.js';
import { planArrangement } from '../../agent/src/arrangement.js';

describe('vocal chops', () => {
  it('writes an anchored phrase with few pitches, space, a repeated motif and a changed ending', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const p = vocalChop({ root: 'F', seed });
      expect(checkChops(p), `seed ${seed}`).toEqual([]);
      expect(new Set(p.events.map((e) => e.pitch)).size).toBeLessThanOrEqual(4);
      expect(p.events[0]!.pitch % 12).toBe(5);
      const lastOf = (bar: number) => p.events.filter((e) => e.beat >= bar * 4 && e.beat < bar * 4 + 4).at(-1)!;
      expect(lastOf(3).pitch).not.toBe(lastOf(0).pitch);
    }
  });

  it('flags a chop phrase that would sound random', () => {
    const random = { length_beats: 8, events: Array.from({ length: 24 }, (_, i) => ({ beat: i * 0.25 + (i > 11 ? 0.25 : 0), pitch: 60 + (i % 7), duration: 0.2, velocity: 100 })) };
    const text = checkChops(random).map((f) => f.message).join(' ');
    expect(text).toMatch(/different pitches/);
    expect(text).toMatch(/No anchor note/);
    expect(text).toMatch(/too many syllables/);
    expect(text).toMatch(/negative space/);
  });
});

describe('vocal plan', () => {
  it('holds the hook back, fragments it at drops, opens it in the break and saves the richest version for the end', () => {
    const plan = vocalPlan(planArrangement('melodic_techno'));
    const by = (name: string) => plan.find((c) => c.section === name)!;
    expect(by('Intro').ladder).toBe(1);
    expect(by('Break').treatment).toMatch(/fullest lyric/);
    expect(by('Drop A').treatment).toMatch(/removed at the drop impact/);
    expect(by('Final Peak').treatment).toMatch(/richest version/);
    expect(by('Outro').ladder).toBeNull();
  });
});
