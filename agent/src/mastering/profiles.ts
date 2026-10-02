/**
 * Genre and delivery profiles.
 *
 * These are QC *operating envelopes*, not standards: MIXING.md is explicit
 * that no club LUFS target exists. They exist to catch obviously anomalous
 * output when there are no references. With references, the working target
 * is the reference median +/- 1 LU and these loudness bands are ignored.
 */

export interface MasteringProfile {
  name: string;
  description: string;
  /** Integrated loudness envelope used only without references. */
  lufsRange: [number, number];
  /** Maximum allowed true peak for the deliverable. */
  truePeakCeilingDbtp: number;
  /**
   * Lowest peak-to-loudness ratio before a master counts as over-limited,
   * used only without references. A heuristic floor, not a standard.
   */
  minPlrDb: number;
}

export const PROFILES: Record<string, MasteringProfile> = {
  deep: {
    name: 'deep',
    description: 'Dynamic / deep electronic. Preserve depth; do not densify to match louder records.',
    lufsRange: [-11, -8],
    truePeakCeilingDbtp: -1,
    minPlrDb: 9,
  },
  house: {
    name: 'house',
    description: 'House. Kick/bass groove first; calibrate to the subgenre reference set.',
    lufsRange: [-9, -6.5],
    truePeakCeilingDbtp: -1,
    minPlrDb: 7.5,
  },
  techno: {
    name: 'techno',
    description: 'Techno. Density varies enormously; reference matching is essential.',
    lufsRange: [-9, -6],
    truePeakCeilingDbtp: -1,
    minPlrDb: 7,
  },
  dnb: {
    name: 'dnb',
    description: 'Drum & bass / bass music. Loud masters possible; reject drum or sub collapse.',
    lufsRange: [-8, -5.5],
    truePeakCeilingDbtp: -1,
    minPlrDb: 6,
  },
  'club-pcm': {
    name: 'club-pcm',
    description:
      'Dedicated unencoded club PCM. Ceiling may sit at -0.5 dBTP, but only with a reason.',
    lufsRange: [-9, -6],
    truePeakCeilingDbtp: -0.5,
    minPlrDb: 7,
  },
  distribution: {
    name: 'distribution',
    description:
      'Distribution master for encoding. No loudness target - platform normalisation is ' +
      'playback policy - but keep <= -1 dBTP.',
    lufsRange: [-14, -5.5],
    truePeakCeilingDbtp: -1,
    minPlrDb: 7,
  },
};

export function getProfile(name: string): MasteringProfile {
  const profile = PROFILES[name];
  if (!profile) {
    throw new RangeError(
      `Unknown mastering profile '${name}'. Known: ${Object.keys(PROFILES).join(', ')}.`,
    );
  }
  return profile;
}

/**
 * Engineering policies from MIXING.md. Not standards - the 3-4 dB limiting
 * caution follows Ian Shepherd's practical guidance.
 */
export const THRESHOLDS = {
  referenceWindowLu: 1,
  limiterGainWarnDb: 3,
  limiterGainReviewDb: 4,
  broadEqWarnDb: 2,
  broadEqReviewDb: 3,
  saturationReviewDb: 2.5,
  glueRangeWarnDb: 2,
  bandDeviationNoteDb: 1.5,
  bandDeviationReviewDb: 3,
  sideLowExcessDb: 6,
  infraExcessDb: 4,
  lowMonoLossReviewDb: -1.5,
  plrBelowReferenceDb: 2,
  dcWarn: 0.001,
  /** Reversing one control's direction this many times stops the loop. */
  reversalsBeforeStop: 2,
  /** References more than this far apart (LU) disagree materially. */
  referenceSpreadLu: 4,
  /** A/B: smallest PLR change worth reporting. */
  abPlrNoticeDb: 1,
  /** A/B: most PLR a louder version may cost while still below the window. */
  abPlrTolerableDb: 3,
  abMonoNoticeDb: 0.5,
  abTonalNoticeDb: 0.5,
  /** A/B: tonal shift from a dynamics change large enough to count against it. */
  abTonalSideEffectDb: 1.5,
} as const;
