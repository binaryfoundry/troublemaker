/**
 * Release tags on an exported file.
 *
 * Live's Export Audio/Video writes no artist or title, so every render leaves
 * Live untagged. ffmpeg copies the streams untouched (-c copy) and rewrites only
 * the container's tags. The result goes to a temporary file first and replaces
 * the original only after its tags read back and its decoded audio hashes the
 * same as the original's.
 *
 * WAV carries tags in a RIFF INFO chunk (artist is IART); ffmpeg cannot write
 * an ID3 chunk into WAV, and some DJ software reads only that. FLAC, AIFF and
 * MP3 carry standard tags.
 */

import { existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { QcError, run } from './ffmpeg.js';

const FFMPEG = process.env.TROUBLEMAKER_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.TROUBLEMAKER_FFPROBE ?? 'ffprobe';

/** The name every release goes out under. */
export const DEFAULT_ARTIST = 'NothingButTrouble';

const TAGGABLE = new Set(['.wav', '.flac', '.aif', '.aiff', '.mp3']);

export interface ReleaseTags {
  artist: string;
  title?: string;
  album?: string;
}

export interface TagResult {
  path: string;
  /** Every tag on the file after writing, keys lower-cased. */
  tags: Record<string, string>;
}

/** The container's tags, keys lower-cased (WAV reports IART as "artist"). */
export async function readTags(path: string): Promise<Record<string, string>> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', path]);
  const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.format?.tags ?? {})) tags[key.toLowerCase()] = value;
  return tags;
}

/** MD5 of the decoded first audio stream, as 64-bit float so no format loses bits. */
export async function audioHash(path: string): Promise<string> {
  const { stdout } = await run(FFMPEG, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-c:a',
    'pcm_f64le',
    '-f',
    'md5',
    '-',
  ]);
  return stdout.trim();
}

function formatArgs(extension: string): string[] {
  switch (extension) {
    case '.mp3':
      // ID3v2.3 is what most players and DJ software read; v1 for the rest.
      return ['-id3v2_version', '3', '-write_id3v1', '1'];
    case '.aif':
    case '.aiff':
      return ['-write_id3v2', '1'];
    default:
      return [];
  }
}

export async function tagFile(path: string, tags: ReleaseTags): Promise<TagResult> {
  const extension = extname(path).toLowerCase();
  if (!TAGGABLE.has(extension)) {
    throw new QcError('UNSUPPORTED', `Cannot tag ${extension || 'a file without an extension'}; use one of ${[...TAGGABLE].join(', ')}.`);
  }
  if (!existsSync(path)) throw new QcError('NOT_FOUND', `${path} does not exist.`);
  if (!tags.artist.trim()) throw new QcError('INVALID_ARGUMENT', 'The artist cannot be empty.');

  const metadata: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (value !== undefined) metadata.push('-metadata', `${key}=${value}`);
  }
  // Keep the extension so ffmpeg picks the same container.
  const temporary = join(dirname(path), `.${basename(path, extname(path))}.tagging${extname(path)}`);
  try {
    await run(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      path,
      '-map',
      '0',
      '-c',
      'copy',
      '-map_metadata',
      '0',
      ...metadata,
      ...formatArgs(extension),
      // No "encoder=Lavf..." tag: the file should carry the release's tags only.
      '-fflags',
      '+bitexact',
      temporary,
    ]);

    const written = await readTags(temporary);
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined && written[key] !== value) {
        throw new QcError('VERIFY_FAILED', `${key} read back as '${written[key] ?? ''}', not '${value}'.`);
      }
    }
    const [before, after] = await Promise.all([audioHash(path), audioHash(temporary)]);
    if (before !== after) throw new QcError('VERIFY_FAILED', 'The audio changed while tagging; the original is untouched.');

    renameSync(temporary, path);
    return { path, tags: written };
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}
