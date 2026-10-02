/**
 * End-to-end QC against real files rendered by ffmpeg.
 *
 * Skipped when ffmpeg is not installed, so `npm test` still runs anywhere.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runQc } from '../src/run.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
let dir = '';

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), 'tm-qc-'));
  execFileSync('bash', [join(__dirname, 'make-fixtures.sh'), dir, '12'], { stdio: 'ignore' });
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const refs = () => ['ref1', 'ref2', 'ref3'].map((n) => join(dir, `${n}.wav`));

describe.skipIf(!hasFfmpeg)('QC on rendered files', () => {
  it('passes the tonal and loudness comparison for a master that matches its references', async () => {
    const result = await runQc({
      target: join(dir, 'good.wav'),
      references: refs(),
      cacheDir: join(dir, 'cache'),
    });
    const loudness = result.evaluation.findings.find((f) => f.area === 'loudness')!;
    expect(loudness.id).toBe('loudness-ok');
    expect(result.evaluation.findings.some((f) => f.area === 'tone' && f.severity === 'review')).toBe(false);
    expect(result.evaluation.findings.some((f) => f.area === 'stereo')).toBe(false);
  }, 60_000);

  it('catches inter-sample overs that a sample-peak limiter lets through', async () => {
    const result = await runQc({ target: join(dir, 'good.wav'), cacheDir: join(dir, 'cache') });
    expect(result.analysis.loudness.samplePeakDbfs).toBeLessThanOrEqual(-1);
    expect(result.analysis.loudness.truePeakDbtp).toBeGreaterThan(-1);
    expect(result.evaluation.verdict).toBe('FAIL');
    expect(result.evaluation.findings.find((f) => f.id === 'true-peak')!.message).toMatch(/inter-sample/);
  }, 60_000);

  it('fails the broken master on every count it is broken on', async () => {
    const result = await runQc({
      target: join(dir, 'bad.wav'),
      references: refs(),
      delivery: { sampleRate: 48000, bitDepth: 24 },
      cacheDir: join(dir, 'cache'),
    });
    const ids = result.evaluation.findings.map((f) => f.id);
    expect(result.evaluation.verdict).toBe('FAIL');
    for (const expected of ['bit-depth', 'true-peak', 'clipping', 'bass-mono', 'too-loud', 'tone-large']) {
      expect(ids, `missing ${expected}`).toContain(expected);
    }
    expect(result.report).toMatch(/^MASTER RESULT: FAIL/);
  }, 60_000);

  it('uses the reference median as the loudness target', async () => {
    const result = await runQc({
      target: join(dir, 'good.wav'),
      references: refs(),
      cacheDir: join(dir, 'cache'),
    });
    expect(result.evaluation.working.source).toBe('references');
    expect(result.evaluation.working.lufsHigh - result.evaluation.working.lufsLow).toBeCloseTo(2, 5);
  }, 60_000);
});
