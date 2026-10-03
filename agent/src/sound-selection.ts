/**
 * Sound selection (Ableton_Sound_Selection_Expert.md): turn a role and a
 * genre into a sound brief - what to keep, what to reject, what to judge -
 * and rank browser candidates into a short list to audition in context.
 *
 * Names are a proxy: a character word in a file name is a hint, not proof,
 * so the shortlist is where listening starts, never where it ends.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface RoleSpec {
  categories: string[];
  words: string[];
  evaluate: string[];
  pair: string;
}

interface GenreSpec {
  keep: string[];
  reject: string[];
  heuristics: string[];
}

interface SelectionKnowledge {
  priority: string[];
  roles: Record<string, RoleSpec>;
  genres: Record<string, GenreSpec>;
  dimensions: string[];
  shortlist: [number, number];
}

const PATH = fileURLToPath(new URL('../knowledge/sound-selection.json', import.meta.url));
let cached: SelectionKnowledge | null = null;

export function selectionKnowledge(): SelectionKnowledge {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as SelectionKnowledge;
  return cached;
}

export interface SoundBrief {
  role: string;
  genre: string | null;
  /** Browser searches to run, as [category, query]. */
  searches: Array<[string, string]>;
  keep: string[];
  reject: string[];
  /** The words asked for explicitly; they outweigh the genre's defaults. */
  character: string[];
  evaluate: string[];
  pair: string;
  heuristics: string[];
  /** One sentence, the way the document asks a brief to be written. */
  need: string;
}

export function soundBrief(role: string, options: { genre?: string; character?: string[]; avoid?: string[] } = {}): SoundBrief {
  const k = selectionKnowledge();
  const spec = k.roles[role];
  if (!spec) throw new RangeError(`Unknown role '${role}'. Known: ${Object.keys(k.roles).join(', ')}.`);
  const genre = options.genre ? k.genres[options.genre] : undefined;
  if (options.genre && !genre) throw new RangeError(`Unknown genre '${options.genre}'. Known: ${Object.keys(k.genres).join(', ')}.`);
  const keep = [...new Set([...(options.character ?? []), ...(genre?.keep ?? [])].map((w) => w.toLowerCase()))];
  const reject = [...new Set([...(options.avoid ?? []), ...(genre?.reject ?? [])].map((w) => w.toLowerCase()))].filter((w) => !keep.includes(w));
  // Search on the role word; character words rank the results afterwards.
  const searches: Array<[string, string]> = [];
  for (const category of spec.categories) for (const word of spec.words.slice(0, 3)) searches.push([category, word]);
  const character = (options.character ?? []).join(', ');
  return {
    role,
    genre: options.genre ?? null,
    searches,
    keep,
    reject,
    character: (options.character ?? []).map((w) => w.toLowerCase()),
    evaluate: spec.evaluate,
    pair: spec.pair,
    heuristics: genre?.heuristics ?? [],
    need: `A ${character ? `${character} ` : ''}${role}${options.genre ? ` for ${options.genre.replace(/_/g, ' ')}` : ''}, judged on ${spec.evaluate.slice(0, 3).join(', ')}.`,
  };
}

export interface Candidate {
  name: string;
  category: string;
  path: string[];
}

export interface RankedCandidate extends Candidate {
  score: number;
  why: string[];
}

const words = (text: string) => text.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9#]+/).filter(Boolean);

/**
 * Score candidates on their names against the brief and keep a short list
 * (3-8), at most two from the same folder so the audition compares
 * genuinely different sounds.
 */
