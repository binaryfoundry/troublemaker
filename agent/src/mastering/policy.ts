/**
 * Mastering decision rules.
 *
 * Encodes MIXING.md's "rules the agent should refuse to violate" and its stop
 * conditions as checks over measurements. Every finding says what was
 * measured, why it matters and what to do - and many of the right answers are
 * "fix it in the mix", because the most common mastering failure is treating
 * a mix problem as a mastering problem.
 */

import type { Analysis } from '../../../qc/src/types.js';
import { THRESHOLDS, type MasteringProfile } from './profiles.js';
import { compareToReference, type ReferenceComparison, type ReferenceProfile } from './reference.js';

export type Severity = 'info' | 'warn' | 'review' | 'fail';
export type Verdict = 'PASS' | 'REVIEW' | 'FAIL';

export interface Finding {
  id: string;
  severity: Severity;
  area: 'file' | 'loudness' | 'peak' | 'tone' | 'low-end' | 'stereo' | 'dynamics' | 'chain' | 'process';
  message: string;
  action: string;
}

/** Engineering-unit values read from the master chain, by role. */
export interface ChainReading {
  role: string;
  value: number;
  unit: string;
  display: string | null;
}

export interface ChainState {
  readings: ChainReading[];
  /** 'unavailable' means the Limiter has no True Peak mode (Live 11). */
  limiterTruePeak: 'on' | 'off' | 'unavailable' | 'no-limiter';
}

export interface Decision {
  role: string;
  before: number | string | null;
  after: number | string | null;
  reason: string;
  at: string;
  track_id?: number;
  /** Set when a preset made this change; presets reset the reversal count. */
  preset?: string;
}

export interface Evaluation {
  verdict: Verdict;
  findings: Finding[];
  working: {
    source: 'references' | 'profile';
    lufsLow: number;
    lufsHigh: number;
    truePeakCeilingDbtp: number;
  };
  comparison: ReferenceComparison | null;
}

export interface EvaluateInput {
  target: Analysis;
  profile: MasteringProfile;
  reference?: ReferenceProfile;
  chain?: ChainState;
  decisions?: Decision[];
  delivery?: { sampleRate?: number; bitDepth?: number };
}

/** Below this a capture holds nothing: BS.1770 gating bottoms out at -70. */
const SILENT_LUFS = -60;

