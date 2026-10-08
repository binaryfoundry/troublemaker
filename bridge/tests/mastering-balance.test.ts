import { describe, expect, it } from 'vitest';

import { BALANCE_BANDS, formatBalance, solveBalance, type PartLevels } from '../../agent/src/mastering/balance.js';
import { BANDS } from '../../qc/src/dsp.js';
import type { Analysis } from '../../qc/src/types.js';
import { applyFaderMoves, balanceMix, measureParts, parseFaderDb, partLevels, type LiveClient } from '../src/workflows.js';
import { analysis } from './helpers/analysis.js';

// Five parts with distinct spectra, as a drop's would be (dB per band, mid).
const SPECTRA: Record<string, Record<string, number>> = {
  Kick: { infra: -40, sub: -12, 'low-bass': -14, 'upper-bass': -22, 'low-mid': -30, mid: -34, presence: -38, brilliance: -44, air: -50 },
  Bass: { infra: -45, sub: -14, 'low-bass': -16, 'upper-bass': -20, 'low-mid': -28, mid: -36, presence: -44, brilliance: -52, air: -60 },
  Pad: { infra: -70, sub: -50, 'low-bass': -40, 'upper-bass': -30, 'low-mid': -22, mid: -20, presence: -28, brilliance: -36, air: -44 },
  Lead: { infra: -70, sub: -60, 'low-bass': -50, 'upper-bass': -36, 'low-mid': -28, mid: -20, presence: -22, brilliance: -30, air: -40 },
  Hats: { infra: -80, sub: -70, 'low-bass': -60, 'upper-bass': -50, 'low-mid': -44, mid: -36, presence: -26, brilliance: -20, air: -22 },
};

const sumDb = (dbs: number[]) => 10 * Math.log10(dbs.reduce((s, v) => s + 10 ** (v / 10), 0));

function part(track: string, gain = 0, lufs = -20): PartLevels {
  const bandDb = Object.fromEntries(Object.entries(SPECTRA[track]!).map(([b, v]) => [b, v + gain]));
  return { track, lufs, fullDb: sumDb(Object.values(bandDb)), bandDb };
}

/** The tilt of a mix of the parts with these gains: what references made from it would read. */
function tiltOf(gains: Record<string, number>): Record<string, number> {
  const parts = Object.keys(SPECTRA).map((t) => part(t, gains[t] ?? 0));
  const full = sumDb(parts.map((p) => p.fullDb));
  return Object.fromEntries(BANDS.map((b) => [b.name, sumDb(parts.map((p) => p.bandDb[b.name]!)) - full]));
}

const parts = () => Object.keys(SPECTRA).map((t) => part(t));
const moveOf = (result: ReturnType<typeof solveBalance>, track: string) => result.moves.find((m) => m.track === track)!.db;

