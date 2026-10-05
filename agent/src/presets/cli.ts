/**
 * Convert Serum 2 and Diva presets to AnalogFoundry 101 patches.
 *
 *   npm run convert-preset -- <file or folder>... [--out DIR]
 *
 * For each preset writes <name>.txt (an AF101 preset, loadable with
 * `render_note --preset` or applied to the plugin by parameter), <name>.chain.json
 * (the Live devices to put after it) and <name>.md (what was mapped, approximated
 * and dropped, and the assumptions). The default output folder is git-ignored:
 * converted patches are derived from licensed packs and stay on this machine.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

import { toPresetText } from './af101.js';
import { convertDiva, DIVA_ASSUMPTIONS, parseDiva } from './diva.js';
import { convertSerum, decodeSerum, SERUM_ASSUMPTIONS } from './serum.js';
import { reportMarkdown, type Conversion } from './types.js';

const args = process.argv.slice(2);
let out = resolve('analogfoundry/presets/converted');
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i] ?? '';
  if (a === '--out') out = resolve(args[++i] ?? out);
  else inputs.push(a);
}
if (!inputs.length) {
  console.error('usage: npm run convert-preset -- <.SerumPreset | .h2p | folder>... [--out DIR]');
  process.exit(2);
}

const files: string[] = [];
for (const p of inputs) {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) files.push(join(p, f));
  else files.push(p);
}

// Level: a converted patch stacks every source the original had, so its raw sum
// runs hot. Render it with AF101's own offline renderer at three notes and set
// `level` so the loudest peak sits at -3 dBFS, like the hand-made patches.
const RENDER = resolve('analogfoundry/build/Release/render_note.exe');
const TARGET_PEAK_DB = -3;
function peakDb(presetFile: string, note: number): number {
  const wav = join(tmpdir(), `af101-level-${process.pid}-${note}.wav`);
  // render_note prints the true peak before the 24-bit file clips it; use that.
  const outText = execFileSync(RENDER, ['--preset', presetFile, '--note', String(note), '--seconds', '4', '--gate', '3', '--no-normalise', '--out', wav], { encoding: 'utf8' });
  rmSync(wav, { force: true });
  const peak = Number(outText.match(/"peak_dbfs":(-?[0-9.]+)/)?.[1]);
  if (!Number.isFinite(peak)) throw new Error(`render_note gave no peak for ${presetFile}`);
  return peak;
}
function calibrateLevel(c: Conversion, presetFile: string): string {
  if (!existsSync(RENDER)) return 'level not calibrated: build analogfoundry (render_note) first';
  const level = c.patch.level ?? 0.8;
  const peak = Math.max(...[45, 57, 69].map((n) => peakDb(presetFile, n)));
  const scaled = Math.min(1, Math.max(0.02, level * Math.pow(10, (TARGET_PEAK_DB - peak) / 20)));
  c.patch.level = scaled;
  return `level ${level.toFixed(2)} -> ${scaled.toFixed(3)}: peak ${peak.toFixed(1)} dBFS -> ${TARGET_PEAK_DB} dBFS over notes 45/57/69 (render_note)`;
}

const rows: string[] = [];
let done = 0;
for (const file of files) {
  const ext = extname(file).toLowerCase();
  if (ext !== '.serumpreset' && ext !== '.h2p') continue;
  const name = basename(file, extname(file));
  let c: Conversion;
  try {
    c = ext === '.h2p' ? convertDiva(parseDiva(readFileSync(file, 'latin1')), name) : convertSerum(decodeSerum(readFileSync(file)), name);
  } catch (e) {
    console.error(`${name}: ${(e as Error).message}`);
    continue;
  }
  const dir = join(out, c.source);
  mkdirSync(dir, { recursive: true });
  const header = [
    `${name} - converted from ${c.source === 'serum' ? 'Serum 2' : 'Diva'} by agent/src/presets (see ${name}.md)`,
    ...(c.polyphonic ? ['polyphonic source: AF101 is mono - single-note parts only'] : []),
    ...(c.transposeOctaves ? [`transpose the clip ${c.transposeOctaves} octave(s)`] : []),
  ];
  writeFileSync(join(dir, `${name}.txt`), toPresetText(c.patch, header));
  c.report.mapped.push(calibrateLevel(c, join(dir, `${name}.txt`)));
  writeFileSync(join(dir, `${name}.txt`), toPresetText(c.patch, header));
  writeFileSync(join(dir, `${name}.chain.json`), JSON.stringify(c.chain, null, 2) + '\n');
  writeFileSync(join(dir, `${name}.md`), reportMarkdown(c, c.source === 'serum' ? SERUM_ASSUMPTIONS : DIVA_ASSUMPTIONS));
  rows.push(`| ${c.source} | ${name} | ${c.polyphonic ? 'poly' : 'mono'} | ${c.report.mapped.length} | ${c.report.approximated.length} | ${c.report.dropped.length} | ${c.matrix.length} | ${c.chain.map((d) => d.device).join(', ')} |`);
  done++;
}
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'INDEX.md'),
  ['# Converted presets', '', '| Source | Preset | Voice | Mapped | Approximated | Dropped | Matrix slots | Live chain |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n') + '\n',
);
console.log(`${done} presets converted into ${out}`);
