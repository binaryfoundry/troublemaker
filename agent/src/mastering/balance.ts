/**
 * Balance solver: the fader moves that bring a mix's tonal shape to the
 * references'.
 *
 * Learned re-mastering Black Glass for the club (docs/lessons.md, 2026-10-08):
 * measure every part alone over the drop, then solve for fader moves instead of
 * reaching for master EQ. One solve took every band from up to 6 dB off the
 * references to within 2. The fix for a club master is mostly in the mix
 * (MIXING.md, NEW_TRACK §2.2), and this is the mix-level move.
 *
 * The model: parts sum in power, band by band. That holds for uncorrelated
 * parts and is wrong where two parts share a phase-locked low end (kick and
 * sub), so a solve is a starting move set to verify by capture, never the
 * answer. The cost is the squared tilt error from sub to air plus a cost per
 * dB moved (minimum effective change); each move is bounded, and the anchors
 * (the kick) never move. Infra is left out: it is cut at its source, not
 * balanced.
 *
 * Pure: numbers in, numbers out. Deterministic, so a re-run converges.
 */

/** The bands a solve matches: QC's bands above infra. */
export const BALANCE_BANDS = ['sub', 'low-bass', 'upper-bass', 'low-mid', 'mid', 'presence', 'brilliance', 'air'];

/** One part measured alone over the section. */
export interface PartLevels {
  track: string;
  /** Integrated loudness of the part alone; near-silent parts are left out. */
  lufs: number;
  /** Full-band mid level, dBFS: the level QC's band tilt is relative to. */
  fullDb: number;
  /** Per band: mid level, dBFS. */
  bandDb: Record<string, number>;
}

export interface BalanceOptions {
  /** Parts that never move. Default: every part named like a kick. */
  anchors?: string[];
  /** Cost per squared dB moved, against squared dB of tilt error. 0.15 solved Black Glass. */
  costPerDb?: number;
  /** Move bounds, dB. A part that needs more has a problem a fader cannot fix. */
  minDb?: number;
  maxDb?: number;
  bands?: string[];
  /** Parts quieter than this alone are not in the section. */
  silentLufs?: number;
}

export interface BandFit {
  band: string;
  /** The references' median tilt (band level relative to full band). */
  referenceDb: number;
  beforeDb: number;
  /** Predicted, by power sum. */
  afterDb: number;
}

export interface BalanceMove {
  track: string;
  db: number;
  anchor: boolean;
  /** The move hit a bound: fix the part itself (sound, EQ at source), not its fader. */
  atLimit: boolean;
}

export interface BalanceResult {
  moves: BalanceMove[];
  bands: BandFit[];
  /** Largest |tilt - reference| over the solved bands. */
  worstBeforeDb: number;
  worstAfterDb: number;
  rmsBeforeDb: number;
  rmsAfterDb: number;
  left: Array<{ track: string; reason: string }>;
  anchors: string[];
}

const KICK = /\bkick\b/i;
const r1 = (v: number) => Math.round(v * 10) / 10;
const power = (db: number) => (Number.isFinite(db) ? 10 ** (db / 10) : 0);