export function evaluate(input: EvaluateInput): Evaluation {
  const { target, profile, reference } = input;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const t = THRESHOLDS;

  // -- file integrity -----------------------------------------------------
  const file = target.file;
  if (input.delivery?.sampleRate && file.sampleRate !== input.delivery.sampleRate) {
    add({
      id: 'sample-rate',
      severity: 'fail',
      area: 'file',
      message: `Sample rate is ${file.sampleRate} Hz; the delivery spec is ${input.delivery.sampleRate} Hz.`,
      action: 'Re-export at the project rate. Avoid unnecessary sample-rate conversion.',
    });
  }
  if (input.delivery?.bitDepth && file.bitDepth !== null && file.bitDepth !== input.delivery.bitDepth) {
    add({
      id: 'bit-depth',
      severity: 'fail',
      area: 'file',
      message: `Bit depth is ${file.bitDepth}; the delivery spec is ${input.delivery.bitDepth}.`,
      action: 'Re-export at the delivery bit depth, dithering once at the final reduction.',
    });
  }
  if (target.whole.integrity.silentChannel) {
    add({
      id: 'silent-channel',
      severity: 'fail',
      area: 'file',
      message: 'One channel is silent.',
      action: 'Check the export routing and channel configuration.',
    });
  }
  // A silent capture is a routing or playback failure, not a mix to judge.
  const silent = target.loudness.integratedLufs <= SILENT_LUFS;
  if (silent) {
    add({
      id: 'silent',
      severity: 'fail',
      area: 'file',
      message: `The file is silent (${target.loudness.integratedLufs.toFixed(1)} LUFS).`,
      action:
        'Nothing was playing during the capture. For an Arrangement capture, check Back to Arrangement and that ' +
        'clips sit at that position; for a scene, check it holds clips. No mix findings are given for silence.',
    });
  }
  if (target.whole.integrity.clippedRuns > 0) {
    add({
      id: 'clipping',
      severity: 'review',
      area: 'peak',
      message: `${target.whole.integrity.clippedRuns} runs of consecutive full-scale samples (hard clipping).`,
      action: 'If the source is already clipped, return to the mix; a limiter cannot undo it.',
    });
  }
  const dc = Math.max(...target.whole.integrity.dcOffset.map(Math.abs));
  if (dc > t.dcWarn) {
    add({
      id: 'dc-offset',
      severity: 'warn',
      area: 'file',
      message: `DC offset of ${dc.toFixed(4)} detected.`,
      action: "Remove it at source, or use Saturator's Pre-DC filter / a gentle high-pass.",
    });
  }

  // -- true peak ----------------------------------------------------------
  const tp = target.loudness.truePeakDbtp;
  if (tp > profile.truePeakCeilingDbtp + 0.05) {
    add({
      id: 'true-peak',
      severity: 'fail',
      area: 'peak',
      message: `True peak ${tp.toFixed(2)} dBTP exceeds the ${profile.truePeakCeilingDbtp} dBTP ceiling` +
        (target.loudness.samplePeakDbfs <= profile.truePeakCeilingDbtp
          ? ` although sample peak is only ${target.loudness.samplePeakDbfs.toFixed(2)} dBFS - inter-sample overs.`
          : '.'),
      action: truePeakAction(input.chain?.limiterTruePeak, tp - profile.truePeakCeilingDbtp),
    });
  }

  // -- loudness -----------------------------------------------------------
  let lufsLow = profile.lufsRange[0];
  let lufsHigh = profile.lufsRange[1];
  let source: 'references' | 'profile' = 'profile';
  let comparison: ReferenceComparison | null = null;

  if (reference) {
    source = 'references';
    lufsLow = reference.integratedLufs - t.referenceWindowLu;
    lufsHigh = reference.integratedLufs + t.referenceWindowLu;
    comparison = compareToReference(target, reference);

    if (reference.spreadLu > t.referenceSpreadLu) {
      add({
        id: 'references-disagree',
        severity: 'review',
        area: 'process',
        message: `References span ${reference.spreadLu} LU of integrated loudness; they disagree materially.`,
        action: 'Choose references from the same subgenre and era before trusting a loudness target.',
      });
    }
  }

  const integrated = target.loudness.integratedLufs;
  if (integrated > lufsHigh) {
    add({
      id: 'too-loud',
      severity: 'warn',
      area: 'loudness',
      message: `Integrated ${integrated.toFixed(1)} LUFS is above the working window (${lufsLow.toFixed(1)} to ${lufsHigh.toFixed(1)}, from ${source}).`,
      action: 'Do NOT add limiter gain. Consider backing it off and comparing at matched loudness.',
    });
  } else if (integrated < lufsLow) {
    add({
      id: 'quieter',
      severity: 'info',
      area: 'loudness',
      message: `Integrated ${integrated.toFixed(1)} LUFS is below the working window (${lufsLow.toFixed(1)} to ${lufsHigh.toFixed(1)}).`,
      action:
        'Staying quieter is allowed if more level audibly damages the track. If raising it, ' +
        'look at kick/sub/drum peak structure before limiter gain.',
    });
  } else {
    add({
      id: 'loudness-ok',
      severity: 'info',
      area: 'loudness',
      message: `Integrated ${integrated.toFixed(1)} LUFS is inside the working window.`,
      action: 'Loudness is competitive. Further gains must win a loudness-matched A/B.',
    });
  }

  // -- dynamics -----------------------------------------------------------
  if (!comparison && target.loudness.plrDb < profile.minPlrDb) {
    add({
      id: 'over-limited',
      severity: 'warn',
      area: 'dynamics',
      message: `Peak-to-loudness ratio is ${target.loudness.plrDb.toFixed(1)} dB, below the ${profile.minPlrDb} dB floor for ${profile.name}.`,
      action: 'Likely over-limited. Back off limiter drive and compare at matched loudness; add references for a better floor.',
    });
  }
  if (comparison && comparison.plrDeltaDb < -t.plrBelowReferenceDb) {
    add({
      id: 'over-limited',
      severity: 'warn',
      area: 'dynamics',
      message: `Peak-to-loudness ratio is ${Math.abs(comparison.plrDeltaDb).toFixed(1)} dB below the references.`,
      action:
        'Likely over-compressed or over-limited. Reduce bus/master dynamics and compare at matched loudness.',
    });
  }

  // -- tone (loudness-independent tilt vs references) ----------------------
  const lowMono = target.section.stereo.lowMonoLossDb;
  if (comparison) {
    // One finding per severity, listing the bands: a single root cause (a
    // cancelling bass, a hot top end) moves several bands at once, and nine
    // separate lines would bury it.
    const describe = (entries: Array<[string, number]>) =>
      entries.map(([band, d]) => `${band} ${d > 0 ? '+' : ''}${d.toFixed(1)}`).join(', ');
    const tonal = Object.entries(comparison.bandDeltaDb).filter(([band]) => band !== 'infra');
    const large = tonal.filter(([, d]) => Math.abs(d) >= t.bandDeviationReviewDb);
    const moderate = tonal.filter(
      ([, d]) => Math.abs(d) >= t.bandDeviationNoteDb && Math.abs(d) < t.bandDeviationReviewDb,
    );
    const cancelling = lowMono < t.lowMonoLossReviewDb;
    if (large.length) {
      add({
        id: 'tone-large',
        severity: 'review',
        area: 'tone',
        message: `Tonal balance differs from the reference median by 3 dB or more: ${describe(large)} dB.`,
        action:
          (cancelling
            ? 'Fix the low-end phase problem first - mono cancellation skews this comparison. Then '
            : '') + 'treat it as a mix problem: find the source tracks rather than EQing the master.',
      });
    }
    if (moderate.length) {
      add({
        id: 'tone-moderate',
        severity: 'info',
        area: 'tone',
        message: `Moderate tonal differences: ${describe(moderate)} dB.`,
        action: 'Investigate; treat as observations, not automatic corrections.',
      });
    }
    const infra = comparison.bandDeltaDb.infra;
    if (infra !== undefined && infra > t.infraExcessDb) {
      add({
        id: 'infra',
        severity: 'warn',
        area: 'low-end',
        message: `Energy below 30 Hz is +${infra.toFixed(1)} dB over the references.`,
        action: 'Find the source of the rumble. A high-pass is justified only if it solves this observed problem.',
      });
    }

    // -- stereo low end ---------------------------------------------------
    for (const band of ['sub', 'low-bass']) {
      const delta = comparison.sideToMidDeltaDb[band];
      if (delta !== undefined && delta > t.sideLowExcessDb) {
        const own = target.section.bands.find((b) => b.name === band)?.sideToMidDb ?? 0;
        const refValue = reference!.bandSideToMid[band] ?? 0;
        const where =
          refValue <= -59
            ? 'the references are effectively mono there'
            : `the references sit at ${refValue.toFixed(1)} dB`;
        add({
          id: `side-${band}`,
          severity: 'warn',
          area: 'stereo',
          message: `Side energy in ${band} is ${own > 0 ? '+' : ''}${own.toFixed(1)} dB relative to mid; ${where}.`,
          action:
            'Check the bass sources for stereo layers or phase. Sub Guard (M/S side low-cut) only if the problem is measured.',
        });
      }
    }
  }

  if (lowMono < t.lowMonoLossReviewDb) {
    add({
      id: 'bass-mono',
      severity: 'review',
      area: 'stereo',
      message: `Low end (<120 Hz) loses ${Math.abs(lowMono).toFixed(1)} dB in mono (correlation ${target.section.stereo.lowCorrelation}).`,
      action: 'Bass vanishes in mono - correct the bass source; master-level M/S is a last resort.',
    });
  }

  // -- chain state --------------------------------------------------------
  for (const reading of input.chain?.readings ?? []) {
    if (reading.role === 'limiter_gain') {
      if (reading.value > t.limiterGainReviewDb) {
        add({
          id: 'limiter-drive',
          severity: 'review',
          area: 'chain',
          message: `Limiter is driven ${reading.value.toFixed(1)} dB.`,
          action: 'Beyond 4 dB of limiting needs review. Revisit kick/sub/drum peaks instead of more limiter gain.',
        });
      } else if (reading.value > t.limiterGainWarnDb) {
        add({
          id: 'limiter-drive',
          severity: 'warn',
          area: 'chain',
          message: `Limiter is driven ${reading.value.toFixed(1)} dB.`,
          action: 'Above 3 dB, audible side effects deserve scrutiny. A/B against less drive at matched loudness.',
        });
      }
    }
    if (reading.role.startsWith('eq_') && reading.role.endsWith('_gain') && reading.unit === 'dB') {
      const magnitude = Math.abs(reading.value);
      if (magnitude > t.broadEqReviewDb) {
        add({
          id: `eq-${reading.role}`,
          severity: 'review',
          area: 'chain',
          message: `Master EQ ${reading.role} is at ${reading.value.toFixed(1)} dB.`,
          action: 'More than 3 dB of broad master EQ means the mix should probably be revised.',
        });
      } else if (magnitude > t.broadEqWarnDb) {
        add({
          id: `eq-${reading.role}`,
          severity: 'warn',
          area: 'chain',
          message: `Master EQ ${reading.role} is at ${reading.value.toFixed(1)} dB.`,
          action: 'Broad master EQ should normally be subtle; flag the mix.',
        });
      }
    }
    if (reading.role === 'saturator_drive' && reading.value > t.saturationReviewDb) {
      add({
        id: 'saturation',
        severity: 'review',
        area: 'chain',
        message: `Saturator drive is ${reading.value.toFixed(1)} dB.`,
        action: 'Gain-match before judging. Prefer staged peak control over one heavy stage.',
      });
    }
    if (reading.role === 'width' && reading.value > 100) {
      add({
        id: 'width',
        severity: lowMono < t.lowMonoLossReviewDb ? 'review' : 'warn',
        area: 'chain',
        message: `Master width is ${reading.value.toFixed(0)}%.`,
        action: 'Width above 100% needs a positive A/B and a mono-compatibility pass.',
      });
    }
  }

  // -- process: an optimiser chasing its own tail --------------------------
  for (const [role, reversals] of countReversals(input.decisions ?? [])) {
    if (reversals >= t.reversalsBeforeStop) {
      add({
        id: `reversal-${role}`,
        severity: 'review',
        area: 'process',
        message: `${role} has reversed direction ${reversals} times.`,
        action: 'Freeze processing. This usually means a room anomaly or an unstable loop - get independent monitoring evidence.',
      });
    }
  }

  if (silent) findings.splice(0, findings.length, ...findings.filter((f) => f.id === 'silent' || (f.area === 'file' && f.id !== 'silent-channel')));

  const verdict: Verdict = findings.some((f) => f.severity === 'fail')
    ? 'FAIL'
    : findings.some((f) => f.severity === 'review')
      ? 'REVIEW'
      : 'PASS';

  return {
    verdict,
    findings,
    working: {
      source,
      lufsLow: Math.round(lufsLow * 10) / 10,
      lufsHigh: Math.round(lufsHigh * 10) / 10,
      truePeakCeilingDbtp: profile.truePeakCeilingDbtp,
    },
    comparison,
  };
}

