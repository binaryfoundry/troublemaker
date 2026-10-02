import { describe, expect, it } from 'vitest';

import { analysis } from './helpers/analysis.js';
import { countReversals, evaluate, type Decision } from '../../agent/src/mastering/policy.js';
import { getProfile, PROFILES } from '../../agent/src/mastering/profiles.js';
import { buildReferenceProfile, median } from '../../agent/src/mastering/reference.js';
import { formatReport } from '../../agent/src/mastering/report.js';

const techno = getProfile('techno');
const ids = (e: ReturnType<typeof evaluate>) => e.findings.map((f) => f.id);

describe('profiles', () => {
  it('never treats -23 LUFS broadcast loudness as a club target', () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.lufsRange[0]).toBeGreaterThan(-15);
    }
  });

  it('keeps every deliverable at or below -0.5 dBTP', () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.truePeakCeilingDbtp).toBeLessThanOrEqual(-0.5);
    }
  });

  it('rejects an unknown profile with the known ones', () => {
    expect(() => getProfile('trance')).toThrow(/techno/);
  });
});

describe('references', () => {
  it('uses the median so one outlier cannot drag the target', () => {
    const profile = buildReferenceProfile([
      analysis({ lufs: -7 }),
      analysis({ lufs: -7.4 }),
      analysis({ lufs: -14 }),
    ]);
    expect(profile.integratedLufs).toBe(-7.4);
    expect(profile.spreadLu).toBe(7);
  });

  it('computes an even-length median', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('policy', () => {
  it('passes a clean master inside its profile envelope', () => {
    const result = evaluate({ target: analysis(), profile: techno });
    expect(result.verdict).toBe('PASS');
    expect(ids(result)).toContain('loudness-ok');
  });

  it('fails a true-peak over and says when it is inter-sample', () => {
    const result = evaluate({ target: analysis({ tp: -0.4, sp: -1.0 }), profile: techno });
    expect(result.verdict).toBe('FAIL');
    expect(result.findings.find((f) => f.id === 'true-peak')!.message).toMatch(/inter-sample/);
  });

  it('gives Live 11 specific advice when the Limiter has no True Peak mode', () => {
    const result = evaluate({
      target: analysis({ tp: -0.4 }),
      profile: techno,
      chain: { readings: [], limiterTruePeak: 'unavailable' },
    });
    expect(result.findings.find((f) => f.id === 'true-peak')!.action).toMatch(/Live 11.*0\.7 dB/);
  });

  it('targets the reference median +/- 1 LU instead of the profile when references exist', () => {
    const reference = buildReferenceProfile([analysis({ lufs: -10 }), analysis({ lufs: -10 })]);
    const result = evaluate({ target: analysis({ lufs: -8 }), profile: techno, reference });
    expect(result.working).toMatchObject({ source: 'references', lufsLow: -11, lufsHigh: -9 });
    expect(ids(result)).toContain('too-loud');
    expect(result.findings.find((f) => f.id === 'too-loud')!.action).toMatch(/Do NOT add limiter gain/);
  });

  it('allows staying quieter than the references', () => {
    const reference = buildReferenceProfile([analysis({ lufs: -7 })]);
    const result = evaluate({ target: analysis({ lufs: -10 }), profile: techno, reference });
    expect(result.findings.find((f) => f.id === 'quieter')!.severity).toBe('info');
    expect(result.verdict).toBe('PASS');
  });

  it('sends large tonal differences back to the mix, as one finding', () => {
    const reference = buildReferenceProfile([analysis()]);
    const result = evaluate({
      // Baseline tilt is -10 dB per band, so these are deltas of -4, +5 and +4.
      target: analysis({ tilt: { sub: -14, presence: -5, air: -6 } }),
      profile: techno,
      reference,
    });
    const tone = result.findings.filter((f) => f.area === 'tone');
    expect(tone).toHaveLength(1);
    expect(tone[0]!.severity).toBe('review');
    expect(tone[0]!.message).toMatch(/sub -4\.0.*presence \+5\.0.*air \+4\.0/);
    expect(tone[0]!.action).toMatch(/mix problem/);
  });

  it('notes moderate tonal differences without blocking', () => {
    const reference = buildReferenceProfile([analysis()]);
    const result = evaluate({ target: analysis({ tilt: { mid: -8 } }), profile: techno, reference });
    expect(result.findings.find((f) => f.id === 'tone-moderate')!.severity).toBe('info');
    expect(result.verdict).toBe('PASS');
  });

  it('reviews bass that vanishes in mono', () => {
    const result = evaluate({ target: analysis({ lowMono: -6 }), profile: techno });
    expect(result.findings.find((f) => f.id === 'bass-mono')!.severity).toBe('review');
  });

  it('warns about side energy in the low end relative to references', () => {
    const reference = buildReferenceProfile([analysis({ side: { sub: -30 } })]);
    const result = evaluate({ target: analysis({ side: { sub: -10 } }), profile: techno, reference });
    expect(result.findings.find((f) => f.id === 'side-sub')!.message).toMatch(/-10\.0 dB relative to mid/);
  });

  it('warns about an over-limited master against the profile floor without references', () => {
    const result = evaluate({ target: analysis({ lufs: -6, tp: -1.1 }), profile: techno });
    expect(result.findings.find((f) => f.id === 'over-limited')!.message).toMatch(/below the 7 dB floor/);
  });

  it('flags references that disagree materially', () => {
    const reference = buildReferenceProfile([analysis({ lufs: -6 }), analysis({ lufs: -12 })]);
    expect(ids(evaluate({ target: analysis(), profile: techno, reference }))).toContain('references-disagree');
  });

  it('flags hard clipping in the source for review', () => {
    expect(evaluate({ target: analysis({ clipped: 40 }), profile: techno }).verdict).toBe('REVIEW');
  });

  it('fails a deliverable at the wrong bit depth', () => {
    const result = evaluate({ target: analysis({ bitDepth: 16 }), profile: techno, delivery: { bitDepth: 24 } });
    expect(ids(result)).toContain('bit-depth');
  });

  it('applies the 3 dB / 4 dB limiter-drive thresholds', () => {
    const reading = (value: number) => ({
      readings: [{ role: 'limiter_gain', value, unit: 'dB', display: `${value} dB` }],
      limiterTruePeak: 'on' as const,
    });
    const at = (value: number) =>
      evaluate({ target: analysis(), profile: techno, chain: reading(value) }).findings.find(
        (f) => f.id === 'limiter-drive',
      )?.severity;
    expect(at(2.5)).toBeUndefined();
    expect(at(3.5)).toBe('warn');
    expect(at(4.5)).toBe('review');
  });

  it('reviews broad master EQ beyond 3 dB', () => {
    const result = evaluate({
      target: analysis(),
      profile: techno,
      chain: {
        readings: [{ role: 'eq_2_gain', value: -3.5, unit: 'dB', display: '-3.5 dB' }],
        limiterTruePeak: 'on',
      },
    });
    expect(result.verdict).toBe('REVIEW');
  });

  it('stops an optimiser that keeps reversing the same control', () => {
    const decisions: Decision[] = [
      { role: 'eq_1_gain', before: 0, after: 1, reason: 'x', at: '' },
      { role: 'eq_1_gain', before: 1, after: 0.5, reason: 'x', at: '' },
      { role: 'eq_1_gain', before: 0.5, after: 1, reason: 'x', at: '' },
    ];
    expect(countReversals(decisions).get('eq_1_gain')).toBe(2);
    expect(ids(evaluate({ target: analysis(), profile: techno, decisions }))).toContain('reversal-eq_1_gain');
  });

  it('never counts an option role as reversing', () => {
    const decisions: Decision[] = [
      { role: 'limiter_mode', before: 'True Peak', after: 'Standard', reason: 'x', at: '' },
      { role: 'limiter_mode', before: 'Standard', after: 'True Peak', reason: 'x', at: '' },
      { role: 'limiter_mode', before: 'True Peak', after: 'Standard', reason: 'x', at: '' },
    ];
    expect(countReversals(decisions).get('limiter_mode')).toBeUndefined();
  });

  it('restarts the reversal count after a preset', () => {
    const decisions: Decision[] = [
      { role: 'eq_1_gain', before: 0, after: 1, reason: 'x', at: '' },
      { role: 'eq_1_gain', before: 1, after: 0.5, reason: 'x', at: '' },
      { role: 'eq_1_gain', before: 0.5, after: 0, reason: 'preset', at: '', preset: 'clean' },
      { role: 'eq_1_gain', before: 0, after: 1, reason: 'x', at: '' },
    ];
    expect(countReversals(decisions).get('eq_1_gain')).toBeUndefined();
  });
});

describe('report', () => {
  it('leads with the verdict and lists findings worst first', () => {
    const target = analysis({ tp: -0.2, clipped: 5 });
    const report = formatReport(target, evaluate({ target, profile: techno }), { profileName: 'techno' });
    expect(report.split('\n')[0]).toBe('MASTER RESULT: FAIL');
    expect(report.indexOf('[FAIL]')).toBeLessThan(report.indexOf('[REVIEW]'));
  });
});
