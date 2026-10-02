/**
 * Loudness-matched A/B comparison.
 *
 * MIXING.md: "Never increase loudness without a loudness-matched before/after
 * comparison", and "choosing the more convincing master rather than the
 * louder one". A louder version always seems better, so every measure here is
 * one that loudness cannot fake: peak-to-loudness ratio, tonal balance relative
 * to each file's own level, low-end mono safety, and technical failures.
 * Loudness itself only earns credit while a version is still below its
 * working window - once it is competitive, more level buys nothing.
 */

import type { Analysis } from '../../../qc/src/types.js';
import { THRESHOLDS, type MasteringProfile } from './profiles.js';
import { compareToReference, type ReferenceProfile } from './reference.js';

export type Version = 'A' | 'B';

export interface VersionSummary {
  integratedLufs: number;
  truePeakDbtp: number;
  plrDb: number;
  lowMonoLossDb: number;
  clippedRuns: number;
  /** RMS of per-band tilt differences from the reference median; null without references. */
  referenceDistanceDb: number | null;
  technicalFailures: string[];
}

export interface Comparison {
  preferred: Version;
  confidence: 'clear' | 'marginal' | 'no-difference';
  /** Gain (dB) to apply to B so it plays at A's integrated loudness. */
  matchGainDb: number;
  loudnessDeltaLu: number;
  plrDeltaDb: number;
  lowMonoDeltaDb: number;
  /** Per band, B's tilt minus A's tilt: what the change did to tonal balance. */
  tiltChangeDb: Record<string, number>;
  a: VersionSummary;
  b: VersionSummary;
  reasons: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function summarise(
  analysis: Analysis,
  profile: MasteringProfile,
  reference?: ReferenceProfile,
): VersionSummary {
  const failures: string[] = [];
  if (analysis.loudness.truePeakDbtp > profile.truePeakCeilingDbtp + 0.05) {
    failures.push(
      `true peak ${analysis.loudness.truePeakDbtp.toFixed(2)} dBTP over the ${profile.truePeakCeilingDbtp} dBTP ceiling`,
    );
  }
  if (analysis.whole.integrity.clippedRuns > 0) {
    failures.push(`${analysis.whole.integrity.clippedRuns} clipped runs`);
  }
  let referenceDistanceDb: number | null = null;
  if (reference) {
    const deltas = Object.entries(compareToReference(analysis, reference).bandDeltaDb)
      .filter(([band]) => band !== 'infra' && band !== 'air')
      .map(([, d]) => d);
    referenceDistanceDb = r2(Math.sqrt(deltas.reduce((s, d) => s + d * d, 0) / Math.max(1, deltas.length)));
  }
  return {
    integratedLufs: analysis.loudness.integratedLufs,
    truePeakDbtp: analysis.loudness.truePeakDbtp,
    plrDb: analysis.loudness.plrDb,
    lowMonoLossDb: analysis.section.stereo.lowMonoLossDb,
    clippedRuns: analysis.whole.integrity.clippedRuns,
    referenceDistanceDb,
    technicalFailures: failures,
  };
}

/**
 * What the change between A and B was meant to do. A tonal shift is the
 * point of an EQ move but a side effect of a dynamics move, so only the
 * latter is scored against B. Unknown means report it and let it be.
 */
export type ChangeIntent = 'tonal' | 'dynamics' | 'unknown';

export function intentForRole(role: string): ChangeIntent {
  if (/^eq_|^saturator_type|^bass_mono/.test(role)) return 'tonal';
  if (/^(glue_|limiter_|saturator_drive|saturator_output|input_trim)/.test(role)) return 'dynamics';
  return 'unknown';
}

export function compareVersions(input: {
  a: Analysis;
  b: Analysis;
  profile: MasteringProfile;
  reference?: ReferenceProfile;
  intent?: ChangeIntent;
}): Comparison {
  const t = THRESHOLDS;
  const a = summarise(input.a, input.profile, input.reference);
  const b = summarise(input.b, input.profile, input.reference);
  const loudnessDeltaLu = r2(b.integratedLufs - a.integratedLufs);
  const plrDeltaDb = r2(b.plrDb - a.plrDb);
  const lowMonoDeltaDb = r2(b.lowMonoLossDb - a.lowMonoLossDb);

  const tiltChangeDb: Record<string, number> = {};
  for (const band of input.b.section.bands) {
    const other = input.a.section.bands.find((x) => x.name === band.name);
    if (other) tiltChangeDb[band.name] = r2(band.midRelativeDb - other.midRelativeDb);
  }

  const windowLow = input.reference
    ? input.reference.integratedLufs - t.referenceWindowLu
    : input.profile.lufsRange[0];

  const result = (preferred: Version, confidence: Comparison['confidence'], reasons: string[]): Comparison => ({
    preferred,
    confidence,
    matchGainDb: r2(-loudnessDeltaLu),
    loudnessDeltaLu,
    plrDeltaDb,
    lowMonoDeltaDb,
    tiltChangeDb,
    a,
    b,
    reasons,
  });

  // 1. A technical failure outweighs everything else.
  if (a.technicalFailures.length !== b.technicalFailures.length) {
    const winner: Version = a.technicalFailures.length < b.technicalFailures.length ? 'A' : 'B';
    const loser = winner === 'A' ? b : a;
    return result(winner, 'clear', [
      `${winner === 'A' ? 'B' : 'A'} fails technically: ${loser.technicalFailures.join('; ')}.`,
    ]);
  }

  // 2. What the change costs, measured independently of level.
  const costs: string[] = [];
  const gains: string[] = [];

  // Both failing is not a tie: report it, and count a worse overshoot.
  if (a.technicalFailures.length > 0) {
    const overshootA = a.truePeakDbtp - input.profile.truePeakCeilingDbtp;
    const overshootB = b.truePeakDbtp - input.profile.truePeakCeilingDbtp;
    if (overshootB - overshootA >= 0.1) {
      costs.push(`B overshoots the true-peak ceiling by ${(overshootB - overshootA).toFixed(1)} dB more than A`);
    } else if (overshootA - overshootB >= 0.1) {
      gains.push(`B overshoots the true-peak ceiling by ${(overshootA - overshootB).toFixed(1)} dB less than A`);
    }
  }

  const biggestShift = Object.entries(tiltChangeDb)
    .filter(([band]) => band !== 'infra')
    .reduce<[string, number]>((best, entry) => (Math.abs(entry[1]) > Math.abs(best[1]) ? entry : best), ['', 0]);
  if ((input.intent ?? 'unknown') === 'dynamics' && Math.abs(biggestShift[1]) >= t.abTonalSideEffectDb) {
    costs.push(
      `the dynamics change shifted tonal balance by up to ${Math.abs(biggestShift[1]).toFixed(1)} dB ` +
        `(${biggestShift[0]}) - a side effect, not the intent`,
    );
  }

  const plrCost = `B has ${Math.abs(plrDeltaDb).toFixed(1)} dB less peak-to-loudness ratio (less punch at matched level)`;
  if (plrDeltaDb <= -t.abPlrNoticeDb) {
    costs.push(plrCost);
  } else if (plrDeltaDb >= t.abPlrNoticeDb) {
    gains.push(`B keeps ${plrDeltaDb.toFixed(1)} dB more peak-to-loudness ratio`);
  }

  if (lowMonoDeltaDb <= -t.abMonoNoticeDb) {
    costs.push(`B's low end loses ${Math.abs(lowMonoDeltaDb).toFixed(1)} dB more in mono`);
  } else if (lowMonoDeltaDb >= t.abMonoNoticeDb) {
    gains.push(`B's low end is ${lowMonoDeltaDb.toFixed(1)} dB more mono-safe`);
  }

  if (a.referenceDistanceDb !== null && b.referenceDistanceDb !== null) {
    const closer = r2(a.referenceDistanceDb - b.referenceDistanceDb);
    if (closer >= t.abTonalNoticeDb) {
      gains.push(`B is ${closer.toFixed(1)} dB closer to the references' tonal balance`);
    } else if (closer <= -t.abTonalNoticeDb) {
      costs.push(`B is ${Math.abs(closer).toFixed(1)} dB further from the references' tonal balance`);
    }
  }

  // 3. Loudness only counts while A is still below its working window.
  const louder = loudnessDeltaLu >= 0.5;
  const quieter = loudnessDeltaLu <= -0.5;
  const aBelowWindow = a.integratedLufs < windowLow;
  let loudnessCredit = false;
  if (louder && aBelowWindow) {
    const tolerable = Math.abs(Math.min(0, plrDeltaDb)) <= t.abPlrTolerableDb;
    if (tolerable) {
      loudnessCredit = true;
      // The PLR given up is the price of that loudness, not a second cost.
      const priced = costs.indexOf(plrCost);
      if (priced >= 0) costs.splice(priced, 1);
      gains.push(
        `B is ${loudnessDeltaLu.toFixed(1)} LU louder and A was below the working window ` +
          `(${windowLow.toFixed(1)} LUFS)` +
          (plrDeltaDb < 0 ? `, for ${Math.abs(plrDeltaDb).toFixed(1)} dB of PLR (within ${t.abPlrTolerableDb} dB)` : ''),
      );
    } else {
      costs.push(
        `B's ${loudnessDeltaLu.toFixed(1)} LU of loudness costs more than ${t.abPlrTolerableDb} dB of PLR`,
      );
    }
  } else if (louder) {
    costs.push(
      `B is ${loudnessDeltaLu.toFixed(1)} LU louder, but A is already competitive - extra level earns nothing`,
    );
  } else if (quieter && !aBelowWindow) {
    // Coming down from too loud is neutral; the other measures decide.
  }

  const reasons = [...gains.map((g) => `+ ${g}`), ...costs.map((c) => `- ${c}`)];
  if (a.technicalFailures.length > 0) {
    reasons.unshift(
      `! Both versions fail technically (A: ${a.technicalFailures.join('; ')}; B: ${b.technicalFailures.join('; ')}). ` +
        'Fix that before trusting either.',
    );
  }

  if (gains.length === 0 && costs.length === 0) {
    return result('A', 'no-difference', [
      'No measurable difference at matched loudness. Keep A: the best move can be no move.',
    ]);
  }
  // Costs that are only "louder for nothing" still lose to A.
  if (gains.length > costs.length) {
    return result('B', loudnessCredit && gains.length === 1 ? 'marginal' : 'clear', reasons);
  }
  if (gains.length === costs.length) {
    return result('A', 'marginal', [...reasons, 'Gains and costs balance out; keep A.']);
  }
  return result('A', 'clear', reasons);
}
