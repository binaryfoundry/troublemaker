/**
 * DRUMS.md as code: templates, variation, fills, swing/humanisation by role,
 * and the checker. Properties, not exact note lists.
 */

import { describe, expect, it } from 'vitest';

import {
  checkDrumPattern,
  drumGenres,
  drumGrids,
  drumKnowledge,
  drumPattern,
  drumTemplate,
  fillGrid,
  formatGrid,
  varyGrid,
  type Grid,
} from '../../agent/src/drums.js';
import { mergePatterns, offbeatHat, sixteenthHats, fourOnTheFloorKick, backbeatSnare } from '../../agent/src/patterns.js';

const BD = 36, SD = 38, CP = 39, CH = 42, OH = 46, RD = 51;
const beatsOf = (p: ReturnType<typeof drumPattern>, pitch: number) => p.events.filter((e) => e.pitch === pitch).map((e) => e.beat);
const count = (g: Grid) => Object.values(g).reduce((n, row) => n + [...row!].filter((c) => c !== '.').length, 0);

describe('drum templates', () => {
  it('covers the five genres in DRUMS.md with 16-step rows', () => {
    expect(drumGenres()).toEqual(['house', 'techno', 'hiphop', 'trap', 'electro']);
    for (const g of drumGenres()) {
      for (const bar of drumTemplate(g).bars) for (const row of Object.values(bar)) expect(row).toHaveLength(16);
    }
  });

  it('writes the 909 house skeleton: kick on every beat, clap on 2 and 4, open hats on the offbeats', () => {
    const p = drumPattern('house');
    expect(beatsOf(p, BD)).toEqual([0, 1, 2, 3]);
    expect(beatsOf(p, CP)).toEqual([1, 3]);
    expect(beatsOf(p, OH)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it('puts the trap clap on beat 3 and turns R steps into 32nd rolls', () => {
    const p = drumPattern('trap');
    expect(beatsOf(p, CP)).toEqual([2, 6]);
    const hats = beatsOf(p, CH);
    expect(hats).toContain(3.75);
    expect(hats).toContain(3.875);
  });

  it('nudges the techno ghost kick a few milliseconds late', () => {
    const p = drumPattern('techno', { bpm: 130 });
    const ghost = p.events.find((e) => e.pitch === BD && e.velocity < 80)!;
    const ms = (ghost.beat - 2.5) * (60000 / 130);
    expect(ms).toBeGreaterThanOrEqual(3);
    expect(ms).toBeLessThanOrEqual(8);
  });

  it('gives strong, normal and ghost hits distinct velocity tiers', () => {
    const p = drumPattern('techno');
    const kicks = p.events.filter((e) => e.pitch === BD).map((e) => e.velocity);
    expect(Math.max(...kicks)).toBeGreaterThanOrEqual(110);
    expect(Math.min(...kicks)).toBeLessThanOrEqual(70);
  });

  it('is reproducible for a seed', () => {
    expect(drumPattern('hiphop', { seed: 4, humanize: true })).toEqual(drumPattern('hiphop', { seed: 4, humanize: true }));
  });

  it('chokes an open hat at the next closed hat', () => {
    const p = drumPattern('house');
    const open = p.events.find((e) => e.pitch === OH)!;
    expect(open.beat + open.duration).toBeLessThanOrEqual(0.75 + 1e-6);
  });
});

describe('variation and fills', () => {
  const base = drumTemplate('techno').bars[0]!;

  it("changes 10-25% of events and never the kick on the beat or the backbeat", () => {
    for (const v of ["A'", 'B'] as const) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const varied = varyGrid('techno', base, v, seed);
        for (const step of [0, 4, 8, 12]) expect(varied.BD![step]).toBe('X');
        expect(varied.SD![4]).toBe('x');
        expect(varied.SD![12]).toBe('x');
        let diff = 0;
        for (const voice of new Set([...Object.keys(base), ...Object.keys(varied)]) as Set<keyof Grid>) {
          const a = base[voice] ?? '.'.repeat(16), b = varied[voice] ?? '.'.repeat(16);
          for (let i = 0; i < 16; i += 1) if (a[i] !== b[i]) diff += 1;
        }
        expect(diff).toBeGreaterThan(0);
        expect(diff).toBeLessThanOrEqual(Math.ceil(count(base) * 0.25) * 2);
      }
    }
  });

  it('writes each genre its own fill over the last beat only', () => {
    for (const g of drumGenres()) {
      const bar = drumTemplate(g).bars[0]!;
      const filled = fillGrid(g, bar);
      for (const voice of Object.keys({ ...bar, ...filled }) as Array<keyof Grid>) {
        expect((filled[voice] ?? '.'.repeat(16)).slice(0, 12)).toBe((bar[voice] ?? '.'.repeat(16)).slice(0, 12));
      }
      expect(filled).not.toEqual(bar);
    }
  });

  it('builds a 16-bar A/A′/B/F phrase that ends in the fill', () => {
    const grids = drumGrids('techno', { phrase: true, seed: 3 });
    expect(grids).toHaveLength(16);
    expect(grids[0]).toEqual(base);
    expect(grids[15]).toEqual(fillGrid('techno', base));
    expect(drumKnowledge().phrase.filter((v) => v === 'F')).toHaveLength(1);
  });
});

describe('energy, swing and humanisation', () => {
  it('layers by energy: low is kick and hats, high adds a 909 ride, break drops the kick', () => {
    const low = drumPattern('techno', { energy: 'low' });
    expect(new Set(low.events.map((e) => e.pitch))).toEqual(new Set([BD, CH]));
    expect(beatsOf(drumPattern('techno', { energy: 'high' }), RD).length).toBeGreaterThan(0);
    expect(beatsOf(drumPattern('techno', { energy: 'break' }), BD)).toEqual([]);
  });

  it('swings hats but never the kick or backbeat', () => {
    const p = drumPattern('house', { swing: 0.3 });
    expect(beatsOf(p, BD)).toEqual([0, 1, 2, 3]);
    expect(beatsOf(p, CP)).toEqual([1, 3]);
    expect(beatsOf(p, CH)).toContain(0.25 + 0.075);
  });

  it('humanises by role: main kicks stay exactly on the beat', () => {
    const p = drumPattern('house', { humanize: true, seed: 9 });
    expect(beatsOf(p, BD)).toEqual([0, 1, 2, 3]);
    expect(beatsOf(p, CH).some((b) => Math.abs(b * 4 - Math.round(b * 4)) > 1e-6)).toBe(true);
  });

  it('puts chance on ornaments only', () => {
    const p = drumPattern('techno', { chance: true });
    for (const e of p.events) if (e.probability !== undefined) expect(e.velocity).toBeLessThan(105);
    expect(p.events.some((e) => e.probability !== undefined)).toBe(true);
  });
});

describe('drum checks', () => {
  it('passes every template', () => {
    for (const g of drumGenres()) {
      const findings = checkDrumPattern(drumPattern(g, { bars: 2 }), g);
      expect(findings.filter((f) => f.severity !== 'info'), `${g}: ${JSON.stringify(findings)}`).toEqual([]);
    }
  });

  it('flags the open and closed hats the end-to-end build stacked on the same steps', () => {
    const hats = mergePatterns(offbeatHat({ bars: 1, open: true }), sixteenthHats({ bars: 1 }));
    const kit = mergePatterns(fourOnTheFloorKick({ bars: 1 }), backbeatSnare({ bars: 1 }), hats);
    expect(checkDrumPattern(kit, 'techno').map((f) => f.message).join(' ')).toMatch(/open hats start with a closed hat/);
  });

  it('flags a missing backbeat, a drifting kick and an uncertain strong hit', () => {
    const p = { length_beats: 4, events: [0, 1.03, 2, 3].map((beat) => ({ beat, pitch: BD, duration: 0.25, velocity: 118, probability: beat === 2 ? 0.5 : undefined })) };
    const text = checkDrumPattern(p, 'house').map((f) => f.message).join(' ');
    expect(text).toMatch(/backbeat/);
    expect(text).toMatch(/off the grid/);
    expect(text).toMatch(/chance below 100%/);
  });

  it('draws the grid the way DRUMS.md does', () => {
    expect(formatGrid(drumGrids('house'))).toContain('BD     X  .  .  . | X  .  .  .');
    void SD;
  });
});
