/**
 * The measured sample library: classification from pack folders, names,
 * and measurements on synthetic sounds whose properties are known.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyzeSample, bpmFromName, classifySample, keyFromName, scanSamples } from '../src/samples.js';
import { rankSamples, soundBrief, transposeToKey } from '../../agent/src/sound-selection.js';

let root: string;
const make = (rel: string, left: string, right = left, seconds = 1.5) => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${left}'|'${right}':s=44100:d=${seconds}`, '-c:a', 'pcm_s16le', path]);
  return path;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tm-samples-'));
  make('Pack/Drums/Kicks/Kick_Short_1.wav', '0.9*sin(2*PI*50*t)*exp(-30*t)');
  make('Pack/Drums/Kicks/Kick_Long_1.wav', '0.9*sin(2*PI*50*t)*exp(-4*t)');
  make('Pack/Drums/Claps/Clap_1.wav', '0.5*(random(1)*2-1)*exp(-25*t)', '0.5*(random(2)*2-1)*exp(-25*t)');
  make('Pack/Synth Shots/Analog/Pluck_A_1.wav', '0.5*sin(2*PI*110*t)*exp(-1*t)');
  make('Pack/FX/Uplifters/ETCT1_FX_Uplifters_F_5.wav', '0.3*sin(2*PI*(200+400*t)*t)', '0.3*sin(2*PI*(201+400*t)*t+1.5)');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('classification from names', () => {
  it('reads roles from pack folders, most specific first', () => {
    expect(classifySample('EDM Tips/Samples/Drums/Kicks/ETCT1_Kick_House_5.wav').role).toBe('kick');
    expect(classifySample('EDM Tips/Samples/Drums/Drum Loops/ETCT1_Loops_Full_Future Bass_140_1.wav')).toMatchObject({ role: 'loop', loop: true });
    expect(classifySample('EDM Tips/Samples/Synth Shots/Reeses/ETCT1_Synth_Shots_Reese_F_3.wav')).toMatchObject({ role: 'bass', kind: 'reese' });
    expect(classifySample('EDM Tips/Samples/FX/Downlifters/x.wav')).toMatchObject({ role: 'fx', kind: 'downlifter' });
    expect(classifySample('EDM Tips/Samples/Drums/Snaps/x.wav')).toMatchObject({ role: 'clap', kind: 'snap' });
  });

  it('reads key and tempo from names', () => {
    expect(keyFromName('ETCT1_FX_Ambience_A#_1.wav')).toBe('A#');
    expect(keyFromName('ETCT1_Synth_Shots_Reese_F_3.wav')).toBe('F');
    expect(keyFromName('Black Coffee Kick.wav')).toBeNull();
    expect(bpmFromName('Top Loop 124 BPM.wav')).toBe(124);
    expect(bpmFromName('ETCT1_Loops_Full_Future Bass_140_1.wav', true)).toBe(140);
    expect(bpmFromName('ETCT1_Kick_House_5.wav', false)).toBeNull();
  });
});

describe('measurements', () => {
  it('tells a short kick from a long one, a clap by its brightness and a wide sound by its side signal', async () => {
    const short = await analyzeSample(join(root, 'Pack/Drums/Kicks/Kick_Short_1.wav'), root);
    const long = await analyzeSample(join(root, 'Pack/Drums/Kicks/Kick_Long_1.wav'), root);
    const clap = await analyzeSample(join(root, 'Pack/Drums/Claps/Clap_1.wav'), root);
    expect(short.tailMs).toBeLessThan(long.tailMs / 3);
    expect(short.subDb).toBeGreaterThan(-6);
    expect(clap.brightDb).toBeGreaterThan(short.brightDb + 20);
    const wide = await analyzeSample(join(root, 'Pack/FX/Uplifters/ETCT1_FX_Uplifters_F_5.wav'), root);
    expect(wide.widthDb).toBeGreaterThan(short.widthDb + 20);
  });

  it('finds the pitch of a tonal sample and leaves noise unpitched', async () => {
    const pluck = await analyzeSample(join(root, 'Pack/Synth Shots/Analog/Pluck_A_1.wav'), root);
    expect(pluck.pitchHz).toBeGreaterThan(105);
    expect(pluck.pitchHz).toBeLessThan(115);
    expect(pluck.note).toMatch(/^A/);
    expect((await analyzeSample(join(root, 'Pack/Drums/Claps/Clap_1.wav'), root)).pitchHz).toBeNull();
  });

  it('scans a folder, classifies everything and reuses its cache', async () => {
    const cacheDir = join(root, '.cache');
    const first = await scanSamples(root, { cacheDir });
    expect(first.entries.map((e) => e.role).sort()).toEqual(['clap', 'fx', 'kick', 'kick', 'lead']);
    const started = Date.now();
    const second = await scanSamples(root, { cacheDir });
    expect(second.entries).toEqual(first.entries);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('ranking measured samples', () => {
  it('puts the short kick first for "short" and the long one first for "long"', async () => {
    const { entries } = await scanSamples(root, { cacheDir: join(root, '.cache') });
    expect(rankSamples(entries, soundBrief('kick', { character: ['short'] }))[0]!.name).toBe('Kick_Short_1.wav');
    expect(rankSamples(entries, soundBrief('kick', { character: ['long'] }))[0]!.name).toBe('Kick_Long_1.wav');
  });

  it('gives tonal samples a transposition to the track key and a browser path under the Place', async () => {
    const { entries } = await scanSamples(root, { cacheDir: join(root, '.cache') });
    const [uplifter] = rankSamples(entries, soundBrief('fx'), { root: 'G', libraryName: 'Samples' });
    expect(uplifter!.transpose).toBe(2);
    expect(uplifter!.browserPath).toEqual(['Samples', 'Pack', 'FX', 'Uplifters', 'ETCT1_FX_Uplifters_F_5.wav']);
    expect(transposeToKey('A#', 'F')).toBe(-5);
    expect(transposeToKey('D', 'F')).toBe(3);
  });
});
