/**
 * Release tagging against real files rendered by ffmpeg.
 *
 * Skipped when ffmpeg is not installed, so `npm test` still runs anywhere.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { audioHash, DEFAULT_ARTIST, readTags, tagFile } from '../src/tag.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
let dir = '';

/** One second of tone, with a genre tag already on it, as Live would leave it plus one tag. */
function render(name: string, codec: string[]): string {
  const path = join(dir, name);
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=44100', '-ac', '2', ...codec, '-metadata', 'genre=Melodic House', path],
    { stdio: 'ignore' },
  );
  return path;
}

beforeAll(() => {
  if (hasFfmpeg) dir = mkdtempSync(join(tmpdir(), 'tm-tag-'));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)('tagFile', () => {
  const formats: Array<[string, string[]]> = [
    ['track.wav', ['-c:a', 'pcm_s24le']],
    ['track.flac', ['-c:a', 'flac']],
    ['track.aiff', ['-c:a', 'pcm_s24be', '-write_id3v2', '1']],
    ['track.mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']],
  ];

  for (const [name, codec] of formats) {
    it(`sets the artist on ${name} and leaves the audio bit for bit`, async () => {
      const path = render(name, codec);
      const before = await audioHash(path);

      const result = await tagFile(path, { artist: DEFAULT_ARTIST, title: 'Cathedral' });

      expect(result.tags.artist).toBe('NothingButTrouble');
      expect(result.tags.title).toBe('Cathedral');
      const reread = await readTags(path);
      expect(reread.artist).toBe('NothingButTrouble');
      expect(await audioHash(path)).toBe(before);
    });
  }

  it('keeps the tags that were already there', async () => {
    const path = render('kept.flac', ['-c:a', 'flac']);
    await tagFile(path, { artist: DEFAULT_ARTIST });
    expect((await readTags(path)).genre).toBe('Melodic House');
  });

  it('replaces an artist that was already set', async () => {
    const path = render('retag.flac', ['-c:a', 'flac']);
    await tagFile(path, { artist: 'Someone Else' });
    await tagFile(path, { artist: DEFAULT_ARTIST });
    expect((await readTags(path)).artist).toBe('NothingButTrouble');
  });

  it('refuses an empty artist', async () => {
    const path = render('empty.wav', ['-c:a', 'pcm_s16le']);
    await expect(tagFile(path, { artist: '  ' })).rejects.toThrow(/artist cannot be empty/);
  });

  it('leaves no temporary file behind', async () => {
    const path = render('clean.wav', ['-c:a', 'pcm_s16le']);
    await tagFile(path, { artist: DEFAULT_ARTIST });
    expect(readdirSync(dir).filter((f) => f.includes('.tagging'))).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });
});

describe('tagFile input checks', () => {
  it('refuses a format it cannot tag', async () => {
    await expect(tagFile('mix.ogg', { artist: DEFAULT_ARTIST })).rejects.toThrow(/Cannot tag \.ogg/);
  });
});
