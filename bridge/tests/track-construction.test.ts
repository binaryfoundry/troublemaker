/**
 * NEW-TRACK-DETAILED.md as code: the agent contract, the translation table,
 * the validation passes, the failure modes and the minimum viable track.
 */

import { describe, expect, it } from 'vitest';

import {
  checkAction,
  failureModes,
  missingFromMinimumTrack,
  trackConstructionKnowledge,
  translateRequest,
  validationPasses,
} from '../../agent/src/track-construction.js';

const complete = {
  target: 'PERC_SHAKER',
  location: 'bars 17-24, every 1/16',
  edit: 'velocity cell, then the Groove Pool groove on swing-eligible 16ths only',
  starting_value: '92, 58, 76, 64 repeating',
  expected_effect: 'the pulse stops sounding mechanical',
  test: 'A/B against equal velocity; keep only if the shaker does not sound late',
};

describe('the agent contract (section 1)', () => {
  it('accepts an action that names all six fields', () => {
    expect(checkAction(complete)).toEqual([]);
  });

  it('names every field an action leaves out', () => {
    const findings = checkAction({ target: 'PERC_SHAKER', edit: 'velocity cell' });
    expect(findings.map((f) => f.field).sort()).toEqual(['expected_effect', 'location', 'starting_value', 'test']);
  });

  it('treats an empty field as missing', () => {
    expect(checkAction({ ...complete, test: '   ' }).map((f) => f.field)).toEqual(['test']);
  });

  it('refuses a banned instruction and offers the executable form', () => {
    const findings = checkAction({ ...complete, edit: 'Add some groove' });
    const message = findings.map((f) => f.message).join(' ');
    expect(findings.some((f) => f.field === 'instruction')).toBe(true);
    expect(message).toMatch(/observation, not an action/);
    expect(message).toMatch(/keep the kick straight/);
  });

  it('catches a banned instruction inside a longer sentence', () => {
    expect(checkAction({ ...complete, expected_effect: 'it should make the drop hit harder' })
      .some((f) => f.field === 'instruction')).toBe(true);
  });
});

describe('the translation table (section 42)', () => {
  it('translates a vague request into an executable one', () => {
    expect(translateRequest('make it wider')).toMatch(/mono-test/);
    expect(translateRequest('clean low end')).toMatch(/identify the owner/);
    expect(translateRequest('please add movement to the pad')).toMatch(/named parameter/);
  });

  it('returns null for a request the table does not cover', () => {
    expect(translateRequest('write a timpani part')).toBeNull();
  });

  it('never leaves a row without an action', () => {
    for (const row of trackConstructionKnowledge().translation_table) {
      expect(row.action.trim().length).toBeGreaterThan(0);
      expect(translateRequest(row.vague)).toBe(row.action);
    }
  });
});

describe('validation passes (section 39)', () => {
  it('holds all seven, each with checks', () => {
    const passes = validationPasses();
    expect(passes.map((p) => p.id)).toEqual([
      'harmonic', 'groove', 'low_end', 'arrangement', 'processing', 'mono', 'low_volume',
    ]);
    for (const pass of passes) expect(pass.checks.length).toBeGreaterThan(0);
  });
});

describe('failure modes (section 43)', () => {
  it('holds all nine, each with a fix', () => {
    const modes = failureModes();
    expect(modes).toHaveLength(9);
    for (const mode of modes) {
      expect(mode.problem.trim().length).toBeGreaterThan(0);
      expect(mode.fix.trim().length).toBeGreaterThan(0);
    }
    expect(modes.map((m) => m.id)).toContain('swing_everything');
  });
});

describe('minimum viable track (section 44)', () => {
  it('names what a part list is still missing', () => {
    expect(missingFromMinimumTrack(['kick', 'bass', 'clap_or_snare'])).toEqual([
      'hat_or_percussion_groove', 'harmonic_identity', 'main_hook_or_vocal', 'arrangement_contrast', 'transitions', 'balanced_mix',
    ]);
  });

  it('is satisfied by the full set', () => {
    expect(missingFromMinimumTrack(trackConstructionKnowledge().minimum_viable_track)).toEqual([]);
  });
});
