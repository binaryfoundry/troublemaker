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