function truePeakAction(
  mode: ChainState['limiterTruePeak'] | undefined,
  overshoot: number,
): string {
  // Round the overshoot up to the next 0.1 dB and add 0.1 dB of margin.
  const by = (Math.ceil(overshoot * 10) / 10 + 0.1).toFixed(1);
  switch (mode) {
    case 'unavailable':
      return (
        `This Limiter has no True Peak mode (Live 11). Lower limiter_ceiling by about ${by} dB ` +
        "and re-measure the export; Live 12's Limiter adds the mode."
      );
    case 'off':
      return "Switch the Limiter's True Peak mode on, then re-export and re-measure.";
    case 'on':
      return (
        `True Peak mode is on and still overshoots (dense high-frequency material can). Lower ` +
        `limiter_ceiling by about ${by} dB and re-measure.`
      );
    case 'no-limiter':
      return 'There is no limiter at the end of the Master chain. Add one before anything else.';
    default:
      return `Use true-peak limiting, or lower the ceiling by about ${by} dB and re-measure.`;
  }
}

/**
 * How many times each numeric role's change direction flipped.
 *
 * Option roles (True Peak on/off) have no direction and never count. A preset
 * is a deliberate reset to a known start, so counting restarts after one.
 */
export function countReversals(decisions: Decision[]): Map<string, number> {
  const lastDirection = new Map<string, number>();
  const reversals = new Map<string, number>();
  for (const decision of decisions) {
    if (decision.preset) {
      lastDirection.delete(decision.role);
      reversals.delete(decision.role);
      continue;
    }
    if (typeof decision.before !== 'number' || typeof decision.after !== 'number') continue;
    const direction = Math.sign(decision.after - decision.before);
    if (direction === 0) continue;
    const previous = lastDirection.get(decision.role);
    if (previous !== undefined && previous !== direction) {
      reversals.set(decision.role, (reversals.get(decision.role) ?? 0) + 1);
    }
    lastDirection.set(decision.role, direction);
  }
  return reversals;
}
