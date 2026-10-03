/**
 * DRUMS.md as code: templates on 6-, 8-, 12- and 16-step grids, velocity by
 * role, anchors, variation budgets, fills that resolve, swing as a pair
 * ratio, feel, flams, kit remapping, polyrhythm descriptions and the hard
 * checks. Properties, not exact note lists.
 */

import { describe, expect, it } from 'vitest';

import {
  checkDrumPattern,
  describePolymeter,
  describePolyrhythm,
  drumGenres,
  drumGrids,
  drumKnowledge,
  drumPattern,
  drumTemplate,
  fillGrid,
  fillResolves,
  formatGrid,
  gridsToPattern,
  kitMapFromPads,
  parseRow,
  remapToKit,
  templateGrid,
  variationMetrics,
  varyGrid,
} from '../../agent/src/drums.js';
import { backbeatSnare, fourOnTheFloorKick, mergePatterns, offbeatHat, sixteenthHats } from '../../agent/src/patterns.js';

const BD = 36, SD = 38, CP = 39, CH = 42, LT = 43, OH = 46, MT = 47, HT = 50, RD = 51;
type P = ReturnType<typeof drumPattern>;
const beatsOf = (p: P, pitch: number) => p.events.filter((e) => e.pitch === pitch).map((e) => e.beat);
const velocitiesOf = (p: P, pitch: number) => p.events.filter((e) => e.pitch === pitch).map((e) => e.velocity);

// The real pad names of Ableton's 909 Core Kit, read from Live.
const CORE_909 = [
  [36, 'Bass Drum'], [37, 'Rim Shot'], [38, 'Snare Drum'], [39, 'Hand Clap'], [40, 'Bass Drum'], [41, 'Snare Drum'],
  [42, 'Closed Hi Hat'], [43, 'Snare Drum'], [44, 'Low Tom'], [45, 'Mid Tom'], [46, 'Open Hi Hat'], [47, 'Hi Tom'],
  [48, 'Crash'], [49, 'Crash'], [50, 'Ride'], [51, 'Ride'],
].map(([note, name]) => ({ note: note as number, name: name as string }));

