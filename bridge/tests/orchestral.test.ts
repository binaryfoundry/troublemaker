/**
 * ORCHESTRAL.md as code: practical ranges in scientific pitch, checked
 * against parts written in MIDI numbers.
 */

import { describe, expect, it } from 'vitest';

import { checkInstrumentRange, instrumentRange, orchestralKnowledge } from '../../agent/src/orchestral.js';

describe('orchestral ranges (section 21)', () => {
  it('reads the ranges as scientific pitch: the violin starts on its open G, MIDI 55', () => {
    expect(orchestralKnowledge().convention).toBe('scientific');
    expect(instrumentRange('violin')).toEqual({ low: 55, high: 100 });
    expect(instrumentRange('cello').low).toBe(36);
    expect(instrumentRange('double_bass').low).toBe(28);
    expect(instrumentRange('tuba').low).toBe(26);
  });

  it('holds every instrument with a low below its high', () => {
    for (const name of Object.keys(orchestralKnowledge().instruments)) {
      const { low, high } = instrumentRange(name);
      expect(low).toBeLessThan(high);
    }
  });

  it('passes a part inside the range', () => {
    expect(checkInstrumentRange('cello', [36, 43, 48, 55, 67])).toEqual([]);
  });

  it('flags a note below the range and names it in both conventions', () => {
    const [finding] = checkInstrumentRange('violin', [52, 55, 60]);
    expect(finding!.pitch).toBe(52);
    expect(finding!.message).toMatch(/below its range/);
    expect(finding!.message).toMatch(/E2 in Live/);
    expect(finding!.message).toMatch(/E3 scientific/);
  });

  it('flags a note above the range once, however often it is played', () => {
    const findings = checkInstrumentRange('trumpet', [86, 87, 87, 87]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/above its range/);
  });

  it('refuses an unknown instrument and lists the known ones', () => {
    expect(() => instrumentRange('theremin')).toThrow(/Known: violin/);
  });
});
