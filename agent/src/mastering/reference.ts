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
  plrDb: number;
  /** Per band: median mid level relative to full band. */
  bandTilt: Record<string, number>;
  /** Per band: median side-minus-mid. */
  bandSideToMid: Record<string, number>;
  lowMonoLossDb: number;
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
    plrDb: r2(median(references.map((r) => r.loudness.plrDb))),
    bandTilt,
    bandSideToMid,
    lowMonoLossDb: r2(median(references.map((r) => r.section.stereo.lowMonoLossDb))),
    spreadLu: r2(Math.max(...integrated) - Math.min(...integrated)),
  };
}

export interface ReferenceComparison {
  integratedDeltaLu: number;
  sectionDeltaLu: number;
  plrDeltaDb: number;
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
    plrDeltaDb: r2(target.loudness.plrDb - profile.plrDb),
    bandDeltaDb,
    sideToMidDeltaDb,
  };
}