describe('solveBalance', () => {
  it('recovers the fader moves that made the reference shape, with the kick held', () => {
    const target = tiltOf({ Bass: -3, Pad: 2, Hats: 4 });
    const result = solveBalance(parts(), target, { costPerDb: 0.001 });
    expect(moveOf(result, 'Kick')).toBe(0);
    expect(moveOf(result, 'Bass')).toBeCloseTo(-3, 0);
    expect(moveOf(result, 'Pad')).toBeCloseTo(2, 0);
    expect(moveOf(result, 'Hats')).toBeCloseTo(4, 0);
    expect(Math.abs(moveOf(result, 'Lead'))).toBeLessThan(0.5);
    expect(result.worstAfterDb).toBeLessThan(0.3);
    expect(result.worstBeforeDb).toBeGreaterThan(2);
  });

  it('holds the kick by name by default, and named anchors when given', () => {
    const target = tiltOf({ Kick: 3, Bass: -2 });
    expect(solveBalance(parts(), target).anchors).toEqual(['Kick']);
    const result = solveBalance(parts(), target, { anchors: ['Kick', 'Bass'] });
    expect(moveOf(result, 'Kick')).toBe(0);
    expect(moveOf(result, 'Bass')).toBe(0);
  });

  it('costs every dB moved: a matched mix gets no moves, a near one small ones', () => {
    expect(solveBalance(parts(), tiltOf({})).moves.every((m) => Math.abs(m.db) < 0.5)).toBe(true);
    const cheap = solveBalance(parts(), tiltOf({ Hats: 4 }), { costPerDb: 0.001 });
    const dear = solveBalance(parts(), tiltOf({ Hats: 4 }), { costPerDb: 1 });
    expect(Math.abs(moveOf(dear, 'Hats'))).toBeLessThan(Math.abs(moveOf(cheap, 'Hats')));
  });

  it('bounds each move and flags a part that needs more than a fader', () => {
    const result = solveBalance(parts(), tiltOf({ Hats: 14 }), { costPerDb: 0.001 });
    const hats = result.moves.find((m) => m.track === 'Hats')!;
    expect(hats.db).toBe(6);
    expect(hats.atLimit).toBe(true);
    expect(formatBalance(result)).toMatch(/Hats.*at the limit: fix the part at its source/);
  });

  it('leaves out parts that are silent in the section, and never solves infra', () => {
    const result = solveBalance([...parts(), { ...part('Hats', 0, -70), track: 'Riser' }], tiltOf({}));
    expect(result.moves.map((m) => m.track)).not.toContain('Riser');
    expect(result.left).toEqual([{ track: 'Riser', reason: expect.stringMatching(/silent/) }]);
    expect(result.bands.map((b) => b.band)).toEqual(BALANCE_BANDS);
  });

  it('is deterministic, so a re-run converges', () => {
    const target = tiltOf({ Bass: -2.5, Lead: 1.5 });
    expect(solveBalance(parts(), target)).toEqual(solveBalance(parts(), target));
  });

  it('never predicts a worse fit than doing nothing', () => {
    const cases: Array<Record<string, number>> = [{ Pad: -6 }, { Lead: 5, Hats: -4 }, { Bass: 6, Pad: 6, Hats: 6 }];
    for (const gains of cases) {
      const result = solveBalance(parts(), tiltOf(gains));
      expect(result.rmsAfterDb).toBeLessThanOrEqual(result.rmsBeforeDb);
    }
  });
});

// ---------------------------------------------------------------------------
// The workflow, against a scripted Live
// ---------------------------------------------------------------------------

/** An Analysis of one part alone, as QC would read its capture. */
function captureOf(track: string, gain = 0, peak = -6): Analysis {
  const p = part(track, gain);
  const a = analysis({ lufs: p.lufs, sp: peak });
  a.whole.bands = a.whole.bands.map((b) => ({ ...b, midDb: p.bandDb[b.name]!, midRelativeDb: p.bandDb[b.name]! - p.fullDb }));
  return a;
}

interface Row {
  track_id: number;
  name: string;
  type: string;
  muted?: boolean;
  soloed?: boolean;
  is_grouped?: boolean;
  volume?: { display_value: string; automation_state: string };
}

function scriptedLive(rows: Row[], options: { failCaptureAt?: number } = {}) {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const solo = new Map(rows.map((r) => [r.track_id, Boolean(r.soloed)]));
  const active = new Map([
    [90, true],
    [91, true],
    [92, false],
  ]);
  let captures = 0;
  const client: LiveClient = {
    async post(command, args = {}) {
      calls.push({ command, args });
      switch (command) {
        case 'live.get_tracks':
          return {
            tracks: rows.map((r) => ({ ...r, soloed: solo.get(r.track_id) })),
            master_track: {
              track_id: 100,
              name: 'Master',
              type: 'master',
              devices: [
                { device_id: 90, class_name: 'Eq8', is_active: active.get(90) },
                { device_id: 91, class_name: 'Limiter', is_active: active.get(91) },
                { device_id: 92, class_name: 'GlueCompressor', is_active: active.get(92) },
              ],
            },
          };
        case 'live.set_track_solo':
          solo.set(args.track_id as number, args.enabled as boolean);
          return {};
        case 'live.set_device_active':
          active.set(args.device_id as number, args.enabled as boolean);
          return {};
        case 'master.capture': {
          captures += 1;
          if (captures === options.failCaptureAt) throw new Error('capture failed');
          const soloed = [...solo].filter(([, on]) => on).map(([id]) => rows.find((r) => r.track_id === id)!.name);
          return { file_path: soloed.length === 1 ? `${soloed[0]}.wav` : 'mix.wav', limiter: active.get(91) };
        }
        case 'live.set_device_parameter_display':
          return { achieved: args.target };
        default:
          throw new Error(`unexpected ${command}`);
      }
    },
  };
  return { client, calls, solo, active };
}

