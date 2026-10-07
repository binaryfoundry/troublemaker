/**
 * Reference profiles: the median of 3-5 comparable masters.
 *
 * A median rather than a mean, so one reference with an unusual tonal choice
 * cannot drag the target. Spectral comparison uses each file's band levels
 * *relative to its own full-band level*, which makes the comparison
 * loudness-independent - the equivalent of level-matching before listening.
 */

import type { Analysis } from '../../../qc/src/types.js';

export interface ReferenceProfile {
  count: number;
  files: string[];
  integratedLufs: number;
  sectionLufs: number;
  truePeakDbtp: number;
  /**
   * Median true peak of the lossless references only, or null if there are
   * none: an MP3's decoded overs are artefacts of the codec, not the master.
   */
  losslessTruePeakDbtp: number | null;
  plrDb: number;
  /**
   * Median true peak minus loudest-section loudness: the drop's density.
   * Whole-track PLR includes the intros, so it cannot be compared with a
   * 30 s capture of a drop (the drops of five Prydz tracks ran ~7 dB against
   * a whole-track 10).
   */
  sectionPlrDb: number;
  /** Per band: median mid level relative to full band. */
  bandTilt: Record<string, number>;
  /** Per band: median side-minus-mid. */
  bandSideToMid: Record<string, number>;
  lowMonoLossDb: number;
  /** Median energy below 30 Hz relative to 30-60 Hz (brick-wall), or null. */
  infraToSubDb: number | null;
  /** Max minus min integrated loudness across references. */
  spreadLu: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lossy codecs, whose decoded peaks are not the master's. */
const LOSSY = /^(mp3|mp2|aac|vorbis|opus|wma)/i;

export function buildReferenceProfile(references: Analysis[]): ReferenceProfile {
  if (references.length === 0) throw new RangeError('A reference profile needs at least one file.');
  const bandNames = references[0]!.section.bands.map((b) => b.name);
  const bandTilt: Record<string, number> = {};
  const bandSideToMid: Record<string, number> = {};
  for (const name of bandNames) {
    const bands = references.map((r) => r.section.bands.find((b) => b.name === name)!);
    bandTilt[name] = r2(median(bands.map((b) => b.midRelativeDb)));
    bandSideToMid[name] = r2(median(bands.map((b) => b.sideToMidDb)));
  }
  const integrated = references.map((r) => r.loudness.integratedLufs);
  return {
    count: references.length,
    files: references.map((r) => r.file.path),
    integratedLufs: r2(median(integrated)),
    sectionLufs: r2(median(references.map((r) => r.section.shortTermMeanLufs))),
    truePeakDbtp: r2(median(references.map((r) => r.loudness.truePeakDbtp))),
    losslessTruePeakDbtp: (() => {
      const lossless = references.filter((r) => !LOSSY.test(r.file.codec));
      return lossless.length ? r2(median(lossless.map((r) => r.loudness.truePeakDbtp))) : null;
    })(),
    plrDb: r2(median(references.map((r) => r.loudness.plrDb))),
    sectionPlrDb: r2(median(references.map((r) => r.loudness.truePeakDbtp - r.section.shortTermMeanLufs))),
    bandTilt,
    bandSideToMid,
    lowMonoLossDb: r2(median(references.map((r) => r.section.stereo.lowMonoLossDb))),
    infraToSubDb: (() => {
      const values = references.map((r) => r.section.infraToSubDb).filter((v): v is number => typeof v === 'number');
      return values.length ? r2(median(values)) : null;
    })(),
    spreadLu: r2(Math.max(...integrated) - Math.min(...integrated)),
  };
}

export interface ReferenceComparison {
  integratedDeltaLu: number;
  sectionDeltaLu: number;
  /** Loudest-section PLR (true peak minus section loudness), target minus references. */
  plrDeltaDb: number;
  /** Brick-wall infra against the references' (target minus reference), or null. */
  infraToSubDeltaDb: number | null;
  /** Target tilt minus reference tilt, per band. Positive means the target has more. */
  bandDeltaDb: Record<string, number>;
  sideToMidDeltaDb: Record<string, number>;
}

export function compareToReference(
  target: Analysis,
  profile: ReferenceProfile,
): ReferenceComparison {
  const bandDeltaDb: Record<string, number> = {};
  const sideToMidDeltaDb: Record<string, number> = {};
  for (const band of target.section.bands) {
    const refTilt = profile.bandTilt[band.name];
    const refSide = profile.bandSideToMid[band.name];
    if (refTilt !== undefined) bandDeltaDb[band.name] = r2(band.midRelativeDb - refTilt);
    if (refSide !== undefined) sideToMidDeltaDb[band.name] = r2(band.sideToMidDb - refSide);
  }
  return {
    integratedDeltaLu: r2(target.loudness.integratedLufs - profile.integratedLufs),
    sectionDeltaLu: r2(target.section.shortTermMeanLufs - profile.sectionLufs),
    plrDeltaDb: r2(target.loudness.truePeakDbtp - target.section.shortTermMeanLufs - profile.sectionPlrDb),
    infraToSubDeltaDb:
      typeof target.section.infraToSubDb === 'number' && profile.infraToSubDb !== null
        ? r2(target.section.infraToSubDb - profile.infraToSubDb)
        : null,
    bandDeltaDb,
    sideToMidDeltaDb,
  };
}
