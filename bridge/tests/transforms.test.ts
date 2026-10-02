/**
 * Golden musical tests.
 *
 * These assert musical *properties* - the pitch sequence survived, the note
 * count stayed in range, some notes moved off the grid - rather than exact
 * note lists, because variation is the point of most of these operations.
 */

import { describe, expect, it } from 'vitest';

import {
  applySwing,
  compareMaterial,
  conformToKey,
  humanizeTiming,
  humanizeVelocity,
  increaseDensity,
  makeMoreSyncopated,
  mergePlans,
  planToCommands,
  reduceDensity,
  straighten,
  transpose,
  varyEveryNthBar,
} from '../../agent/src/transforms.js';
import { validateArgs } from '../src/validation.js';
import type { Note } from '../src/protocol.js';

/** A straight eighth-note bassline - the plan's golden-test input. */
function straightEighthBass(bars = 2): Note[] {
  const pitches = [41, 41, 44, 41, 48, 41, 44, 43];
  const notes: Note[] = [];
  let id = 1;
  for (let bar = 0; bar < bars; bar += 1) {
    for (let step = 0; step < 8; step += 1) {
      notes.push({
        note_id: id++,
        pitch: pitches[step]!,
        start: bar * 4 + step * 0.5,
        duration: 0.45,
        velocity: 100,
        mute: false,
      });
    }
  }
  return notes;
}

/** Apply a plan locally so a test can inspect the resulting material. */
function applyPlan(
  notes: Note[],
  plan: ReturnType<typeof makeMoreSyncopated>,
): Note[] {
  const removed = new Set(plan.removals);
  const updates = new Map(plan.updates.map((u) => [u.note_id, u]));
  const result = notes
    .filter((note) => !removed.has(note.note_id as number))
    .map((note) => ({ ...note, ...(updates.get(note.note_id as number) ?? {}) }));
  return [...result, ...plan.additions].sort((a, b) => a.start - b.start);
}

describe('makeMoreSyncopated', () => {
  const before = straightEighthBass(4);

  it('keeps the pitch sequence intact', () => {
    const plan = makeMoreSyncopated(before, { lengthBeats: 16, amount: 0.5, seed: 11 });
    const after = applyPlan(before, plan);
    const comparison = compareMaterial(before, after);
    expect(comparison.noteCountDelta).toBe(0);
    expect(new Set(after.map((n) => n.pitch))).toEqual(new Set(before.map((n) => n.pitch)));
  });

  it('moves at least two notes off the eighth grid', () => {
    const plan = makeMoreSyncopated(before, { lengthBeats: 16, amount: 0.6, seed: 3 });
    const after = applyPlan(before, plan);
    expect(compareMaterial(before, after).offGridNotes).toBeGreaterThanOrEqual(2);
  });

  it('keeps the note count within the +/-20% the plan allows', () => {
    const plan = makeMoreSyncopated(before, { lengthBeats: 16, amount: 0.8, seed: 4 });
    const ratio = compareMaterial(before, applyPlan(before, plan)).noteCountRatio;
    expect(ratio).toBeGreaterThanOrEqual(0.8);
    expect(ratio).toBeLessThanOrEqual(1.2);
  });

  it('never writes a note past the end of the clip', () => {
    const plan = makeMoreSyncopated(before, { lengthBeats: 16, amount: 1, seed: 8 });
    for (const update of plan.updates) {
      if (update.start !== undefined) expect(update.start).toBeLessThan(16);
    }
  });

  it('never creates an overlap at the same pitch', () => {
    const plan = makeMoreSyncopated(before, { lengthBeats: 16, amount: 1, seed: 12 });
    const after = applyPlan(before, plan);
    const byPitch = new Map<number, Note[]>();
    for (const note of after) {
      byPitch.set(note.pitch, [...(byPitch.get(note.pitch) ?? []), note]);
    }
    for (const group of byPitch.values()) {
      group.sort((a, b) => a.start - b.start);
      for (let i = 1; i < group.length; i += 1) {
        expect(group[i - 1]!.start + group[i - 1]!.duration).toBeLessThanOrEqual(
          group[i]!.start + 1e-6,
        );
      }
    }
  });

  it('does nothing at amount 0 and is reproducible for a seed', () => {
    expect(makeMoreSyncopated(before, { lengthBeats: 16, amount: 0 }).updates).toHaveLength(0);
    expect(makeMoreSyncopated(before, { lengthBeats: 16, amount: 0.5, seed: 2 })).toEqual(
      makeMoreSyncopated(before, { lengthBeats: 16, amount: 0.5, seed: 2 }),
    );
  });

  it('leaves the first and last bar alone when asked to preserve edges', () => {
    const plan = makeMoreSyncopated(before, {
      lengthBeats: 16,
      amount: 1,
      seed: 5,
      preserveEdges: true,
    });
    const moved = new Set(plan.updates.map((u) => u.note_id));
    for (const note of before) {
      if (note.start < 4 || note.start >= 12) {
        expect(moved.has(note.note_id as number)).toBe(false);
      }
    }
  });

  it('refuses to run without note ids rather than guessing', () => {
    const idless = before.map(({ note_id: _drop, ...rest }) => rest);
    expect(() => makeMoreSyncopated(idless, { lengthBeats: 16 })).toThrow(/note ids/);
  });
});

