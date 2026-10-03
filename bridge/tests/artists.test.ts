/**
 * JON_HOPKINS.md and TINLICKER.md: profiles, the artists' own arrangement
 * tests, cycle realignment and Tinlicker's stepwise bass pickups.
 */

import { describe, expect, it } from 'vitest';

import { checkArrangement, planArrangement, type PlannedSection } from '../../agent/src/arrangement.js';
import {
  artistForStyle,
  artistNames,
  artistProfile,
  auditArtistPlan,
  checkStylePlan,
  modulationRealignment,
  orbitRealignment,
  pickupBass,
} from '../../agent/src/artists.js';

const section = (name: string, startBar: number, bars: number, energy: number, roles: string[]): PlannedSection => ({ name, startBar, bars, energy, roles });

describe('artist profiles', () => {
  it('keeps both documents with their own numbers', () => {
    expect(artistNames()).toEqual(expect.arrayContaining(['jon_hopkins', 'tinlicker']));
    const t = artistProfile('tinlicker');
    expect(t.tempo).toMatchObject({ range: [122, 126], default: 124 });
    expect(t.hierarchy[0]).toBe('emotional chord movement');
    expect(t.report_format).toEqual(['Changed', 'Why', 'Listen for', 'Next highest-value move']);
    const h = artistProfile('jon_hopkins');
    expect(h.orbiting_percussion).toMatchObject({ main_steps: 16, loop_steps: [15, 12, 7, 10] });
    expect(h.modulation_cycle_bars).toEqual({ filter: 4, pan: 5, texture_gain: 7, delay_feedback: 3 });
    expect(h.decision_hierarchy.at(-1)).toBe('loudness');
    // The document gives no tempo: the assumption is recorded next to the number.
    expect(h.tempo.$assumption).toMatch(/no tempo/);
  });

  it('links each artist to its prompt and style, and leaves unseen references unresolved', () => {
    for (const name of artistNames()) {
      const p = artistProfile(name);
      expect(artistForStyle(p.style)).toBe(name);
      expect(p.references_unresolved.length).toBeGreaterThan(0);
    }
    expect(() => artistProfile('nobody')).toThrow(/Known: /);
  });
});

describe('cycles', () => {
  it('computes when orbiting loops realign with the bar and with each other', () => {
    const r = orbitRealignment([15, 12, 7, 10]);
    expect(r.realignSteps).toBe(1680);
    expect(r.realignBars).toBe(105);
    expect(r.perLoop.map((l) => l.realignBars)).toEqual([15, 3, 7, 5]);
    expect(() => orbitRealignment([0])).toThrow();
  });

  it('computes when unrelated automation cycles restart together', () => {
    expect(modulationRealignment({ filter: 4, pan: 5, texture_gain: 7, delay_feedback: 3 }).realignBars).toBe(420);
  });
});

