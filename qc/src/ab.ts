/**
 * A/B jobs: compare two files at matched loudness, or run a full
 * "try a change, keep it only if it wins" experiment against Live.
 *
 * MIXING.md: "The agent then performs the smallest reasonable intervention,
 * renders or measures it, compares the result with the unprocessed version at
 * equal perceived loudness, and retains the intervention only if the evidence
 * supports it." runAb is exactly that loop.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { analyzeFile } from './analyze.js';
import { QcError } from './ffmpeg.js';
import type { Analysis } from './types.js';
import {
  compareVersions,
  intentForRole,
  type ChangeIntent,
  type Comparison,
} from '../../agent/src/mastering/compare.js';
import { getProfile } from '../../agent/src/mastering/profiles.js';
import { buildReferenceProfile, type ReferenceProfile } from '../../agent/src/mastering/reference.js';
import { formatComparison } from '../../agent/src/mastering/report.js';

const FFMPEG = process.env.TROUBLEMAKER_FFMPEG ?? 'ffmpeg';

export interface CompareJob {
  a: string;
  b: string;
  references?: string[];
  profile?: string;
  /** Where to write the loudness-matched listening copies. Omit to skip. */
  outDir?: string;
  labels?: { a: string; b: string };
  intent?: ChangeIntent;
}

export interface CompareResult {
  comparison: Comparison;
  report: string;
  listening: { a: string; b: string } | null;
  analyses: { a: Analysis; b: Analysis };
}

export async function compareFiles(job: CompareJob): Promise<CompareResult> {
  const profile = getProfile(job.profile ?? 'techno');
  const a = await analyzeFile(resolve(job.a));
  const b = await analyzeFile(resolve(job.b));
  let reference: ReferenceProfile | undefined;
  if (job.references?.length) {
    const refs: Analysis[] = [];
    for (const path of job.references) refs.push(await analyzeFile(resolve(path)));
    reference = buildReferenceProfile(refs);
  }
  const comparison = compareVersions({ a, b, profile, reference, intent: job.intent });

  let listening: CompareResult['listening'] = null;
  if (job.outDir) {
    mkdirSync(job.outDir, { recursive: true });
    const aOut = join(job.outDir, `A - ${basename(job.a)}`);
    const bOut = join(job.outDir, `B matched ${signed(comparison.matchGainDb)} dB - ${basename(job.b)}`);
    copyFileSync(job.a, aOut);
    await writeGainAdjusted(job.b, bOut, comparison.matchGainDb);
    listening = { a: aOut, b: bOut };
  }

  return {
    comparison,
    report: formatComparison(comparison, { labels: job.labels, listening }),
    listening,
    analyses: { a, b },
  };
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/**
 * Write B with a fixed gain so it plays at A's loudness. 32-bit float output,
 * so a positive gain can never clip the listening copy.
 */
export function writeGainAdjusted(input: string, output: string, gainDb: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-af', `volume=${gainDb}dB`, '-c:a', 'pcm_f32le', output],
      { windowsHide: true },
    );
    const err: Buffer[] = [];
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new QcError('DECODE_FAILED', `ffmpeg could not write ${output}: ${Buffer.concat(err).toString().trim()}`)),
    );
  });
}

// ---------------------------------------------------------------------------
// A full experiment against Live
// ---------------------------------------------------------------------------

export interface LiveClient {
  post(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface AbJob {
  role: string;
  value: number | string;
  reason: string;
  bars?: number;
  scene_id?: number;
  references?: string[];
  profile?: string;
  outDir?: string;
  /** Keep B even when A wins. For when the user has decided by ear. */
  keepRegardless?: boolean;
  mix_repair?: boolean;
  allow_widen?: boolean;
}

export interface AbResult extends CompareResult {
  kept: 'A' | 'B';
  change: Record<string, unknown>;
  captures: { a: string; b: string };
  checkpoint_id: string;
}

export async function runAb(client: LiveClient, job: AbJob, log: (line: string) => void = () => {}): Promise<AbResult> {
  const captureArgs: Record<string, unknown> = { bars: job.bars ?? 16 };
  if (job.scene_id !== undefined) captureArgs.scene_id = job.scene_id;

  const checkpoint = (await client.post('master.checkpoint', { label: `ab: before ${job.role}` })) as {
    checkpoint_id: string;
  };

  log(`Capturing A (current chain)...`);
  const a = (await client.post('master.capture', captureArgs)) as { file_path: string };

  log(`Applying ${job.role} = ${job.value}...`);
  // If this is refused (safe range, reversal stop), nothing changed: no revert needed.
  const change = (await client.post('master.set', {
    role: job.role,
    value: job.value,
    reason: `A/B trial: ${job.reason}`,
    ...(job.mix_repair ? { mix_repair: true } : {}),
    ...(job.allow_widen ? { allow_widen: true } : {}),
  })) as Record<string, unknown>;

  let b: { file_path: string };
  try {
    log(`Capturing B (with the change)...`);
    b = (await client.post('master.capture', captureArgs)) as { file_path: string };
  } catch (error) {
    await client.post('master.restore_checkpoint', { checkpoint_id: checkpoint.checkpoint_id });
    throw error;
  }

  const outDir = job.outDir ?? join(process.env.TROUBLEMAKER_DATA_DIR ?? '.troublemaker', 'ab', stamp());
  const result = await compareFiles({
    a: a.file_path,
    b: b.file_path,
    references: job.references,
    profile: job.profile,
    outDir,
    labels: { a: 'A (before)', b: `B (${job.role} = ${job.value})` },
    intent: intentForRole(job.role),
  });

  let kept: 'A' | 'B' = result.comparison.preferred;
  if (job.keepRegardless) kept = 'B';
  if (kept === 'A') {
    log('A wins - reverting the change.');
    await client.post('master.restore_checkpoint', { checkpoint_id: checkpoint.checkpoint_id });
  } else {
    log(result.comparison.preferred === 'B' ? 'B wins - keeping the change.' : 'Keeping B as instructed.');
  }

  return {
    ...result,
    kept,
    change,
    captures: { a: a.file_path, b: b.file_path },
    checkpoint_id: checkpoint.checkpoint_id,
  };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