export function rankCandidates(candidates: Candidate[], brief: SoundBrief, limit = selectionKnowledge().shortlist[1]): RankedCandidate[] {
  const roleWords = selectionKnowledge().roles[brief.role]!.words.flatMap(words);
  const seen = new Set<string>();
  const ranked = candidates
    .filter((c) => {
      const key = `${c.category}:${c.path.join('/')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => {
      const name = words(c.name);
      const why: string[] = [];
      let score = 0;
      if (name.some((w) => roleWords.includes(w))) {
        score += 1;
        why.push(`names its role`);
      }
      for (const w of brief.keep) if (name.includes(w)) { score += 2; why.push(`+${w}`); }
      for (const w of brief.reject) if (name.includes(w)) { score -= 3; why.push(`-${w}`); }
      return { ...c, score, why };
    })
    .filter((c) => c.score > -1)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  const perFolder = new Map<string, number>();
  const out: RankedCandidate[] = [];
  for (const c of ranked) {
    const folder = `${c.category}:${c.path.slice(0, -1).join('/')}`;
    if ((perFolder.get(folder) ?? 0) >= 2) continue;
    perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measured local samples
// ---------------------------------------------------------------------------

/** The measurements a sample index carries (see qc/src/samples.ts). */
export interface MeasuredSample {
  path: string;
  relative: string;
  name: string;
  role: string;
  kind: string | null;
  loop: boolean;
  key: string | null;
  bpm: number | null;
  attackMs: number;
  tailMs: number;
  subDb: number;
  brightDb: number;
  centroidHz: number;
  widthDb: number;
  pitchHz: number | null;
  note: string | null;
}

type Metric = 'tailMs' | 'attackMs' | 'subDb' | 'brightDb' | 'centroidHz' | 'widthDb';

/** Character words the measurements can speak to: metric and direction (+1 more, -1 less). */
const MEASURABLE: Record<string, Array<[Metric, number]>> = {
  short: [['tailMs', -1]],
  tight: [['tailMs', -1]],
  long: [['tailMs', 1]],
  boomy: [['tailMs', 1], ['subDb', 1]],
  sustained: [['tailMs', 1]],
  punchy: [['attackMs', -1], ['brightDb', 1]],
  hard: [['attackMs', -1], ['brightDb', 1]],
  click: [['brightDb', 1]],
  crisp: [['brightDb', 1], ['attackMs', -1]],
  snappy: [['attackMs', -1], ['tailMs', -1]],
  soft: [['attackMs', 1], ['brightDb', -1]],
  round: [['brightDb', -1]],
  smooth: [['brightDb', -1]],
  deep: [['subDb', 1], ['centroidHz', -1]],
  sub: [['subDb', 1]],
  weight: [['subDb', 1]],
  heavy: [['subDb', 1]],
  dark: [['centroidHz', -1], ['brightDb', -1]],
  warm: [['centroidHz', -1], ['brightDb', -1]],
  bright: [['centroidHz', 1], ['brightDb', 1]],
  airy: [['centroidHz', 1]],
  wide: [['widthDb', 1]],
  narrow: [['widthDb', -1]],
  mono: [['widthDb', -1]],
  centred: [['widthDb', -1]],
};

const NOTE_PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Semitones (-6..+5) that move a sample's key or pitch onto the track's root. */
export function transposeToKey(sampleKeyOrNote: string | null, root: string): number | null {
  if (!sampleKeyOrNote) return null;
  const m = /^([A-G](?:#|b)?)/.exec(sampleKeyOrNote);
  if (!m || NOTE_PC[root] === undefined) return null;
  const up = (NOTE_PC[root]! - NOTE_PC[m[1]!]! + 12) % 12;
  return up > 5 ? up - 12 : up;
}

export interface RankedSample extends MeasuredSample {
  score: number;
  why: string[];
  /** Semitones to put it in the track's key, for tonal samples. */
  transpose: number | null;
  /** Path for live.load_browser_item once the library folder is a Place in Live's browser. */
  browserPath: string[];
}

/**
 * Rank measured samples of the brief's role. Each measurable character word
 * pulls its metric up or down (z-scored within the role, so "short" means
 * short for a kick); name matches only break ties.
 */
export function rankSamples(
  samples: MeasuredSample[],
  brief: SoundBrief,
  options: { limit?: number; root?: string; libraryName?: string; loops?: boolean } = {},
): RankedSample[] {
  const pool = samples.filter((s) => s.role === brief.role && (options.loops ?? false) === s.loop);
  if (!pool.length) return [];
  const metrics: Metric[] = ['tailMs', 'attackMs', 'subDb', 'brightDb', 'centroidHz', 'widthDb'];
  const stats = Object.fromEntries(metrics.map((m) => {
    const xs = pool.map((s) => s[m]);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
    return [m, { mean, sd }];
  })) as Record<Metric, { mean: number; sd: number }>;
  // Capped, so one extreme measurement cannot outweigh every other word.
  const z = (s: MeasuredSample, m: Metric) => Math.max(-2.5, Math.min(2.5, (s[m] - stats[m].mean) / stats[m].sd));
  // Explicit character words count twice the genre's defaults.
  const weight = (w: string) => (brief.character.includes(w) ? 2 : 1);
  const wants = brief.keep.flatMap((w) => (MEASURABLE[w] ?? []).map(([m, d]) => ({ word: w, m, d: d * weight(w) })));
  const avoids = brief.reject.flatMap((w) => (MEASURABLE[w] ?? []).map(([m, d]) => ({ word: `not ${w}`, m, d: -d })));
  const libraryName = options.libraryName ?? 'Samples';

  return pool
    .map((s) => {
      let score = 0;
      const why: string[] = [];
      const explained = new Set<Metric>();
      for (const { word, m, d } of [...wants, ...avoids]) {
        const contribution = d * z(s, m);
        score += contribution;
        if (contribution > 0.8 && !explained.has(m)) {
          explained.add(m);
          why.push(`${word}: ${m} ${s[m]}`);
        }
      }
      const name = words(s.name);
      for (const w of brief.keep) if (name.includes(w)) { score += 0.25; why.push(`named ${w}`); }
      const transpose = options.root ? transposeToKey(s.key ?? s.note, options.root) : null;
      return { ...s, score: Math.round(score * 100) / 100, why, transpose, browserPath: [libraryName, ...s.relative.split('/')] };
    })
    .sort((a, b) => b.score - a.score)
    // The same sound filed twice under different names measures identically: show it once.
    .filter((s, i, all) => all.findIndex((o) => o.tailMs === s.tailMs && o.attackMs === s.attackMs && o.subDb === s.subDb && o.brightDb === s.brightDb && o.widthDb === s.widthDb) === i)
    .slice(0, options.limit ?? 8);
}