const ROWS: Row[] = [
  { track_id: 1, name: 'Kick', type: 'midi', volume: { display_value: '0.0 dB', automation_state: 'none' } },
  { track_id: 2, name: 'Bass', type: 'midi', soloed: true, volume: { display_value: '-6.0 dB', automation_state: 'none' } },
  { track_id: 3, name: 'Pad', type: 'midi', volume: { display_value: '-10.0 dB', automation_state: 'playing' } },
  { track_id: 4, name: 'Lead', type: 'midi', volume: { display_value: '-4.0 dB', automation_state: 'none' } },
  { track_id: 5, name: 'Hats', type: 'audio', volume: { display_value: '-3.0 dB', automation_state: 'none' } },
  { track_id: 6, name: 'Strings', type: 'midi', muted: true },
  { track_id: 7, name: 'FX', type: 'audio' },
  { track_id: 8, name: 'Riser', type: 'audio', is_grouped: true },
  { track_id: 9, name: 'TM Capture', type: 'audio' },
  { track_id: 10, name: 'Probe', type: 'midi' },
];

/** Each capture read as its part; the grouped Riser sounds like the hats, the verification mix like the kick. */
const analyze = async (path: string) => {
  const name = path.replace('.wav', '');
  return captureOf(name === 'mix' ? 'Kick' : SPECTRA[name] ? name : 'Hats');
};

describe('measureParts', () => {
  it('captures each unmuted part alone with the master dynamics bypassed, then restores everything', async () => {
    const live = scriptedLive(ROWS);
    const seen: Array<{ limiter: unknown }> = [];
    const wrapped: LiveClient = {
      post: async (c, a) => {
        const r = await live.client.post(c, a);
        if (c === 'master.capture') seen.push(r as { limiter: unknown });
        return r;
      },
    };
    const { parts: measured, left } = await measureParts(wrapped, { bars: 8, startBeat: 256 }, analyze);

    expect(measured.map((p) => p.track)).toEqual(['Kick', 'Bass', 'Pad', 'Lead', 'Hats', 'Riser']);
    expect(left).toEqual([
      { track: 'Strings', reason: expect.stringMatching(/muted/) },
      { track: 'FX', reason: expect.stringMatching(/group track/) },
    ]);
    expect(seen.every((s) => s.limiter === false)).toBe(true);
    const captures = live.calls.filter((c) => c.command === 'master.capture');
    expect(captures[0]!.args).toEqual({ bars: 8, start_beat: 256 });
    // Restored: the Limiter back on, the Glue left off, EQ never touched, Bass soloed again.
    expect(live.active.get(91)).toBe(true);
    expect(live.active.get(92)).toBe(false);
    expect(live.calls.some((c) => c.command === 'live.set_device_active' && c.args.device_id === 90)).toBe(false);
    expect([...live.solo].filter(([, on]) => on).map(([id]) => id)).toEqual([2]);
  });

  it('restores solos and the master chain when a capture fails', async () => {
    const live = scriptedLive(ROWS, { failCaptureAt: 2 });
    await expect(measureParts(live.client, { bars: 8 }, analyze)).rejects.toThrow('capture failed');
    expect(live.active.get(91)).toBe(true);
    expect([...live.solo].filter(([, on]) => on).map(([id]) => id)).toEqual([2]);
  });

  it('reads a part as QC reads the references: band levels and the full band they are relative to', () => {
    const levels = partLevels('Pad', captureOf('Pad'));
    expect(levels.fullDb).toBeCloseTo(part('Pad').fullDb, 6);
    expect(levels.bandDb.mid).toBe(SPECTRA.Pad!.mid);
  });
});

