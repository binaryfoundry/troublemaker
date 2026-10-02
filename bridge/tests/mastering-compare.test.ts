import { describe, expect, it } from 'vitest';

import { compareVersions } from '../../agent/src/mastering/compare.js';
import { getProfile } from '../../agent/src/mastering/profiles.js';
import { buildReferenceProfile } from '../../agent/src/mastering/reference.js';
import { analysis } from './helpers/analysis.js';

const techno = getProfile('techno'); // working window -9 to -6 LUFS without references

/** PLR is true peak minus integrated loudness, so pin both. */
const version = (lufs: number, plr: number, extra: Parameters<typeof analysis>[0] = {}) =>
  analysis({ lufs, tp: Math.min(-1.05, lufs + plr), ...extra });

describe('loudness-matched comparison', () => {
  it('reports the gain that plays B at A loudness', () => {
    const result = compareVersions({ a: version(-12, 11), b: version(-9, 8), profile: techno });
    expect(result.loudnessDeltaLu).toBe(3);
    expect(result.matchGainDb).toBe(-3);
  });

  it('keeps A when the change makes no measurable difference - no move is a move', () => {
    const result = compareVersions({ a: version(-8, 7), b: version(-8.1, 7.2), profile: techno });
    expect(result).toMatchObject({ preferred: 'A', confidence: 'no-difference' });
  });

  it('gives no credit for loudness once A is already competitive', () => {
    const result = compareVersions({ a: version(-7.5, 6.4), b: version(-6.5, 5.4), profile: techno });
    expect(result.preferred).toBe('A');
    expect(result.reasons.join(' ')).toMatch(/already competitive/);
  });

  it('accepts a louder B when A was below the window and the PLR cost is tolerable', () => {
    // The real Live run: -15.2 -> -11.3 LUFS for 2.2 dB of PLR.
    const result = compareVersions({ a: version(-15.2, 12.5), b: version(-11.4, 10.3), profile: techno });
    expect(result.preferred).toBe('B');
    expect(result.reasons.join(' ')).toMatch(/2\.2 dB of PLR \(within 3 dB\)/);
  });

  it('rejects loudness that costs more than 3 dB of PLR even below the window', () => {
    const result = compareVersions({ a: version(-15, 12), b: version(-10, 7.5), profile: techno });
    expect(result.preferred).toBe('A');
    expect(result.reasons.join(' ')).toMatch(/costs more than 3 dB/);
  });

  it('prefers the version that keeps more punch at the same loudness', () => {
    const result = compareVersions({ a: version(-9, 6), b: version(-9, 7.5), profile: techno });
    expect(result).toMatchObject({ preferred: 'B', confidence: 'clear' });
  });

  it('lets a technical failure decide on its own', () => {
    const result = compareVersions({
      a: version(-8, 7),
      b: analysis({ lufs: -7, tp: -0.4 }),
      profile: techno,
    });
    expect(result.preferred).toBe('A');
    expect(result.reasons[0]).toMatch(/B fails technically: true peak/);
  });

  it('counts a loss of low-end mono safety against B', () => {
    const result = compareVersions({
      a: version(-8, 7),
      b: version(-8, 7, { lowMono: -2 }),
      profile: techno,
    });
    expect(result.preferred).toBe('A');
    expect(result.reasons.join(' ')).toMatch(/loses 2\.0 dB more in mono/);
  });

  it('judges tonal changes against the references when they exist', () => {
    const reference = buildReferenceProfile([analysis({ tilt: { presence: -10 } })]);
    const result = compareVersions({
      a: version(-8, 7, { tilt: { presence: -6 } }),
      b: version(-8, 7, { tilt: { presence: -9.5 } }),
      profile: techno,
      reference,
    });
    expect(result.preferred).toBe('B');
    expect(result.reasons.join(' ')).toMatch(/closer to the references/);
  });

  it('records what the change did to each band', () => {
    const result = compareVersions({
      a: version(-8, 7, { tilt: { sub: -10 } }),
      b: version(-8, 7, { tilt: { sub: -8.5 } }),
      profile: techno,
    });
    expect(result.tiltChangeDb.sub).toBe(1.5);
  });
});
