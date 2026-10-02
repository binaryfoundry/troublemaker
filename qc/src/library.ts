/**
 * A reference library: a folder of released masters, indexed by their tags.
 *
 * MIXING.md: use three to five lossless references from the same subgenre and
 * era, and never trust a single record. A Beatport download folder carries
 * everything needed to choose them automatically - genre, BPM, label, release
 * date - so the agent can pick references for a job instead of the user
 * naming files. The index stores tags only; audio analysis happens later,
 * and only for the references actually chosen (and is cached then).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { QcError } from './ffmpeg.js';

const FFPROBE = process.env.TROUBLEMAKER_FFPROBE ?? 'ffprobe';
const AUDIO_EXTENSIONS = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus']);
const LOSSLESS_CODECS = /^(pcm_|flac$|alac$|wavpack$)/;
const INDEX_VERSION = 1;
const PROBE_CONCURRENCY = 8;

export interface LibraryEntry {
  path: string;
  artist: string | null;
  title: string | null;
  genre: string | null;
  bpm: number | null;
  key: string | null;
  label: string | null;
  /** Release or recording year, when tagged. */
  year: number | null;
  codec: string;
  lossless: boolean;
  sampleRate: number;
  bitDepth: number | null;
  durationSeconds: number;
  size: number;
  mtimeMs: number;
}

export interface LibraryIndex {
  version: number;
  root: string;
  scannedAt: string;
  entries: LibraryEntry[];
}

function indexPath(root: string, dataDir: string): string {
  const key = createHash('sha1').update(resolve(root).toLowerCase()).digest('hex').slice(0, 12);
  return join(dataDir, 'library', `${key}.json`);
}

