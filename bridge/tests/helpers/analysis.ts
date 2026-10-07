/** Synthetic Analysis objects for policy and comparison tests. */

import { BANDS } from '../../../qc/src/dsp.js';
import type { Analysis, BandEnergy } from '../../../qc/src/types.js';

/** A plausible, clean techno master; override pieces per test. */
export function analysis(overrides: {
  lufs?: number;
  tp?: number;
  sp?: number;
  clipped?: number;
  lowMono?: number;
  tilt?: Record<string, number>;
  side?: Record<string, number>;
  bitDepth?: number;
  path?: string;
  /** Brick-wall infra relative to the sub band. */
  infraToSub?: number | null;
  /** Loudest-section loudness; default 0.8 LU above integrated. */
  sectionLufs?: number;
} = {}): Analysis {
  const lufs = overrides.lufs ?? -8;
  const tp = overrides.tp ?? -1.1;
  const bands: BandEnergy[] = BANDS.map((b) => ({
    name: b.name,
    lowHz: b.lowHz,
    highHz: b.highHz,
    midDb: -20,
    sideDb: -40,
    midRelativeDb: overrides.tilt?.[b.name] ?? -10,
    sideToMidDb: overrides.side?.[b.name] ?? -20,
  }));
  const stats = {
    bands,
    stereo: { correlation: 0.8, lowCorrelation: 0.99, monoLossDb: -0.5, lowMonoLossDb: overrides.lowMono ?? 0 },
    integrity: { clippedRuns: overrides.clipped ?? 0, dcOffset: [0, 0] as [number, number], silentChannel: false },
    rmsDb: -12,
    frames: 1,
    infraToSubDb: overrides.infraToSub === undefined ? -25 : overrides.infraToSub,
  };
  return {
    file: {
      path: overrides.path ?? 'master.wav',
      codec: 'pcm_s24le',
      sampleRate: 48000,
      channels: 2,
      bitDepth: overrides.bitDepth ?? 24,
      sampleFormat: 's32',
      durationSeconds: 360,
    },
    loudness: {
      integratedLufs: lufs,
      shortTermMaxLufs: lufs + 1,
      loudnessRangeLu: 5,
      truePeakDbtp: tp,
      samplePeakDbfs: overrides.sp ?? tp - 0.2,
      plrDb: tp - lufs,
    },
    shortTermSeries: [],
    whole: stats,
    section: {
      ...stats,
      range: { startSeconds: 120, durationSeconds: 30, source: 'auto-loudest' },
      shortTermMeanLufs: overrides.sectionLufs ?? lufs + 0.8,
    },
  };
}
