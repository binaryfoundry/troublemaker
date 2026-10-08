/**
 * One QC job: analyse a target and its references, evaluate against the
 * mastering policy, and produce the report.
 *
 * Reference analyses are cached by path, size and modification time - the
 * same 3-5 references get re-used across every iteration of a mastering
 * session, and each one costs several seconds to analyse.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { analyzeFile, type AnalyzeOptions } from './analyze.js';
import type { Analysis } from './types.js';
import { buildReferenceProfile, type ReferenceProfile } from '../../agent/src/mastering/reference.js';
import { evaluate, type ChainState, type Decision, type Evaluation } from '../../agent/src/mastering/policy.js';
import { getProfile } from '../../agent/src/mastering/profiles.js';
import { formatReport } from '../../agent/src/mastering/report.js';

/** Bump when analysis output changes shape, so stale cache entries are ignored. */
// 3: brick-wall infra (infraToSubDb).
const CACHE_VERSION = 3;

export interface QcJob {
  target: string;
  references?: string[];
  profile?: string;
  section?: { start: number; duration: number };
  sectionSeconds?: number;
  delivery?: { sampleRate?: number; bitDepth?: number };
  chain?: ChainState;
  decisions?: Decision[];
  cacheDir?: string;
}

export interface QcResult {
  analysis: Analysis;
  reference: ReferenceProfile | null;
  evaluation: Evaluation;
  report: string;
}

export async function runQc(job: QcJob): Promise<QcResult> {
  const profile = getProfile(job.profile ?? 'techno');
  const options: AnalyzeOptions = { section: job.section, sectionSeconds: job.sectionSeconds };
  const cacheDir = job.cacheDir ?? defaultCacheDir();

  // The target is never cached: it is the thing being changed.
  const analysis = await analyzeFile(resolve(job.target), options);

  // A section given in seconds belongs to the target; each reference is
  // measured on its own loudest stretch. Applying the target's times to the
  // references compared a drop with their intros.
  const referenceOptions: AnalyzeOptions = { sectionSeconds: job.sectionSeconds };
  const references: Analysis[] = [];
  for (const path of job.references ?? []) {
    references.push(await cachedAnalysis(resolve(path), referenceOptions, cacheDir));
  }
  const reference = references.length ? buildReferenceProfile(references) : null;

  const evaluation = evaluate({
    target: analysis,
    profile,
    reference: reference ?? undefined,
    chain: job.chain,
    decisions: job.decisions,
    delivery: job.delivery,
  });

  return {
    analysis,
    reference,
    evaluation,
    report: formatReport(analysis, evaluation, {
      profileName: profile.name,
      reference: reference ?? undefined,
    }),
  };
}

function defaultCacheDir(): string {
  return join(process.env.TROUBLEMAKER_DATA_DIR ?? '.troublemaker', 'qc-cache');
}

/** Analyse references as runQc does: each on its own loudest stretch, through the cache. */
export async function analyzeReferences(paths: string[], cacheDir = defaultCacheDir()): Promise<Analysis[]> {
  const analyses: Analysis[] = [];
  for (const path of paths) analyses.push(await cachedAnalysis(resolve(path), {}, cacheDir));
  return analyses;
}

async function cachedAnalysis(path: string, options: AnalyzeOptions, cacheDir: string): Promise<Analysis> {
  const stat = statSync(path);
  const key = createHash('sha1')
    .update(JSON.stringify([CACHE_VERSION, path, stat.size, stat.mtimeMs, options]))
    .digest('hex');
  const file = join(cacheDir, `${key}.json`);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Analysis;
    } catch {
      // Corrupt cache entry; fall through and re-analyse.
    }
  }
  const analysis = await analyzeFile(path, options);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(analysis), 'utf8');
  return analysis;
}