function listAudio(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function probeTags(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      FFPROBE,
      [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,sample_rate,bits_per_raw_sample,bits_per_sample:format=duration:format_tags',
        '-of', 'json',
        path,
      ],
      { windowsHide: true },
    );
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new QcError('PROBE_FAILED', `ffprobe could not read ${path}`));
      try {
        resolvePromise(JSON.parse(Buffer.concat(out).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Tag lookup that tolerates the different spellings of FLAC, ID3 and RIFF tags. */
function tag(tags: Record<string, string>, ...names: string[]): string | null {
  const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of names) {
    const value = lower.get(name.toLowerCase());
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return null;
}

async function describe(path: string): Promise<LibraryEntry> {
  const stat = statSync(path);
  const probed = (await probeTags(path)) as {
    streams?: Array<Record<string, string | number>>;
    format?: { duration?: string; tags?: Record<string, string> };
  };
  const stream = probed.streams?.[0] ?? {};
  const tags = probed.format?.tags ?? {};
  const codec = String(stream.codec_name ?? '?');
  const bits = Number(stream.bits_per_raw_sample ?? stream.bits_per_sample ?? 0);
  const bpm = Number(tag(tags, 'BPM', 'TBPM', 'tempo'));
  const yearText = tag(tags, 'RECORDING_DATE', 'TDOR', 'date', 'year', 'TDRC');
  const year = yearText ? Number(/(\d{4})/.exec(yearText)?.[1]) : NaN;
  return {
    path,
    artist: tag(tags, 'ARTIST', 'artist'),
    title: tag(tags, 'TITLE', 'title'),
    genre: tag(tags, 'GENRE', 'genre'),
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
    key: tag(tags, 'INITIAL_KEY', 'TKEY', 'key'),
    label: tag(tags, 'LABEL', 'ORGANIZATION', 'publisher'),
    year: Number.isFinite(year) ? year : null,
    codec,
    lossless: LOSSLESS_CODECS.test(codec),
    sampleRate: Number(stream.sample_rate ?? 0),
    bitDepth: bits > 0 ? bits : null,
    durationSeconds: Number(probed.format?.duration ?? 0),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Index a folder. Files whose size and modification time are unchanged are
 * reused from the previous index, so a rescan of a large library is quick.
 */
export async function scanLibrary(
  root: string,
  options: { dataDir?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<LibraryIndex> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new QcError('NOT_A_FOLDER', `${root} is not a folder.`);
  }
  const dataDir = options.dataDir ?? process.env.TROUBLEMAKER_DATA_DIR ?? '.troublemaker';
  const file = indexPath(root, dataDir);
  const previous = new Map<string, LibraryEntry>();
  if (existsSync(file)) {
    try {
      const old = JSON.parse(readFileSync(file, 'utf8')) as LibraryIndex;
      if (old.version === INDEX_VERSION) for (const e of old.entries) previous.set(e.path, e);
    } catch {
      // A corrupt index is rebuilt from scratch.
    }
  }

  const paths = listAudio(root);
  const entries: LibraryEntry[] = new Array(paths.length);
  let done = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= paths.length) return;
      const path = paths[index]!;
      const stat = statSync(path);
      const cached = previous.get(path);
      try {
        entries[index] =
          cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs ? cached : await describe(path);
      } catch {
        // Unreadable files are skipped rather than failing the whole scan.
      }
      done += 1;
      options.onProgress?.(done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));

  const index: LibraryIndex = {
    version: INDEX_VERSION,
    root: resolve(root),
    scannedAt: new Date().toISOString(),
    entries: entries.filter(Boolean),
  };
  mkdirSync(join(dataDir, 'library'), { recursive: true });
  writeFileSync(file, JSON.stringify(index), 'utf8');
  return index;
}

export function genreSummary(index: LibraryIndex): Array<{ genre: string; lossless: number; total: number }> {
  const counts = new Map<string, { lossless: number; total: number }>();
  for (const entry of index.entries) {
    const genre = entry.genre ?? '(untagged)';
    const c = counts.get(genre) ?? { lossless: 0, total: 0 };
    c.total += 1;
    if (entry.lossless) c.lossless += 1;
    counts.set(genre, c);
  }
  return [...counts.entries()]
    .map(([genre, c]) => ({ genre, ...c }))
    .sort((a, b) => b.lossless - a.lossless || b.total - a.total);
}

export interface SelectOptions {
  /** Case-insensitive substring of the genre tag, e.g. "melodic" or "techno (peak". */
  genre?: string;
  /**
   * Only tracks credited to one of these artists (substring of the artist
   * tag, so collaborations and remixes count). Picks are spread across them.
   */
  artists?: string[];
  /** Prefer references near this tempo. */
  bpm?: number;
  count?: number;
  /** Lossy files distort levels and true peak; allowed only on request. */
  allowLossy?: boolean;
  /** Exclude the track being mastered if it lives in the library. */
  exclude?: string[];
}

export interface Selection {
  references: LibraryEntry[];
  /** Why each was chosen, and any compromise made. */
  notes: string[];
}

/**
 * Choose references: matching genre, lossless, closest tempo, newest first
 * on a tie, and at most one per artist so one producer's sound cannot become
 * the median.
 */
export function selectReferences(index: LibraryIndex, options: SelectOptions = {}): Selection {
  const count = options.count ?? 5;
  const notes: string[] = [];
  const excluded = new Set((options.exclude ?? []).map((p) => resolve(p).toLowerCase()));
  let pool = index.entries.filter((e) => !excluded.has(resolve(e.path).toLowerCase()));

  const lossless = pool.filter((e) => e.lossless);
  if (!options.allowLossy) {
    pool = lossless;
  } else if (lossless.length < pool.length) {
    notes.push('Lossy files are allowed; their levels and true peak are less trustworthy than lossless masters.');
  }

  if (options.artists?.length) {
    const wanted = options.artists.map((a) => a.toLowerCase());
    const matching = pool.filter((e) => wanted.some((a) => (e.artist ?? '').toLowerCase().includes(a)));
    if (matching.length === 0) {
      throw new QcError(
        'NO_REFERENCES',
        `No ${options.allowLossy ? '' : 'lossless '}tracks by ${options.artists.join(', ')} in the library.`,
      );
    }
    pool = matching;
  }

  if (options.genre) {
    const wanted = options.genre.toLowerCase();
    const matching = pool.filter((e) => e.genre?.toLowerCase().includes(wanted));
    if (matching.length === 0) {
      const available = [...new Set(pool.map((e) => e.genre).filter(Boolean))].join(', ');
      throw new QcError(
        'NO_REFERENCES',
        `No ${options.allowLossy ? '' : 'lossless '}tracks tagged with a genre matching '${options.genre}'. ` +
          `Available: ${available || 'none'}.`,
      );
    }
    pool = matching;
  } else if (!options.artists?.length) {
    notes.push('No genre or artists given; references span the whole library, which blurs the median.');
  }

  const ranked = [...pool].sort((a, b) => {
    if (options.bpm !== undefined) {
      const da = a.bpm === null ? 999 : Math.abs(a.bpm - options.bpm);
      const db = b.bpm === null ? 999 : Math.abs(b.bpm - options.bpm);
      if (da !== db) return da - db;
    }
    return (b.year ?? 0) - (a.year ?? 0) || a.path.localeCompare(b.path);
  });

  const chosen: LibraryEntry[] = [];
  const titles = new Set<string>();
  const sameTitle = (entry: LibraryEntry) => baseTitle(entry.title ?? entry.path);

  if (options.artists?.length) {
    // Round-robin over the named artists in rank order, so a set of three
    // artists gives a spread rather than five tracks by the best-stocked one.
    const wanted = options.artists.map((a) => a.toLowerCase());
    const queues = wanted.map((a) => ranked.filter((e) => (e.artist ?? '').toLowerCase().includes(a)));
    while (chosen.length < count && queues.some((q) => q.length)) {
      for (const queue of queues) {
        while (queue.length) {
          const entry = queue.shift()!;
          if (chosen.includes(entry) || titles.has(sameTitle(entry))) continue;
          chosen.push(entry);
          titles.add(sameTitle(entry));
          break;
        }
        if (chosen.length === count) break;
      }
    }
  } else {
    const artists = new Set<string>();
    for (const entry of ranked) {
      const lead = (entry.artist ?? entry.path).split(/,|&| feat\.| x /i)[0]!.trim().toLowerCase();
      if (artists.has(lead) || titles.has(sameTitle(entry))) continue;
      artists.add(lead);
      titles.add(sameTitle(entry));
      chosen.push(entry);
      if (chosen.length === count) break;
    }
  }
  if (chosen.length < Math.min(3, count)) {
    notes.push(`Only ${chosen.length} references matched; MIXING.md recommends 3-5.`);
  }
  if (options.bpm !== undefined) {
    const far = chosen.filter((e) => e.bpm !== null && Math.abs(e.bpm - options.bpm!) > 8);
    if (far.length) notes.push(`${far.length} reference(s) are more than 8 BPM from ${options.bpm}.`);
  }
  return { references: chosen, notes };
}

/** "Spektrum (Tharat Remix - Extended)" and "Spektrum (Extended Mix)" are one song. */
function baseTitle(title: string): string {
  return title.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\..*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A sensible mastering profile for a Beatport-style genre tag. */
export function profileForGenre(genre: string | null | undefined): string | null {
  if (!genre) return null;
  const g = genre.toLowerCase();
  if (/drum\s*&\s*bass|drum and bass|dnb|jungle|dubstep|bass house|140/.test(g)) return 'dnb';
  if (/deep house|organic|downtempo|ambient|electronica/.test(g)) return 'deep';
  if (/techno/.test(g)) return 'techno';
  if (/house|disco|garage/.test(g)) return 'house';
  return null;
}

// ---------------------------------------------------------------------------
// Named reference sets (config/reference-sets.json)
// ---------------------------------------------------------------------------

export interface ReferenceSet {
  artists?: string[];
  genre?: string;
  profile?: string;
  library?: string;
  count?: number;
}

export interface ReferenceSetsConfig {
  library?: string;
  count?: number;
  sets: Record<string, ReferenceSet>;
}

export const REFERENCE_SETS_PATH = process.env.TROUBLEMAKER_REFERENCE_SETS ?? join('config', 'reference-sets.json');

export function loadReferenceSets(path = REFERENCE_SETS_PATH): ReferenceSetsConfig {
  if (!existsSync(path)) {
    throw new QcError('NO_REFERENCE_SETS', `No reference sets file at ${path}.`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as ReferenceSetsConfig;
}

/** Resolve a named set into the files to use and the profile that goes with it. */
export async function referencesForSet(
  name: string,
  options: { bpm?: number; exclude?: string[]; configPath?: string; dataDir?: string } = {},
): Promise<Selection & { profile: string | null; set: string }> {
  const config = loadReferenceSets(options.configPath);
  const key = Object.keys(config.sets).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) {
    throw new QcError(
      'UNKNOWN_REFERENCE_SET',
      `No reference set '${name}'. Known: ${Object.keys(config.sets).join(', ')}.`,
    );
  }
  const set = config.sets[key]!;
  const library = set.library ?? config.library;
  if (!library) throw new QcError('NO_LIBRARY', `Reference set '${key}' names no library folder.`);
  const index = await scanLibrary(library, { dataDir: options.dataDir });
  const selection = selectReferences(index, {
    artists: set.artists,
    genre: set.genre,
    bpm: options.bpm,
    count: set.count ?? config.count ?? 5,
    exclude: options.exclude,
  });
  return { ...selection, profile: set.profile ?? null, set: key };
}