export function solveBalance(
  parts: PartLevels[],
  referenceTilt: Record<string, number>,
  options: BalanceOptions = {},
): BalanceResult {
  const lambda = options.costPerDb ?? 0.15;
  const low = options.minDb ?? -8;
  const high = options.maxDb ?? 6;
  const silent = options.silentLufs ?? -50;
  const bands = (options.bands ?? BALANCE_BANDS).filter((b) => referenceTilt[b] !== undefined);
  if (!bands.length) throw new RangeError('The reference tilt has none of the bands to solve.');

  const left: BalanceResult['left'] = [];
  const active = parts.filter((p) => {
    if (!(p.lufs > silent)) left.push({ track: p.track, reason: `silent in the section (${r1(p.lufs)} LUFS)` });
    return p.lufs > silent;
  });
  if (!active.length) throw new RangeError('No part sounds in the section.');
  const anchorNames = options.anchors ?? active.filter((p) => KICK.test(p.track)).map((p) => p.track);
  const fixed = active.map((p) => anchorNames.includes(p.track));

  const bandPower = active.map((p) => bands.map((b) => power(p.bandDb[b] ?? -Infinity)));
  const fullPower = active.map((p) => power(p.fullDb));

  const tilt = (gains: number[]): number[] => {
    const g = gains.map((x) => 10 ** (x / 10));
    const full = fullPower.reduce((sum, f, i) => sum + f * g[i]!, 0);
    return bands.map((_, k) => 10 * Math.log10(bandPower.reduce((sum, row, i) => sum + row[k]! * g[i]!, 0) / full));
  };
  const target = bands.map((b) => referenceTilt[b]!);
  const cost = (gains: number[]): number => {
    const t = tilt(gains);
    return t.reduce((sum, v, k) => sum + (v - target[k]!) ** 2, 0) + lambda * gains.reduce((sum, x) => sum + x * x, 0);
  };

  // Coordinate descent with a halving step: simple, bounded and deterministic.
  let gains = active.map(() => 0);
  let best = cost(gains);
  for (let step = 2; step > 0.05; ) {
    let improved = false;
    for (let i = 0; i < active.length; i++) {
      if (fixed[i]) continue;
      for (const d of [step, -step]) {
        const trial = [...gains];
        trial[i] = Math.min(high, Math.max(low, trial[i]! + d));
        const c = cost(trial);
        if (c < best - 1e-9) {
          best = c;
          gains = trial;
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
  }

  const before = tilt(active.map(() => 0));
  const after = tilt(gains);
  const fits = bands.map((band, k) => ({ band, referenceDb: target[k]!, beforeDb: r1(before[k]!), afterDb: r1(after[k]!) }));
  const errors = (t: number[]) => t.map((v, k) => v - target[k]!);
  const worst = (e: number[]) => r1(Math.max(...e.map(Math.abs)));
  const rms = (e: number[]) => r1(Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length));
  return {
    moves: active.map((p, i) => ({
      track: p.track,
      db: r1(gains[i]!),
      anchor: fixed[i]!,
      atLimit: !fixed[i] && (gains[i]! <= low + 0.05 || gains[i]! >= high - 0.05),
    })),
    bands: fits,
    worstBeforeDb: worst(errors(before)),
    worstAfterDb: worst(errors(after)),
    rmsBeforeDb: rms(errors(before)),
    rmsAfterDb: rms(errors(after)),
    left,
    anchors: active.filter((_, i) => fixed[i]).map((p) => p.track),
  };
}

/** Moves worth making: at least this many dB. Smaller ones are noise in the measurement. */
export const MIN_MOVE_DB = 0.5;

export function formatBalance(result: BalanceResult, options: { measuredAfter?: Record<string, number> } = {}): string {
  const lines: string[] = [];
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const measured = options.measuredAfter;
  lines.push(`BALANCE: worst band ${result.worstBeforeDb.toFixed(1)} dB off the references -> ${result.worstAfterDb.toFixed(1)} predicted`);
  lines.push(`(rms ${result.rmsBeforeDb.toFixed(1)} -> ${result.rmsAfterDb.toFixed(1)} dB; parts summed in power, so verify by capture)`, '');
  lines.push(`band          ref    now  after${measured ? '  measured' : ''}`);
  for (const b of result.bands) {
    const m = measured?.[b.band];
    lines.push(
      `${b.band.padEnd(11)} ${b.referenceDb.toFixed(1).padStart(6)} ${b.beforeDb.toFixed(1).padStart(6)} ${b.afterDb
        .toFixed(1)
        .padStart(6)}` +
        (measured ? `  ${m === undefined ? '-' : m.toFixed(1).padStart(8)}` : '') +
        `   (${signed(b.beforeDb - b.referenceDb)} -> ${signed(b.afterDb - b.referenceDb)})`,
    );
  }
  lines.push('');
  const moving = result.moves.filter((m) => !m.anchor && Math.abs(m.db) >= MIN_MOVE_DB).sort((a, b) => a.db - b.db);
  if (!moving.length) lines.push('No fader move of 0.5 dB or more improves the fit.');
  for (const m of moving) {
    lines.push(`${m.track.padEnd(24)} ${signed(m.db)} dB${m.atLimit ? '   at the limit: fix the part at its source, not its fader' : ''}`);
  }
  lines.push(`Anchors (not moved): ${result.anchors.length ? result.anchors.join(', ') : 'none - name one with anchors'}`);
  for (const l of result.left) lines.push(`Left out: ${l.track} - ${l.reason}`);
  return lines.join('\n');
}
