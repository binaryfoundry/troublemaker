import { describe, expect, it } from 'vitest';

import { analysis } from './helpers/analysis.js';
import { countReversals, evaluate, type Decision } from '../../agent/src/mastering/policy.js';
import { getProfile, PROFILES } from '../../agent/src/mastering/profiles.js';
import { buildReferenceProfile, median } from '../../agent/src/mastering/reference.js';
import { formatReport } from '../../agent/src/mastering/report.js';

const techno = getProfile('techno');
const ids = (e: ReturnType<typeof evaluate>) => e.findings.map((f) => f.id);

describe('track roles', () => {
  it('recognises plural track names', async () => {
    const { inferTrackRole } = await import('../../agent/src/composition.js');
    expect(inferTrackRole('Hats').role).toBe('hats');
    expect(inferTrackRole('Chords').role).toBe('chords');
    expect(inferTrackRole('Kicks').role).toBe('kick');
    expect(inferTrackRole('Vocals').role).toBe('vocal');
  });
});

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

  it('reports a silent capture as a capture failure, with no mix findings', () => {
    const result = evaluate({ target: analysis({ lufs: -70, tp: -120, sp: -120 }), profile: techno });
    expect(result.verdict).toBe('FAIL');
    expect(ids(result)).toEqual(['silent']);
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

  it('says to lower the ceiling when True Peak mode is on and still overshoots', () => {
    const result = evaluate({
      target: analysis({ tp: -0.9 }),
      profile: techno,
      chain: { readings: [], limiterTruePeak: 'on' },
    });
    expect(result.findings.find((f) => f.id === 'true-peak')!.action).toMatch(/still overshoots.*0\.2 dB/);
  });

  // Club references are the authority (the user, 2026-10-07): the loudest
  // section is judged against theirs, and falling short fails.
  it('targets the references\' loudest section +/- 1 LU instead of the profile', () => {
    // The helper puts the loudest section 0.8 LU above integrated.
    const reference = buildReferenceProfile([analysis({ lufs: -10 }), analysis({ lufs: -10 })]);
    const result = evaluate({ target: analysis({ lufs: -8 }), profile: techno, reference });
    expect(result.working).toMatchObject({ source: 'references', lufsLow: -10.2, lufsHigh: -8.2 });
    expect(ids(result)).toContain('too-loud');
    expect(result.findings.find((f) => f.id === 'too-loud')!.action).toMatch(/Do NOT add limiter gain/);
  });

  it('fails a master whose loudest section is well below the club references', () => {
    // Threshold against the Prydz set: -12.5 LUFS in its loudest 30 s against -6.3.
    const reference = buildReferenceProfile([analysis({ lufs: -7 })]);
    const result = evaluate({ target: analysis({ lufs: -13 }), profile: techno, reference });
    const quieter = result.findings.find((f) => f.id === 'quieter')!;
    expect(quieter.severity).toBe('fail');
    expect(quieter.message).toMatch(/6\.0 LU below the club references/);
    expect(result.verdict).toBe('FAIL');
  });

  it('accepts a loudest section within 1.5 LU of the references, and reports integrated as information', () => {
    const reference = buildReferenceProfile([analysis({ lufs: -7 })]);
    const result = evaluate({ target: analysis({ lufs: -8 }), profile: techno, reference });
    expect(ids(result)).toContain('loudness-ok');
    expect(result.findings.find((f) => f.id === 'integrated')!.severity).toBe('info');
    expect(result.verdict).toBe('PASS');
  });

  it('takes the true-peak ceiling from lossless references, never from an MP3', () => {
    const flac = (tp: number) => ({ ...analysis({ tp }), file: { ...analysis().file, codec: 'flac' } });
    const mp3 = (tp: number) => ({ ...analysis({ tp }), file: { ...analysis().file, codec: 'mp3' } });
    const fromFlac = buildReferenceProfile([flac(-0.2), flac(-0.4), mp3(1.6)]);
    expect(fromFlac.losslessTruePeakDbtp).toBe(-0.3);
    const result = evaluate({ target: analysis({ tp: -0.5 }), profile: techno, reference: fromFlac });
    expect(result.working.truePeakCeilingDbtp).toBe(-0.3);
    expect(ids(result)).not.toContain('true-peak');
    // Only lossy references: the profile's ceiling stands.
    const onlyMp3 = buildReferenceProfile([mp3(1.6)]);
    expect(evaluate({ target: analysis(), profile: techno, reference: onlyMp3 }).working.truePeakCeilingDbtp).toBe(-1);
  });

  it('judges infra by the brick-wall measure, not the band filter that reads a low sub as rumble', () => {
    // Black Glass: the band delta read +9 dB; by FFT it was level with the references.
    const reference = buildReferenceProfile([analysis({ infraToSub: -23 })]);
    const lowSub = evaluate({ target: analysis({ tilt: { infra: -1 }, infraToSub: -22.5 }), profile: techno, reference });
    expect(ids(lowSub)).not.toContain('infra');
    const rumble = evaluate({ target: analysis({ infraToSub: -15 }), profile: techno, reference });
    const finding = rumble.findings.find((f) => f.id === 'infra')!;
    expect(finding.severity).toBe('fail');
    expect(finding.message).toMatch(/\+8\.0 dB over the references.*brick-wall/);
    // Without the measure on either side, the band delta still decides.
    const old = buildReferenceProfile([analysis({ infraToSub: null })]);
    expect(ids(evaluate({ target: analysis({ tilt: { infra: -1 }, infraToSub: null }), profile: techno, reference: old }))).toContain('infra');
  });

  it('fails a master whose samples reach full scale', () => {
    const result = evaluate({ target: analysis({ tp: 0.4, sp: 0 }), profile: techno });
    expect(result.findings.find((f) => f.id === 'sample-peak')!.severity).toBe('fail');
  });

  it('flags a master much less dense than the references', () => {
    // PLR is tp - lufs in the helper: 7.9 dB for the reference, 12.2 for the target.
    const reference = buildReferenceProfile([analysis({ lufs: -9, tp: -1.1 })]);
    const result = evaluate({ target: analysis({ lufs: -13.3, tp: -1.1 }), profile: techno, reference });
    expect(result.findings.find((f) => f.id === 'under-limited')!.message).toMatch(/4\.3 dB above the references/);
  });

  it('compares a drop capture\'s density with the references\' drops, not their whole tracks', () => {
    // The Prydz set: integrated -9.6 with long intros, drops at -6.3, true peak +0.7.
    const prydz = buildReferenceProfile([analysis({ lufs: -9.6, tp: 0.7, sectionLufs: -6.3 })]);
    expect(prydz.sectionPlrDb).toBe(7);
    // A 30 s capture of a drop as dense as theirs: integrated and section are the same.
    const drop = evaluate({ target: analysis({ lufs: -6.5, tp: 0.4, sectionLufs: -6.5 }), profile: techno, reference: prydz });
    expect(ids(drop)).not.toContain('over-limited');
    expect(ids(drop)).not.toContain('under-limited');
    expect(ids(drop)).toContain('loudness-ok');
  });

  it('warns that a 16-bit file is not a club master', () => {
    expect(evaluate({ target: analysis({ bitDepth: 16 }), profile: techno }).findings.find((f) => f.id === 'bit-depth-club')!.severity).toBe('warn');
    expect(ids(evaluate({ target: analysis({ bitDepth: 24 }), profile: techno }))).not.toContain('bit-depth-club');
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
    expect(tone[0]!.severity).toBe('fail');
    expect(tone[0]!.message).toMatch(/sub -4\.0.*presence \+5\.0.*air \+4\.0/);
    expect(tone[0]!.action).toMatch(/mix problem/);
  });

  it('warns about moderate tonal differences without blocking', () => {
    const reference = buildReferenceProfile([analysis()]);
    const result = evaluate({ target: analysis({ tilt: { mid: -8 } }), profile: techno, reference });
    expect(result.findings.find((f) => f.id === 'tone-moderate')!.severity).toBe('warn');
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

  it('judges heavy limiter drive by density against the references, not by the number', () => {
    const chain = { readings: [{ role: 'limiter_gain', value: 6, unit: 'dB', display: '6 dB' }], limiterTruePeak: 'off' as const };
    const reference = buildReferenceProfile([analysis({ lufs: -7, tp: 0.5 })]);
    // As dense as the references: information only.
    const dense = evaluate({ target: analysis({ lufs: -7, tp: 0.5 }), profile: techno, reference, chain });
    expect(dense.findings.find((f) => f.id === 'limiter-drive')!.severity).toBe('info');
    // Squashed 3 dB past them: review.
    const squashed = evaluate({ target: analysis({ lufs: -6, tp: -1.5 }), profile: techno, reference, chain });
    expect(squashed.findings.find((f) => f.id === 'limiter-drive')!.severity).toBe('review');
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