describe('straighten', () => {
  it('pulls notes back onto the grid', () => {
    const notes: Note[] = [{ note_id: 1, pitch: 41, start: 1.07, duration: 0.5, velocity: 100 }];
    const plan = straighten(notes, { lengthBeats: 4, grid: 0.25 });
    expect(plan.updates[0]!.start).toBe(1);
  });
});

describe('density', () => {
  const before = straightEighthBass(4);

  it('removes roughly the requested fraction', () => {
    const plan = reduceDensity(before, { lengthBeats: 16, amount: 0.25 });
    expect(plan.removals.length).toBe(Math.floor(before.length * 0.25));
  });

  it('keeps bar downbeats', () => {
    const plan = reduceDensity(before, { lengthBeats: 16, amount: 0.5 });
    const removed = new Set(plan.removals);
    for (const note of before) {
      if (note.start % 4 === 0) expect(removed.has(note.note_id as number)).toBe(false);
    }
  });

  it('removes nothing at amount 0', () => {
    expect(reduceDensity(before, { lengthBeats: 16, amount: 0 }).removals).toHaveLength(0);
  });

  it('adds quieter echoes rather than louder new material', () => {
    const plan = increaseDensity(before, { lengthBeats: 16, amount: 1, seed: 6 });
    expect(plan.additions.length).toBeGreaterThan(0);
    for (const addition of plan.additions) {
      expect(addition.velocity).toBeLessThan(100);
      expect(before.some((n) => n.pitch === addition.pitch)).toBe(true);
    }
  });

  it('never stacks an addition on an existing note', () => {
    const plan = increaseDensity(before, { lengthBeats: 16, amount: 1, seed: 6 });
    for (const addition of plan.additions) {
      expect(
        before.some(
          (n) => n.pitch === addition.pitch && Math.abs(n.start - addition.start) < 1e-6,
        ),
      ).toBe(false);
    }
  });
});

describe('dynamics', () => {
  const before = straightEighthBass(2);

  it('spreads velocity without leaving the legal range', () => {
    const plan = humanizeVelocity(before, { lengthBeats: 8, spread: 20, seed: 1 });
    expect(plan.updates.length).toBeGreaterThan(0);
    for (const update of plan.updates) {
      expect(update.velocity!).toBeGreaterThanOrEqual(1);
      expect(update.velocity!).toBeLessThanOrEqual(127);
    }
  });

  it('nudges timing only slightly and never before beat 0', () => {
    const plan = humanizeTiming(before, { lengthBeats: 8, maxShiftBeats: 0.02, seed: 1 });
    for (const update of plan.updates) {
      expect(update.start!).toBeGreaterThanOrEqual(0);
      const original = before.find((n) => n.note_id === update.note_id)!;
      expect(Math.abs(update.start! - original.start)).toBeLessThanOrEqual(0.02 + 1e-9);
    }
  });

  it('delays offbeat sixteenths when swinging', () => {
    const notes: Note[] = [
      { note_id: 1, pitch: 42, start: 0, duration: 0.2, velocity: 100 },
      { note_id: 2, pitch: 42, start: 0.25, duration: 0.2, velocity: 100 },
    ];
    const plan = applySwing(notes, { lengthBeats: 4, amount: 0.6, grid: 0.25 });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.note_id).toBe(2);
    expect(plan.updates[0]!.start!).toBeGreaterThan(0.25);
  });
});

