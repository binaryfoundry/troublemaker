import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  loadReferenceSets,
  profileForGenre,
  selectReferences,
  type LibraryEntry,
  type LibraryIndex,
} from '../src/library.js';

let id = 0;
function entry(overrides: Partial<LibraryEntry>): LibraryEntry {
  id += 1;
  return {
    path: `D:/lib/track-${id}.flac`,
    artist: 'Someone',
    title: `Track ${id}`,
    genre: 'Melodic House & Techno',
    bpm: 124,
    key: null,
    label: null,
    year: 2024,
    codec: 'flac',
    lossless: true,
    sampleRate: 44100,
    bitDepth: 16,
    durationSeconds: 400,
    size: 1,
    mtimeMs: 1,
    ...overrides,
  };
}

const index = (entries: LibraryEntry[]): LibraryIndex => ({
  version: 1,
  root: 'D:/lib',
  scannedAt: '',
  entries,
});

describe('selectReferences', () => {
  it('uses lossless files only unless lossy is allowed', () => {
    const lib = index([entry({ codec: 'mp3', lossless: false, artist: 'A' }), entry({ artist: 'B' })]);
    expect(selectReferences(lib).references.map((e) => e.artist)).toEqual(['B']);
    expect(selectReferences(lib, { allowLossy: true }).references).toHaveLength(2);
  });

  it('filters by genre substring and lists the real genres when nothing matches', () => {
    const lib = index([entry({ genre: 'Techno (Peak Time / Driving)' }), entry({ genre: 'Progressive House', artist: 'X' })]);
    expect(selectReferences(lib, { genre: 'peak time' }).references).toHaveLength(1);
    expect(() => selectReferences(lib, { genre: 'drum & bass' })).toThrow(/Progressive House/);
  });

  it('prefers the closest tempo', () => {
    const lib = index([
      entry({ artist: 'Far', bpm: 132 }),
      entry({ artist: 'Near', bpm: 123 }),
      entry({ artist: 'Mid', bpm: 128 }),
    ]);
    expect(selectReferences(lib, { bpm: 124, count: 2 }).references.map((e) => e.artist)).toEqual(['Near', 'Mid']);
  });

  it('takes one track per lead artist when choosing by genre', () => {
    const lib = index([entry({ artist: 'Argy' }), entry({ artist: 'Argy, Anyma' }), entry({ artist: 'ARTBAT' })]);
    expect(selectReferences(lib).references.map((e) => e.artist)).toEqual(['Argy', 'ARTBAT']);
  });

  it('matches named artists anywhere in the credit, including collaborations', () => {
    const lib = index([
      entry({ artist: 'Ali Love, CamelPhat' }),
      entry({ artist: 'Audiofire (UK)' }),
      entry({ artist: 'Argy' }),
    ]);
    const picked = selectReferences(lib, { artists: ['CamelPhat', 'Audiofire'] }).references;
    expect(picked.map((e) => e.artist)).toEqual(['Ali Love, CamelPhat', 'Audiofire (UK)']);
  });

  it('spreads picks across the named artists instead of the best-stocked one', () => {
    const lib = index([
      ...['a', 'b', 'c', 'd', 'e'].map((t) => entry({ artist: 'CamelPhat', title: t })),
      entry({ artist: 'Audiofire (UK)', title: 'x' }),
      entry({ artist: 'Audiofire (UK)', title: 'y' }),
    ]);
    const picked = selectReferences(lib, { artists: ['CamelPhat', 'Audiofire'], count: 4 }).references;
    expect(picked.filter((e) => e.artist!.includes('Audiofire'))).toHaveLength(2);
  });

  it('never picks two versions of the same song', () => {
    const lib = index([
      entry({ artist: 'CamelPhat', title: 'Spektrum (Extended Mix)' }),
      entry({ artist: 'CamelPhat', title: 'Spektrum (Tharat Remix - Extended)' }),
      entry({ artist: 'CamelPhat', title: 'Witching Hour (Extended Mix)' }),
    ]);
    const titles = selectReferences(lib, { artists: ['CamelPhat'] }).references.map((e) => e.title);
    expect(titles.filter((t) => t!.startsWith('Spektrum'))).toHaveLength(1);
    expect(titles).toHaveLength(2);
  });

  it('excludes the track being mastered', () => {
    const own = entry({ artist: 'CamelPhat' });
    const lib = index([own, entry({ artist: 'CamelPhat', title: 'other' })]);
    const picked = selectReferences(lib, { artists: ['CamelPhat'], exclude: [own.path] }).references;
    expect(picked.map((e) => e.path)).not.toContain(own.path);
  });

  it('says when there are fewer than three references', () => {
    const lib = index([entry({ artist: 'Pryda' })]);
    expect(selectReferences(lib, { artists: ['Pryda'] }).notes.join(' ')).toMatch(/Only 1 reference/);
  });
});

describe('profileForGenre', () => {
  it('maps Beatport genre tags onto mastering profiles', () => {
    expect(profileForGenre('Melodic House & Techno')).toBe('techno');
    expect(profileForGenre('Techno (Peak Time / Driving)')).toBe('techno');
    expect(profileForGenre('Deep House')).toBe('deep');
    expect(profileForGenre('Progressive House')).toBe('house');
    expect(profileForGenre('Drum & Bass')).toBe('dnb');
    expect(profileForGenre('Dance / Pop')).toBeNull();
  });
});

describe('reference sets config', () => {
  it('loads the repository sets, each with artists and a profile', () => {
    const config = loadReferenceSets(join(__dirname, '..', '..', 'config', 'reference-sets.json'));
    expect(Object.keys(config.sets)).toEqual(['deep house', 'melodic techno', 'house']);
    for (const set of Object.values(config.sets)) {
      expect(set.artists!.length).toBeGreaterThan(0);
      expect(['deep', 'house', 'techno', 'dnb']).toContain(set.profile);
    }
  });

  it('reports a missing config file clearly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-sets-'));
    try {
      expect(() => loadReferenceSets(join(dir, 'none.json'))).toThrow(/No reference sets file/);
      writeFileSync(join(dir, 'ok.json'), JSON.stringify({ sets: { x: { artists: ['A'] } } }));
      expect(loadReferenceSets(join(dir, 'ok.json')).sets.x!.artists).toEqual(['A']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