describe('drum templates', () => {
  it('covers DRUMS.md grids: 16, 8, 12 and 6 steps with metre and subdivision', () => {
    for (const g of ['house', 'electro_8', 'triplet_12', 'six_eight']) expect(drumGenres()).toContain(g);
    expect(drumTemplate('electro_8').steps).toBe(8);
    expect(drumTemplate('triplet_12').steps).toBe(12);
    expect(drumTemplate('six_eight').meter).toBe('6/8');
    for (const g of drumGenres()) expect(() => templateGrid(g)).not.toThrow();
  });

  it('uses the DRUMS.md 909-compatible note map (low tom 43, mid 47, high 50)', () => {
    const map = drumKnowledge().note_map;
    expect([map.LT, map.MT, map.HT, map.RD]).toEqual([LT, MT, HT, RD]);
  });

  it('plays the 909 house anchor at its exact DRUMS.md velocities', () => {
    const p = drumPattern('house');
    expect(beatsOf(p, BD)).toEqual([0, 1, 2, 3]);
    expect(velocitiesOf(p, BD)).toEqual([120, 116, 120, 116]);
    expect(velocitiesOf(p, CP)).toEqual([112, 116]);
    expect(beatsOf(p, OH)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it('places 8-step events on 8ths, 12-step on triplets and 6/8 in a 3-beat bar', () => {
    expect(beatsOf(drumPattern('electro_8'), SD)).toEqual([1, 3]);
    const triplet = drumPattern('triplet_12');
    expect(beatsOf(triplet, SD).map((b) => +b.toFixed(4))).toEqual([1, 3]);
    expect(beatsOf(triplet, CH)).toHaveLength(12);
    const six = drumPattern('six_eight');
    expect(six.length_beats).toBe(3);
    expect(beatsOf(six, SD)).toEqual([1.5]);
  });

  it('keeps accent apart from velocity', () => {
    const p = drumPattern('house');
    expect(p.events.filter((e) => e.accent).map((e) => e.pitch)).toEqual(expect.arrayContaining([BD, CP]));
    expect(p.events.filter((e) => e.pitch === CH).every((e) => !e.accent)).toBe(true);
  });

  it('writes ghosts in their role range: snare ghosts 25-60, secondary kicks 70-88', () => {
    const techno = drumPattern('techno');
    const ghostSnare = techno.events.filter((e) => e.pitch === SD && e.velocity < 70);
    expect(ghostSnare.length).toBeGreaterThan(0);
    for (const e of ghostSnare) expect(e.velocity).toBeLessThanOrEqual(60);
    const ghostKick = techno.events.find((e) => e.pitch === BD && e.velocity < 100)!;
    expect(ghostKick.velocity).toBeGreaterThanOrEqual(70);
  });

  it('is reproducible for a seed', () => {
    expect(drumPattern('hiphop', { seed: 4, humanize: true })).toEqual(drumPattern('hiphop', { seed: 4, humanize: true }));
  });
});

describe('variation and fills', () => {
  it('changes 10-25% of non-anchor events and keeps every anchor', () => {
    for (const genre of ['house', 'techno', 'hiphop']) {
      const base = templateGrid(genre);
      for (const v of ["A'", 'B'] as const) {
        for (let seed = 1; seed <= 15; seed += 1) {
          const m = variationMetrics(genre, base, varyGrid(genre, base, v, seed));
          expect(m.anchorRetention).toBe(1);
          expect(m.changeRate).toBeGreaterThan(0);
          expect(m.changeRate).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('writes the DRUMS.md tom run over the last quarter and resolves on the next downbeat', () => {
    const base = templateGrid('house');
    const filled = fillGrid('house', base);
    expect(filled.LT?.[13]).toBe('78');
    expect(filled.MT?.[14]).toBe('94');
    expect(filled.HT?.[15]).toBe('112');
    expect(filled.BD?.[15]).toBe('105');
    expect(filled.OH?.[14]).toBe('.');
    expect(filled.BD!.slice(0, 12)).toEqual(base.BD!.slice(0, 12));
    const grids = drumGrids('house', { phrase: true });
    expect(fillResolves(grids, 15)).toBe(true);
  });

  it('fills every genre over its last quarter only', () => {
    for (const g of drumGenres()) {
      const t = drumTemplate(g);
      const keep = t.steps - Math.max(2, Math.round(t.steps / 4));
      const base = templateGrid(g);
      const filled = fillGrid(g, base);
      expect(filled).not.toEqual(base);
      for (const voice of Object.keys(base) as Array<keyof typeof base>) {
        expect(filled[voice]!.slice(0, keep)).toEqual(base[voice]!.slice(0, keep));
      }
    }
  });

  it('builds a 16-bar A/A′/B/F phrase ending in the fill', () => {
    const grids = drumGrids('techno', { phrase: true, seed: 3 });
    expect(grids).toHaveLength(16);
    expect(grids[0]).toEqual(templateGrid('techno'));
    expect(grids[15]).toEqual(fillGrid('techno', templateGrid('techno')));
  });
});

describe('swing, feel, flam and energy', () => {
  it('treats swing as a pair ratio: 50% straight, 66.7% lands the off-16th on the triplet', () => {
    expect(beatsOf(drumPattern('house', { swingPercent: 50 }), CH)).toContain(0.25);
    const swung = beatsOf(drumPattern('house', { swingPercent: 66.7 }), CH);
    expect(swung.some((b) => Math.abs(b - 1 / 3) < 0.002)).toBe(true);
    expect(beatsOf(drumPattern('house', { swingPercent: 66.7 }), BD)).toEqual([0, 1, 2, 3]);
  });

  it('does not swing a triplet grid again', () => {
    expect(drumPattern('triplet_12', { swingPercent: 60 })).toEqual(drumPattern('triplet_12'));
  });

  it('lays the clap back 3 ms and the open hat 4 ms, kick untouched', () => {
    const bpm = 120;
    const p = drumPattern('house', { feel: 'laid_back', bpm });
    const ms = (beat: number, grid: number) => (beat - grid) * (60000 / bpm);
    expect(ms(beatsOf(p, CP)[0]!, 1)).toBeCloseTo(3, 5);
    expect(ms(beatsOf(p, OH)[0]!, 0.5)).toBeCloseTo(4, 5);
    expect(beatsOf(p, BD)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the main flam strike on the step and puts the second about 30 ms after it', () => {
    const grid = templateGrid('house');
    grid.SD = parseRow('....F...........', 16);
    const p = gridsToPattern('house', [grid], { bpm: 120 });
    const snares = p.events.filter((e) => e.pitch === SD).sort((a, b) => a.beat - b.beat);
    expect(snares[0]!.beat).toBe(1);
    expect((snares[1]!.beat - 1) * 500).toBeCloseTo(30, 5);
    expect(snares[1]!.velocity).toBeLessThan(snares[0]!.velocity);
  });

  it('layers by energy: low is kick and hats, high adds a 909 ride, break drops the kick', () => {
    expect(new Set(drumPattern('techno', { energy: 'low' }).events.map((e) => e.pitch))).toEqual(new Set([BD, CH]));
    expect(beatsOf(drumPattern('techno', { energy: 'high' }), RD).length).toBeGreaterThan(0);
    expect(beatsOf(drumPattern('techno', { energy: 'break' }), BD)).toEqual([]);
  });

  it('puts chance on ornaments only', () => {
    const p = drumPattern('techno', { chance: true });
    expect(p.events.some((e) => e.probability !== undefined)).toBe(true);
    for (const e of p.events) if (e.probability !== undefined) expect(e.velocity).toBeLessThan(105);
  });
});

describe('kits', () => {
  it('maps voices to the 909 Core Kit pads by name, not by assumed number', () => {
    const kit = kitMapFromPads(CORE_909);
    expect(kit.notes).toMatchObject({ BD: 36, SD: 38, CP: 39, CH: 42, OH: 46, LT: 44, MT: 45, HT: 47, RD: 51, CY: 49 });
    expect(kit.missing).toContain('CB');
  });

  it('moves a tom-run fill onto the kit toms instead of its ride', () => {
    const fill = drumPattern('house', { variant: 'F' });
    const { pattern, dropped } = remapToKit(fill, kitMapFromPads(CORE_909));
    const pitches = new Set(pattern.events.map((e) => e.pitch));
    expect(pitches.has(47)).toBe(true); // the kit's Hi Tom
    expect(pattern.events.filter((e) => e.pitch === 50)).toEqual([]); // not the kit's Ride
    expect(dropped).toEqual([]);
  });
});

describe('polyrhythm and polymeter', () => {
  it('describes 4:3 exactly as DRUMS.md does', () => {
    const d = describePolyrhythm(4, 3);
    expect(d.grid).toBe(12);
    expect(d.pulsesA).toEqual([1, 4, 7, 10]);
    expect(d.pulsesB).toEqual([1, 5, 9]);
  });

  it('says when a polymetric loop realigns with the bar', () => {
    expect(describePolymeter(5).realignBars).toBe(5);
    expect(describePolymeter(12).realignBars).toBe(3);
  });
});

describe('drum checks', () => {
  it('passes every template', () => {
    for (const g of drumGenres()) {
      const findings = checkDrumPattern(drumPattern(g, { bars: 2 }), g);
      expect(findings.filter((f) => f.severity !== 'info'), `${g}: ${JSON.stringify(findings)}`).toEqual([]);
    }
  });

  it('fails the stacked open and closed hats from the end-to-end build', () => {
    const kit = mergePatterns(fourOnTheFloorKick({ bars: 1 }), backbeatSnare({ bars: 1 }), offbeatHat({ bars: 1, open: true }), sixteenthHats({ bars: 1 }));
    const finding = checkDrumPattern(kit, 'techno').find((f) => /choke/.test(f.message));
    expect(finding?.severity).toBe('fail');
  });

  it('fails a ghost that is not at least 30 velocity under its main hits', () => {
    const groove = (ghost: number) => ({ length_beats: 4, events: [
      ...[0, 1, 2, 3].map((beat) => ({ beat, pitch: BD, duration: 0.25, velocity: 118 })),
      { beat: 1, pitch: SD, duration: 0.25, velocity: 96 },
      { beat: 3, pitch: SD, duration: 0.25, velocity: 96 },
      { beat: 3.75, pitch: SD, duration: 0.25, velocity: ghost },
    ] });
    const ghostFail = (ghost: number) => checkDrumPattern(groove(ghost), 'techno').some((f) => f.severity === 'fail' && /ghosts/.test(f.message));
    expect(ghostFail(40)).toBe(false);
    expect(ghostFail(68)).toBe(true);
  });

  it('fails out-of-range data and flags drift, a missing backbeat and an uncertain strong hit', () => {
    const p = { length_beats: 4, events: [
      ...[0, 1.03, 2, 3].map((beat) => ({ beat, pitch: BD, duration: 0.25, velocity: 118, probability: beat === 2 ? 0.5 : undefined })),
      { beat: 5, pitch: CH, duration: 0.1, velocity: 140 },
    ] };
    const text = checkDrumPattern(p, 'house').map((f) => `${f.severity}:${f.message}`).join(' ');
    expect(text).toMatch(/fail:1 events have a velocity outside/);
    expect(text).toMatch(/fail:1 events fall outside/);
    expect(text).toMatch(/backbeat/);
    expect(text).toMatch(/off the grid/);
    expect(text).toMatch(/chance below 100%/);
  });

  it('draws grids with exact velocities', () => {
    const text = formatGrid(drumGrids('house'));
    expect(text).toContain('BD    120  ..  ..  .. 116');
  });
});
