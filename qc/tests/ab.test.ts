/**
 * The A/B experiment loop against a scripted bridge client and real files.
 * Skipped without ffmpeg.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareFiles, runAb, type LiveClient } from '../src/ab.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
let dir = '';

function ffmpeg(...args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), 'tm-ab-'));
  execFileSync('bash', [join(__dirname, 'make-fixtures.sh'), dir, '12'], { stdio: 'ignore' });
  // legal: good.wav trimmed under the true-peak ceiling (the fixture limiter
  // only catches sample peaks). quiet: the same master 6 dB further down, so
  // louder-is-better is genuinely earned.
  ffmpeg('-i', join(dir, 'good.wav'), '-af', 'volume=-0.6dB', '-c:a', 'pcm_s24le', join(dir, 'legal.wav'));
  ffmpeg('-i', join(dir, 'good.wav'), '-af', 'volume=-6.6dB', '-c:a', 'pcm_s24le', join(dir, 'quiet.wav'));
  // squashed: driven hard into a limiter, louder but flatter and over the ceiling.
  ffmpeg(
    '-i', join(dir, 'good.wav'),
    '-af', 'volume=8dB,alimiter=limit=0.85:level=false:attack=1:release=20',
    '-c:a', 'pcm_s24le', join(dir, 'squashed.wav'),
  );
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A bridge that hands out pre-rendered captures in order and records calls. */
function client(captures: string[]): LiveClient & { calls: string[] } {
  const queue = [...captures];
  const calls: string[] = [];
  return {
    calls,
    async post(command: string) {
      calls.push(command);
      switch (command) {
        case 'master.checkpoint':
          return { checkpoint_id: 'cp-1' };
        case 'master.capture':
          return { file_path: queue.shift() };
        case 'master.set':
          return { role: 'limiter_gain', display_after: '4.0 dB' };
        case 'master.restore_checkpoint':
          return { restored: 1 };
        default:
          throw new Error(`unexpected ${command}`);
      }
    },
  };
}

describe.skipIf(!hasFfmpeg)('A/B', () => {
  it('writes loudness-matched listening copies', async () => {
    const result = await compareFiles({
      a: join(dir, 'quiet.wav'),
      b: join(dir, 'legal.wav'),
      outDir: join(dir, 'listen'),
    });
    expect(result.comparison.matchGainDb).toBeCloseTo(-6, 0);
    expect(existsSync(result.listening!.a)).toBe(true);
    expect(existsSync(result.listening!.b)).toBe(true);
    expect(result.listening!.b).toMatch(/matched -6\.\d dB/);
  }, 60_000);

  it('keeps a change that wins at matched loudness', async () => {
    const live = client([join(dir, 'quiet.wav'), join(dir, 'legal.wav')]);
    const result = await runAb(live, {
      role: 'limiter_gain',
      value: 4,
      reason: 'raise level towards the window',
      outDir: join(dir, 'ab1'),
    });
    expect(result.kept).toBe('B');
    expect(live.calls).toEqual(['master.checkpoint', 'master.capture', 'master.set', 'master.capture']);
  }, 60_000);

  it('reverts a change that loses at matched loudness', async () => {
    const live = client([join(dir, 'good.wav'), join(dir, 'squashed.wav')]);
    const result = await runAb(live, {
      role: 'limiter_gain',
      value: 6,
      reason: 'more drive',
      outDir: join(dir, 'ab2'),
    });
    expect(result.kept).toBe('A');
    expect(live.calls.at(-1)).toBe('master.restore_checkpoint');
  }, 60_000);

  it('keeps the change regardless when told to', async () => {
    const live = client([join(dir, 'good.wav'), join(dir, 'squashed.wav')]);
    const result = await runAb(live, {
      role: 'limiter_gain',
      value: 6,
      reason: 'user prefers it by ear',
      keepRegardless: true,
      outDir: join(dir, 'ab3'),
    });
    expect(result.kept).toBe('B');
    expect(live.calls).not.toContain('master.restore_checkpoint');
  }, 60_000);

  it('reverts if the second capture fails', async () => {
    const live = client([join(dir, 'good.wav')]);
    const original = live.post.bind(live);
    let captures = 0;
    live.post = async (command: string) => {
      if (command === 'master.capture' && ++captures === 2) {
        live.calls.push(command);
        throw new Error('CAPTURE_FAILED');
      }
      return original(command);
    };
    await expect(
      runAb(live, { role: 'limiter_gain', value: 4, reason: 'x', outDir: join(dir, 'ab4') }),
    ).rejects.toThrow(/CAPTURE_FAILED/);
    expect(live.calls.at(-1)).toBe('master.restore_checkpoint');
  }, 60_000);
});