describe('applyFaderMoves', () => {
  it('moves faders by dB through their display, skipping automated faders and small moves', async () => {
    const live = scriptedLive(ROWS);
    const { applied, skipped } = await applyFaderMoves(live.client, [
      { trackId: 2, track: 'Bass', db: -2.5 },
      { trackId: 3, track: 'Pad', db: 3 },
      { trackId: 4, track: 'Lead', db: 0.2 },
      { trackId: 5, track: 'Hats', db: 12 },
    ]);
    expect(applied).toEqual([
      { trackId: 2, track: 'Bass', db: -2.5, fromDb: -6, toDb: -8.5, achievedDb: -8.5 },
      { trackId: 5, track: 'Hats', db: 12, fromDb: -3, toDb: 6, achievedDb: 6 },
    ]);
    expect(skipped).toEqual([{ track: 'Pad', reason: expect.stringMatching(/automated.*Utility Gain/) }]);
    const writes = live.calls.filter((c) => c.command === 'live.set_device_parameter_display');
    expect(writes.map((w) => w.args)).toEqual([
      { track_id: 2, mixer: 'volume', target: -8.5 },
      { track_id: 5, mixer: 'volume', target: 6 },
    ]);
  });

  it('parses fader displays', () => {
    expect(parseFaderDb('-6.0 dB')).toBe(-6);
    expect(parseFaderDb('0.0 dB')).toBe(0);
    expect(parseFaderDb('-inf dB')).toBe(-Infinity);
    expect(parseFaderDb(null)).toBeNull();
  });
});

describe('balanceMix', () => {
  // The references' tilt is read from the section, as QC does.
  const referencesFromSection = async () => {
    const tilt = tiltOf({ Lead: 3, Hats: 3 });
    const a = analysis();
    a.section.bands = a.section.bands.map((b) => ({ ...b, midRelativeDb: tilt[b.name]! }));
    return [a];
  };

  it('refuses to solve without references', async () => {
    await expect(balanceMix(scriptedLive(ROWS).client, { bars: 8, references: [] })).rejects.toThrow(/references/);
  });

  it('solves against the references and leaves the faders alone unless asked', async () => {
    const live = scriptedLive(ROWS);
    const report = await balanceMix(live.client, { bars: 8, references: ['ref.wav'] }, { analyze, analyzeReferences: referencesFromSection });
    expect(report.applied).toEqual([]);
    expect(report.verification).toBeNull();
    expect(live.calls.some((c) => c.command === 'live.set_device_parameter_display')).toBe(false);
    expect(report.result.moves.find((m) => m.track === 'Lead')!.db).toBeGreaterThan(1);
    expect(report.text).toMatch(/BALANCE: worst band/);
    expect(report.text).toMatch(/Left out: Strings - muted/);
  });

  it('applies, then captures the mix to measure what the moves did', async () => {
    const live = scriptedLive(ROWS);
    const report = await balanceMix(
      live.client,
      { bars: 8, startBeat: 256, references: ['ref.wav'], apply: true },
      { analyze, analyzeReferences: referencesFromSection },
    );
    expect(report.applied.map((a) => a.track)).toContain('Lead');
    expect(report.skipped.map((s) => s.track)).not.toContain('Kick');
    expect(report.verification?.file).toBe('mix.wav');
    expect(report.text).toMatch(/Measured after: worst band/);
    expect(live.active.get(91)).toBe(true);
  });

  it('flags parts whose capture clipped', async () => {
    const live = scriptedLive(ROWS);
    const clipping = async (path: string) => (path === 'Kick.wav' ? captureOf('Kick', 0, 0) : analyze(path));
    const report = await balanceMix(live.client, { bars: 8, references: ['ref.wav'] }, { analyze: clipping, analyzeReferences: referencesFromSection });
    expect(report.clipped).toEqual(['Kick']);
    expect(report.text).toMatch(/Clipped alone.*Kick/);
  });
});