describe('pitch', () => {
  it('transposes everything by the same interval', () => {
    const before = straightEighthBass(1);
    const plan = transpose(before, 12);
    for (const update of plan.updates) {
      const original = before.find((n) => n.note_id === update.note_id)!;
      expect(update.pitch).toBe(original.pitch + 12);
    }
  });

  it('skips notes that would leave MIDI range and says so', () => {
    const notes: Note[] = [{ note_id: 1, pitch: 120, start: 0, duration: 1, velocity: 100 }];
    const plan = transpose(notes, 12);
    expect(plan.updates).toHaveLength(0);
    expect(plan.summary.join(' ')).toMatch(/MIDI range/);
  });

  it('conforms out-of-key notes and leaves in-key notes alone', () => {
    const notes: Note[] = [
      { note_id: 1, pitch: 41, start: 0, duration: 1, velocity: 100 }, // F2, in key
      { note_id: 2, pitch: 42, start: 1, duration: 1, velocity: 100 }, // F#2, not
    ];
    const plan = conformToKey(notes, 'F', 'minor');
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.note_id).toBe(2);
  });
});

describe('varyEveryNthBar', () => {
  it('only touches the back half of every Nth bar', () => {
    const before = straightEighthBass(8);
    const plan = varyEveryNthBar(before, {
      lengthBeats: 32,
      everyBars: 4,
      intensity: 1,
      seed: 3,
    });
    const touched = new Set([...plan.updates.map((u) => u.note_id), ...plan.removals]);
    for (const note of before) {
      if (!touched.has(note.note_id as number)) continue;
      const bar = Math.floor(note.start / 4) + 1;
      expect(bar % 4).toBe(0);
      expect(note.start % 4).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('plan composition', () => {
  const before = straightEighthBass(2);

  it('merges updates for the same note instead of emitting two', () => {
    const merged = mergePlans(
      { updates: [{ note_id: 1, start: 0.25 }], additions: [], removals: [], summary: [] },
      { updates: [{ note_id: 1, velocity: 80 }], additions: [], removals: [], summary: [] },
    );
    expect(merged.updates).toHaveLength(1);
    expect(merged.updates[0]).toEqual({ note_id: 1, start: 0.25, velocity: 80 });
  });

  it('drops an update for a note another plan removes', () => {
    const merged = mergePlans(
      { updates: [{ note_id: 1, velocity: 80 }], additions: [], removals: [], summary: [] },
      { updates: [], additions: [], removals: [1], summary: [] },
    );
    expect(merged.updates).toHaveLength(0);
    expect(merged.removals).toEqual([1]);
  });

  it('emits removals before additions so freed slots can be reused', () => {
    const plan = mergePlans(
      reduceDensity(before, { lengthBeats: 8, amount: 0.2 }),
      increaseDensity(before, { lengthBeats: 8, amount: 0.5, seed: 1 }),
    );
    const commands = planToCommands(1, 0, plan).map((c) => c.command);
    expect(commands.indexOf('live.remove_notes')).toBeLessThan(
      commands.indexOf('live.add_notes'),
    );
  });

  it('emits commands the bridge validator accepts', () => {
    const plan = mergePlans(
      makeMoreSyncopated(before, { lengthBeats: 8, amount: 0.6, seed: 2 }),
      humanizeVelocity(before, { lengthBeats: 8, seed: 2 }),
      increaseDensity(before, { lengthBeats: 8, amount: 0.4, seed: 2 }),
    );
    for (const command of planToCommands(1, 0, plan)) {
      expect(() => validateArgs(command.command as never, command.args)).not.toThrow();
    }
  });

  it('produces no commands for an empty plan', () => {
    expect(planToCommands(1, 0, { updates: [], additions: [], removals: [], summary: [] })).toEqual(
      [],
    );
  });
});