describe('style templates', () => {
  it('plans the TINLICKER.md long form and passes its own tests', () => {
    const plan = planArrangement('tinlicker');
    expect(plan.reduce((n, s) => n + s.bars, 0)).toBe(168);
    const by = (name: string) => plan.find((s) => s.name === name)!;
    expect(by('Intro').roles).toContain('kick');
    expect(by('Breakdown').roles).not.toContain('kick');
    expect(by('Breakdown').roles).not.toContain('bass');
    expect(by('Rebuild').roles).not.toContain('kick');
    expect(by('Drop').roles).not.toContain('chords');
    expect(by('Drop b').roles).toContain('chords');
    expect(by('Second Development').roles).toContain('counter');
    expect(by('Outro b').roles).not.toContain('lead');
    expect(checkStylePlan('tinlicker', plan).filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('plans the JON_HOPKINS.md journey; its environment intro is not held to the DJ rule', () => {
    const plan = planArrangement('hopkins_journey');
    expect(plan[0]!.roles).not.toContain('kick');
    expect(checkArrangement(plan).some((f) => /no kick/.test(f.message))).toBe(true);
    expect(checkStylePlan('hopkins_journey', plan).filter((f) => f.severity !== 'info')).toEqual([]);
    const rupture = plan.find((s) => s.name.startsWith('Breakdown'))!;
    expect(rupture.roles).not.toContain('bass');
  });

  it('leaves styles without an artist to the generic rules', () => {
    const plan = planArrangement('hypnotic_long_form');
    expect(checkStylePlan('hypnotic_long_form', plan)).toEqual(checkArrangement(plan));
  });
});

describe('Tinlicker tests on a plan', () => {
  const base = [
    section('Intro', 1, 16, 0.3, ['kick', 'hats']),
    section('Breakdown', 17, 16, 0.4, ['chords', 'lead', 'atmosphere']),
    section('Rebuild', 33, 8, 0.5, ['hats', 'chords', 'lead']),
    section('Drop', 41, 8, 0.85, ['kick', 'bass', 'hats', 'lead']),
    section('Drop b', 49, 16, 0.9, ['kick', 'bass', 'hats', 'lead', 'chords', 'perc']),
    section('Outro', 65, 16, 0.3, ['kick', 'hats']),
  ];
  const tests = (plan: PlannedSection[]) => auditArtistPlan(plan, 'tinlicker').filter((f) => f.severity === 'review').map((f) => f.test);

  it('passes a plan that removes before the drop and holds layers back', () => {
    expect(tests(base)).toEqual([]);
  });

  it('flags a breakdown that keeps the kick or sub', () => {
    const plan = base.map((s) => (s.name === 'Breakdown' ? { ...s, roles: [...s.roles, 'bass'] } : s));
    expect(tests(plan)).toContain('breakdown');
  });

  it('flags a drop with nothing removed before it', () => {
    const plan = base.map((s) => (s.name === 'Rebuild' ? { ...s, roles: [...s.roles, 'kick'] } : s));
    expect(tests(plan)).toContain('drop');
  });

  it('flags a drop that opens with every layer the payoff will have', () => {
    const plan = base.map((s) => (s.name === 'Drop' ? { ...s, roles: ['kick', 'bass', 'hats', 'lead', 'chords', 'perc'] } : s));
    expect(tests(plan)).toContain('drop');
  });

  it('flags identical neighbours, and long sections for planned automation', () => {
    const plan = [section('Intro', 1, 16, 0.3, ['kick']), section('Groove', 17, 16, 0.3, ['kick']), section('Main', 33, 32, 0.9, ['kick', 'bass'])];
    const findings = auditArtistPlan(plan, 'tinlicker').filter((f) => f.test === 'sixteen_bar');
    expect(findings.find((f) => f.bar === 17)?.severity).toBe('review');
    expect(findings.find((f) => f.bar === 49)?.severity).toBe('info');
  });
});

describe('Hopkins tests on a plan', () => {
  const testsOf = (plan: PlannedSection[]) => auditArtistPlan(plan, 'jon_hopkins').map((f) => f.test);

  it('notices a bass that never leaves, no negative space, and a leap into pressure', () => {
    const plan = [
      section('Intro', 1, 16, 0.2, ['atmosphere']),
      section('Groove', 17, 16, 0.3, ['kick', 'bass']),
      section('Peak', 33, 48, 1.0, ['kick', 'bass', 'lead']),
      section('Outro', 81, 16, 0.3, ['kick', 'bass']),
    ];
    expect(testsOf(plan)).toEqual(expect.arrayContaining(['bass_leaves', 'negative_space', 'comfort_before_discomfort', 'internal_evolution']));
  });
});

describe('pickupBass', () => {
  const roots = [43, 39, 41, 38]; // G Eb F D
  const bass = pickupBass(roots);

  it('plays offbeats only, leaving the beats to the kick', () => {
    expect(bass.length_beats).toBe(16);
    for (const e of bass.events) expect(e.beat % 1).toBeCloseTo(0.5);
  });

  it('opens each chord on its root and arrives on the next root by a scale step', () => {
    const G_MINOR = new Set([7, 9, 10, 0, 2, 3, 5]);
    roots.forEach((root, i) => {
      const first = bass.events.find((e) => e.beat === i * 4 + 0.5)!;
      expect(first.pitch).toBe(root);
      const pickup = bass.events.find((e) => e.beat === i * 4 + 3.5)!;
      const next = roots[(i + 1) % roots.length]!;
      expect(pickup.pitch).not.toBe(root);
      expect(Math.abs(pickup.pitch - next)).toBeLessThanOrEqual(2);
      expect(G_MINOR.has(pickup.pitch % 12)).toBe(true);
    });
  });

  it('jumps an octave at the phrase boundary', () => {
    expect(bass.events.find((e) => e.beat === 14.5)!.pitch).toBe(38 + 12);
  });
});
