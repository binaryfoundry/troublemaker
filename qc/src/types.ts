/**
 * Measurement types for offline audio QC.
 *
 * Everything here describes an exported file. The Live API exposes only coarse
 * peak meters, so loudness, true peak, spectrum and stereo measurements are
 * taken from the rendered artefact - which is the thing that ships anyway.
 */

export interface FileInfo {
  path: string;
  codec: string;
  sampleRate: number;
  channels: number;
  /** Null when the container does not report one (e.g. float formats). */
  bitDepth: number | null;
  sampleFormat: string;
  durationSeconds: number;
}

export interface LoudnessStats {
  /** ITU-R BS.1770 integrated loudness. */
  integratedLufs: number;
  /** Highest 3-second short-term loudness. */
  shortTermMaxLufs: number;
  loudnessRangeLu: number;
  truePeakDbtp: number;
  samplePeakDbfs: number;
  /** True peak minus integrated loudness. Low values suggest heavy limiting. */
  plrDb: number;
}

export interface BandEnergy {
  name: string;
  lowHz: number;
  highHz: number;
  /** RMS of the mid (L+R)/2 signal in this band, dBFS. */
  midDb: number;
  /** RMS of the side (L-R)/2 signal in this band, dBFS. */
  sideDb: number;
  /** Mid band level relative to the full-band mid level - a loudness-independent tilt. */
  midRelativeDb: number;
  /** Side minus mid in this band. Higher means wider; near 0 means as much side as mid. */
  sideToMidDb: number;
}

export interface StereoStats {
  /** Full-band L/R correlation, -1..1. */
  correlation: number;
  /** L/R correlation below 120 Hz. */
  lowCorrelation: number;
  /** Level change when summed to mono, dB. 0 is fully mono-safe; very negative means cancellation. */
  monoLossDb: number;
  /** Mono loss below 120 Hz - the "bass vanishes in mono" check. */
  lowMonoLossDb: number;
}

export interface IntegrityStats {
  /** Runs of 3+ consecutive samples at or near full scale. */
  clippedRuns: number;
  dcOffset: [number, number];
  /** True when a channel is effectively silent. */
  silentChannel: boolean;
}

export interface SignalStats {
  bands: BandEnergy[];
  stereo: StereoStats;
  integrity: IntegrityStats;
  rmsDb: number;
  frames: number;
  /** Energy below 30 Hz relative to 30-60 Hz, by brick-wall FFT; null if too short or no sub. */
  infraToSubDb: number | null;
}

export interface Section {
  startSeconds: number;
  durationSeconds: number;
  /** How the section was chosen. */
  source: 'auto-loudest' | 'user' | 'whole';
}

export interface Analysis {
  file: FileInfo;
  loudness: LoudnessStats;
  /** Short-term loudness every 100 ms. */
  shortTermSeries: number[];
  /** Spectrum and stereo measured over the whole file. */
  whole: SignalStats;
  /** Spectrum and stereo over the comparable section (the loudest part by default). */
  section: SignalStats & { range: Section; shortTermMeanLufs: number };
}
