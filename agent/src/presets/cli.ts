/**
 * Convert Serum 2 and Diva presets to AnalogFoundry 101 patches.
 *
 *   npm run convert-preset -- <file or folder>... [--out DIR]
 *
 * For each preset writes <name>.txt (an AF101 preset, loadable with
 * `render_note --preset` or applied to the plugin by parameter), <name>.chain.json
 * (the Live devices to put after it), <name>.md (what was mapped, approximated
 * and dropped, and the assumptions) and, for Serum, <name>.clip.txt (the preset's
 * demo clip for `render_note --events`). The default output folder is git-ignored:
 * converted patches are derived from licensed packs and stay on this machine.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

import { toPresetText } from './af101.js';
import { convertDiva, DIVA_ASSUMPTIONS, parseDiva } from './diva.js';
import { convertSerum, decodeSerum, SERUM_ASSUMPTIONS, serumDemoClip, type TableReader } from './serum.js';
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

// Serum's wavetables, so the converter can read the frame a preset plays (S5). Serum 2
// installs them under Documents; AF_SERUM_TABLES points elsewhere. Without them the
// converter falls back to choosing a wave by the table's name.
const TABLES = process.env.AF_SERUM_TABLES ?? join(homedir(), 'Documents', 'Xfer', 'Serum 2 Presets', 'Tables');

/** A WAV file's samples, channels mixed to mono (PCM 16/24/32 or 32-bit float). */
function readWavMono(file: string): Float32Array {
  const b = readFileSync(file);
  let pos = 12, fmt = 1, channels = 1, bits = 16;
  let data: Buffer | undefined;
  while (pos + 8 <= b.length) {
    const id = b.toString('latin1', pos, pos + 4), size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = b.readUInt16LE(pos + 8);
      channels = b.readUInt16LE(pos + 10);
      bits = b.readUInt16LE(pos + 22);
      if (fmt === 0xfffe) fmt = b.readUInt16LE(pos + 32); // WAVE_FORMAT_EXTENSIBLE: the sub-format
    } else if (id === 'data') data = b.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size & 1);
  }
  if (!data) throw new Error(`${file}: no data chunk`);
  const bytes = bits / 8, frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      sum += fmt === 3 ? data.readFloatLE(o) : bits === 16 ? data.readInt16LE(o) / 32768 : bits === 24 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
    }
    out[i] = sum / channels;
  }
  return out;
}

const tableCache = new Map<string, Float32Array[] | undefined>();
const findTable = (dir: string, name: string): string | undefined => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findTable(p, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return undefined;
};
const readTable: TableReader = (relativePath) => {
  if (!existsSync(TABLES)) return undefined;
  if (!tableCache.has(relativePath)) {
    const direct = join(TABLES, relativePath);
    const file = existsSync(direct) ? direct : findTable(TABLES, basename(relativePath));
    let frames: Float32Array[] | undefined;
    if (file) {
      const x = readWavMono(file);
      frames = Array.from({ length: Math.floor(x.length / 2048) }, (_, f) => x.subarray(f * 2048, (f + 1) * 2048));
    }
    tableCache.set(relativePath, frames?.length ? frames : undefined);
  }
  return tableCache.get(relativePath);
};
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
  let clip: ReturnType<typeof serumDemoClip>;
  try {
    if (ext === '.h2p') c = convertDiva(parseDiva(readFileSync(file, 'latin1')), name);
    else {
      const body = decodeSerum(readFileSync(file));
      c = convertSerum(body, name, readTable);
      clip = serumDemoClip(body, c.transposeOctaves);
    }
  } catch (e) {
    console.error(`${name}: ${(e as Error).message}`);
    continue;
  }
  const dir = join(out, c.source);
  mkdirSync(dir, { recursive: true });
  const header = [
    `${name} - converted from ${c.source === 'serum' ? 'Serum 2' : 'Diva'} by agent/src/presets (see ${name}.md)`,
    ...(c.polyphonic ? [`polyphonic source: ${c.patch.voices ?? 8} voices`] : []),
    ...(c.transposeOctaves ? [`transpose the clip ${c.transposeOctaves} octave(s)`] : []),
  ];
  writeFileSync(join(dir, `${name}.txt`), toPresetText(c.patch, header));
  c.report.mapped.push(calibrateLevel(c, join(dir, `${name}.txt`)));
  writeFileSync(join(dir, `${name}.txt`), toPresetText(c.patch, header));
  writeFileSync(join(dir, `${name}.chain.json`), JSON.stringify(c.chain, null, 2) + '\n');
  writeFileSync(join(dir, `${name}.md`), reportMarkdown(c, c.source === 'serum' ? SERUM_ASSUMPTIONS : DIVA_ASSUMPTIONS));
  if (clip) {
    const head = `# ${name}: the preset's demo clip, ${clip.beats} beats. render_note --preset "${name}.txt" --events "${name}.clip.txt" --bpm B\n`;
    writeFileSync(join(dir, `${name}.clip.txt`), head + clip.events);
  }
  rows.push(`| ${c.source} | ${name} | ${c.polyphonic ? 'poly' : 'mono'} | ${c.report.mapped.length} | ${c.report.approximated.length} | ${c.report.dropped.length} | ${c.matrix.length} | ${c.chain.map((d) => d.device).join(', ')} |`);
  done++;
}
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'INDEX.md'),
  ['# Converted presets', '', '| Source | Preset | Voice | Mapped | Approximated | Dropped | Matrix slots | Live chain |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n') + '\n',
);
console.log(`${done} presets converted into ${out}`);
