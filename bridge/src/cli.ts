#!/usr/bin/env node
/**
 * ableton-agent - a thin CLI over the bridge's HTTP API.
 *
 * It talks to a running bridge rather than opening its own connection to
 * Live, so the CLI and an agent can both be connected at once.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMMANDS } from './commands/registry.js';
import { runQc } from '../../qc/src/run.js';
import { compareFiles, runAb } from '../../qc/src/ab.js';
import { analyzeBass, formatBassProfile } from '../../qc/src/bass.js';
import { applyEffect, findEffect, loadCodex } from './fx.js';
import { identifyEffect } from '../../qc/src/identify.js';
import { formatPlan, planArrangement, styleNames } from '../../agent/src/arrangement.js';
import { checkStylePlan } from '../../agent/src/artists.js';
import { checkDrumPattern, drumGenres, drumGrids, drumPattern, formatGrid, type DrumOptions, type Energy, type Variant } from '../../agent/src/drums.js';
import { genreSummary, loadReferenceSets, scanLibrary } from '../../qc/src/library.js';
import { buildArrangement, resolveReferenceFiles, sampleLibraryConfig, shortlistLocalSamples, writeDrums, type ResolvedReferences } from './workflows.js';
import { scanSamples } from '../../qc/src/samples.js';
import { soundBrief } from '../../agent/src/sound-selection.js';
import { PROFILES } from '../../agent/src/mastering/profiles.js';
import type { ChainState, Decision } from '../../agent/src/mastering/policy.js';

const DEFAULT_BASE = `http://127.0.0.1:${process.env.TROUBLEMAKER_PORT ?? 8765}`;

interface CliResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; [key: string]: unknown };
}

async function post(
  command: string,
  args: Record<string, unknown> = {},
  dryRun = false,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base()}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, args, dry_run: dryRun }),
    });
  } catch (error) {
    throw new Error(
      `Cannot reach the bridge at ${base()}. Start it with 'npm run bridge'.\n  ${String(error)}`,
    );
  }
  const body = (await response.json()) as CliResult;
  if (!body.ok) {
    const details = { ...body.error };
    delete details.code;
    delete details.message;
    const extra = Object.keys(details).length ? `\n  ${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${body.error?.code}: ${body.error?.message}${extra}`);
  }
  return body.result;
}

function base(): string {
  return process.env.TROUBLEMAKER_URL ?? DEFAULT_BASE;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseNumber(label: string, text: string | undefined): number {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number (got '${text}').`);
  return value;
}

function parseInteger(label: string, text: string | undefined): number {
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer (got '${text}').`);
  return value;
}

const USAGE = `ableton-agent - control Ableton Live through the TroubleMaker bridge

Usage:
  ableton-agent status                      Bridge and Live connection status
  ableton-agent capabilities                What this Live install supports
  ableton-agent state                       Compact project overview
  ableton-agent tempo [bpm]                 Read or set the tempo
  ableton-agent tracks                      List tracks with their ids
  ableton-agent selected                    The selected track / clip / device
  ableton-agent clips <track_id>            Clip slots on a track
  ableton-agent notes <track_id> <slot>     Notes in a MIDI clip
  ableton-agent devices <track_id>          Devices on a track
  ableton-agent params <track_id> <dev_id>  Parameters of a device
  ableton-agent play | stop                 Transport
  ableton-agent commands                    The full command catalogue
  ableton-agent raw <command> [json]        Any command, with JSON arguments
  ableton-agent selftest                    Round-trip check against Live

Mastering QC (runs locally on exported files; no bridge needed):
  ableton-agent qc <master.wav> [options]
      --ref <file>             reference master (repeat for 3-5 references)
      --profile <name>         ${Object.keys(PROFILES).join(' | ')} (default techno)
      --section <start:dur>    comparable section in seconds (default: loudest 30 s)
      --sample-rate <hz>       required delivery sample rate
      --bit-depth <bits>       required delivery bit depth
      --chain                  also apply master-chain rules (needs the bridge)
      --json <out.json>        write the full result as JSON
      --capture                record the Master in Live instead of reading a file (needs the bridge)
        --bars <n>             capture length (default 16)
        --scene <id>           launch this scene for the capture
  Exit code: 0 PASS, 1 REVIEW, 2 FAIL.

Reference library:
  ableton-agent refs sets                          Named sets from config/reference-sets.json
  ableton-agent refs scan [dir]                    Index a folder of released masters (tags only)
  ableton-agent refs genres [dir]                  What the library holds, by genre tag
  ableton-agent refs pick <set> [--bpm n]          Which references a set resolves to
  ableton-agent refs pick --dir <dir> --genre <g> [--bpm n]
  On qc, compare and ab:  --refs <set>  or  --refs-dir <dir> [--genre <g>]
      picks 3-5 lossless references automatically (BPM from Live when it is reachable).

Effects (agent/knowledge/effects.json):
  ableton-agent fx list [--family <f>] [--energy <e>]   The codex, one line per effect
  ableton-agent fx show <id|name|alias>                  Cue, mechanism, recipe, confusions
  ableton-agent fx apply <id> --track <id> [--slot n] [--start beat] [--bars n | --length beats]
      [--pitch n] [--root F] [--set "Param=value"]... [--dry-run]
      Build the effect in Live from its recipe.
  ableton-agent fx identify <file> [--start s] [--duration s]
      Which effect an audio excerpt sounds like, from onset spacing, pitch and brightness.

Arrangement (agent/knowledge/styles.json):
  ableton-agent drums show <genre> [--phrase] [--energy e] [--variant A|A'|B|F]   DRUMS.md grid and checks
  ableton-agent drums write <genre> --track <id> [--slot n] [--bars n] [--phrase] [--energy e]
                  [--variant v] [--swing 50-75] [--laid-back] [--humanize] [--chance] [--seed n]
  ableton-agent samples scan [folder]       Measure the local sample library (cached)
  ableton-agent samples pick <role> [--genre g] [--character short,round] [--key F] [--loops] [--pair <bass track>] [--part <track>]
  ableton-agent arrangement plan <style> [--roles kick,bass,...]   Sections, energy, roles, checks
  ableton-agent arrangement build <style> [--map kick=12,bass=15,...] [--replace] [--dry-run]
      Lay each track's slot-0 loop across the sections its role plays in (Live 11+).
      Roles come from --map, or from track names. --replace clears existing Arrangement clips.

Bassline analysis:
  ableton-agent bass <file> [--bpm n]               Rhythm, pitches, kick ducking and balance of a drop

Loudness-matched A/B:
  ableton-agent compare <a.wav> <b.wav> [--ref <file>...] [--profile <name>] [--out <dir>]
      Compare two files at matched loudness and write gain-matched listening copies.
  ableton-agent ab <role> <value> --reason "<why>" [--bars n] [--scene id] [--ref <file>...]
      [--profile <name>] [--keep] [--mix-repair] [--allow-widen]
      Capture A, apply the change, capture B, compare at matched loudness, and revert
      unless B wins (--keep keeps it regardless). Needs the bridge.

Master chain (through the bridge):
  ableton-agent master chain                       Roles, values, safe ranges
  ableton-agent master set <role> <value> --reason "<why>"
      [--mix-repair] [--allow-widen] [--override]
  ableton-agent master decisions [role]           Logged changes
  ableton-agent master reset [label]              Start a new job's decision log
  ableton-agent master checkpoint <label>         Save the whole chain
  ableton-agent master restore <checkpoint_id>    Restore it
  ableton-agent master build [--preset clean | --no-preset]
                                                   Insert the chain and dial it in (Live 12.3+)
  ableton-agent master preset <name>              Apply a starting preset (clean)
  ableton-agent master meters [seconds]           Live's display meters
  ableton-agent master capture [--bars n] [--scene id]
                                                   Record the Master output to a WAV (real time)
  Every master subcommand takes --track <id> to work on a track other than Master.

Options:
  --dry-run    With 'raw': report the operation without applying it.

Environment:
  TROUBLEMAKER_URL   bridge base URL (default ${DEFAULT_BASE})
`;

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const args = argv.filter((value) => value !== '--dry-run');
  const [command, ...rest] = args;

  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      return 0;

    case 'status':
      print(await post('bridge.status'));
      return 0;

    case 'capabilities':
      print(await post('live.get_capabilities'));
      return 0;

    case 'commands':
      print(COMMANDS);
      return 0;

    case 'state': {
      const state = (await post('live.get_project_state', { include_devices: true })) as {
        tempo: number;
        time_signature: [number, number];
        playing: boolean;
        tracks: Array<{
          track_id: number;
          name: string;
          type: string;
          clips: Array<{ slot: number; name: string; length_beats: number }>;
          devices: Array<{ name: string }>;
        }>;
      };
      process.stdout.write(
        `${state.tempo} BPM  ${state.time_signature.join('/')}  ${
          state.playing ? 'playing' : 'stopped'
        }\n\n`,
      );
      for (const track of state.tracks) {
        const devices = track.devices.map((d) => d.name).join(', ');
        process.stdout.write(
          `  [${String(track.track_id).padStart(3)}] ${track.name}  (${track.type})` +
            `${devices ? `  devices: ${devices}` : ''}\n`,
        );
        for (const clip of track.clips) {
          process.stdout.write(
            `         slot ${clip.slot}: ${clip.name || '(unnamed)'} - ${clip.length_beats} beats\n`,
          );
        }
      }
      return 0;
    }

    case 'tempo': {
      if (rest.length === 0) {
        print(await post('live.get_tempo'));
      } else {
        print(await post('live.set_tempo', { bpm: parseNumber('tempo', rest[0]) }));
      }
      return 0;
    }

    case 'tracks': {
      const result = (await post('live.get_tracks')) as {
        tracks: Array<{ track_id: number; name: string; type: string }>;
      };
      for (const track of result.tracks) {
        process.stdout.write(
          `[${String(track.track_id).padStart(3)}] ${track.name}  (${track.type})\n`,
        );
      }
      return 0;
    }

    case 'selected': {
      const out: Record<string, unknown> = {};
      for (const [key, name] of [
        ['track', 'live.get_selected_track'],
        ['clip', 'live.get_selected_clip'],
        ['device', 'live.get_selected_device'],
      ] as const) {
        try {
          out[key] = await post(name);
        } catch (error) {
          out[key] = { unavailable: (error as Error).message };
        }
      }
      print(out);
      return 0;
    }

    case 'clips':
      print(await post('live.get_clip_slots', { track_id: parseInteger('track_id', rest[0]) }));
      return 0;

    case 'notes':
      print(
        await post('live.get_notes', {
          track_id: parseInteger('track_id', rest[0]),
          clip_slot: parseInteger('clip_slot', rest[1]),
        }),
      );
      return 0;

    case 'devices':
      print(await post('live.get_devices', { track_id: parseInteger('track_id', rest[0]) }));
      return 0;

    case 'params':
      print(
        await post('live.get_device_parameters', {
          track_id: parseInteger('track_id', rest[0]),
          device_id: parseInteger('device_id', rest[1]),
        }),
      );
      return 0;

    case 'play':
      print(await post('live.play'));
      return 0;

    case 'stop':
      print(await post('live.stop'));
      return 0;

    case 'raw': {
      const name = rest[0];
      if (!name) throw new Error("'raw' needs a command name.");
      let parsed: Record<string, unknown> = {};
      if (rest[1]) {
        try {
          parsed = JSON.parse(rest[1]) as Record<string, unknown>;
        } catch (error) {
          throw new Error(`Arguments must be a JSON object: ${String(error)}`);
        }
      }
      print(await post(name, parsed, dryRun));
      return 0;
    }

    case 'selftest':
      return selftest();

    case 'qc':
      return qc(rest);

    case 'compare':
      return compare(rest);

    case 'refs':
      return refs(rest);

    case 'fx':
      return fx(rest);

    case 'arrangement':
      return arrangement(rest);

    case 'drums':
      return drums(rest);

    case 'samples':
      return samples(rest);

    case 'bass': {
      const options = [...rest];
      const [bpm] = takeOption(options, '--bpm');
      const [file] = options;
      if (!file) throw new Error("'bass' needs a file.");
      const profile = await analyzeBass(file, bpm ? { bpm: parseNumber('--bpm', bpm) } : {});
      process.stdout.write(`${formatBassProfile(profile)}\n`);
      return 0;
    }

    case 'ab':
      return ab(rest);

    case 'master':
      return master(rest);

    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
      return 2;
  }
}

/** Turn --ref / --refs <set> / --refs-dir into files, a profile hint and notes. */
async function resolveReferences(
  args: string[],
  options: { exclude?: string[] } = {},
): Promise<ResolvedReferences> {
  const files = takeOption(args, '--ref');
  const [set] = takeOption(args, '--refs');
  const [dir] = takeOption(args, '--refs-dir');
  const [genre] = takeOption(args, '--genre');
  const [bpmText] = takeOption(args, '--bpm');
  const allowLossy = takeFlag(args, '--allow-lossy');
  return resolveReferenceFiles(
    { post },
    {
      files,
      set,
      dir,
      genre,
      bpm: bpmText ? parseNumber('--bpm', bpmText) : undefined,
      allowLossy,
      exclude: options.exclude,
    },
  );
}

async function refs(argv: string[]): Promise<number> {
  const args = [...argv];
  const [sub, ...rest] = args;
  switch (sub) {
    case 'sets': {
      const config = loadReferenceSets();
      process.stdout.write(`Library: ${config.library ?? '(per set)'}\n\n`);
      for (const [name, set] of Object.entries(config.sets)) {
        const who = set.artists?.length ? set.artists.join(', ') : `genre '${set.genre}'`;
        process.stdout.write(`  ${name.padEnd(16)} ${who}  [profile ${set.profile ?? 'auto'}]\n`);
      }
      return 0;
    }
    case 'scan':
    case 'genres': {
      const dir = rest[0] ?? loadReferenceSets().library;
      if (!dir) throw new Error('Give a folder, or set "library" in config/reference-sets.json.');
      const started = Date.now();
      const index = await scanLibrary(dir);
      const lossless = index.entries.filter((e) => e.lossless).length;
      process.stdout.write(
        `${index.entries.length} files (${lossless} lossless) indexed in ${((Date.now() - started) / 1000).toFixed(1)} s\n\n`,
      );
      for (const g of genreSummary(index)) {
        process.stdout.write(`  ${String(g.lossless).padStart(4)} lossless / ${String(g.total).padStart(4)}  ${g.genre}\n`);
      }
      return 0;
    }
    case 'pick': {
      const options = [...rest];
      const setName = options[0] && !options[0].startsWith('--') ? options.shift() : undefined;
      if (setName) options.push('--refs', setName);
      const [dir] = takeOption([...options], '--dir');
      if (dir) {
        const i = options.indexOf('--dir');
        options.splice(i, 2, '--refs-dir', dir);
      }
      const resolved = await resolveReferences(options);
      if (!resolved.files.length) throw new Error('Name a set, or give --dir <folder> [--genre <g>].');
      process.stdout.write(`${resolved.describe.join('\n')}\n`);
      if (resolved.profile) process.stdout.write(`  profile: ${resolved.profile}\n`);
      return 0;
    }
    default:
      throw new Error('Unknown refs subcommand. Try: sets, scan, genres, pick.');
  }
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = args.indexOf(name); index >= 0; index = args.indexOf(name)) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value.`);
    values.push(value);
    args.splice(index, 2);
  }
  return values;
}

async function qc(argv: string[]): Promise<number> {
  const args = [...argv];
  const resolved = await resolveReferences(args);
  const references = resolved.files;
  const [profileOption] = takeOption(args, '--profile');
  const profile = profileOption ?? resolved.profile ?? undefined;
  if (resolved.describe.length) process.stderr.write(`${resolved.describe.join('\n')}\n`);
  const [section] = takeOption(args, '--section');
  const [sampleRate] = takeOption(args, '--sample-rate');
  const [bitDepth] = takeOption(args, '--bit-depth');
  const [jsonOut] = takeOption(args, '--json');
  const withChain = takeFlag(args, '--chain');
  const doCapture = takeFlag(args, '--capture');
  const [bars] = takeOption(args, '--bars');
  const [scene] = takeOption(args, '--scene');
  let [target, ...extra] = args;
  if (doCapture) {
    if (target) throw new Error('--capture records the file itself; do not also give one.');
    const captured = await captureMaster(bars, scene);
    target = captured.file_path;
  }
  if (!target) throw new Error("'qc' needs a file to analyse, or --capture.");
  if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);

  let parsedSection: { start: number; duration: number } | undefined;
  if (section) {
    const [start, duration] = section.split(':').map(Number);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration! <= 0) {
      throw new Error('--section takes start:duration in seconds, e.g. 96:30.');
    }
    parsedSection = { start: start!, duration: duration! };
  }

  let chain: ChainState | undefined;
  let decisions: Decision[] | undefined;
  if (withChain) {
    const inspection = (await post('master.inspect_chain')) as {
      track_id: number;
      readings: ChainState['readings'];
      limiter_true_peak: ChainState['limiterTruePeak'];
    };
    chain = { readings: inspection.readings, limiterTruePeak: inspection.limiter_true_peak };
    // Only this chain's history: changes on a scratch track are not Master's.
    decisions = (
      (await post('master.decisions', { track_id: inspection.track_id })) as { decisions: Decision[] }
    ).decisions;
  }

  if (references.length && references.length < 3) {
    process.stderr.write('Note: MIXING.md recommends 3-5 references; one record can mislead.\n');
  }
  const started = Date.now();
  const result = await runQc({
    target,
    references,
    profile,
    section: parsedSection,
    delivery: {
      sampleRate: sampleRate ? parseInteger('--sample-rate', sampleRate) : undefined,
      bitDepth: bitDepth ? parseInteger('--bit-depth', bitDepth) : undefined,
    },
    chain,
    decisions,
  });
  process.stdout.write(
    `${result.report}\n\n(analysed in ${((Date.now() - started) / 1000).toFixed(1)} s)\n`,
  );
  if (jsonOut) {
    const { shortTermSeries: _series, ...analysis } = result.analysis;
    writeFileSync(
      jsonOut,
      JSON.stringify({ ...result, analysis, report: result.report.split('\n') }, null, 2),
      'utf8',
    );
    process.stdout.write(`Wrote ${jsonOut}\n`);
  }
  return result.evaluation.verdict === 'FAIL' ? 2 : result.evaluation.verdict === 'REVIEW' ? 1 : 0;
}

async function compare(argv: string[]): Promise<number> {
  const args = [...argv];
  const resolved = await resolveReferences(args);
  const references = resolved.files;
  const [profileOption] = takeOption(args, '--profile');
  const profile = profileOption ?? resolved.profile ?? undefined;
  if (resolved.describe.length) process.stderr.write(`${resolved.describe.join('\n')}\n`);
  const [out] = takeOption(args, '--out');
  const [a, b, ...extra] = args;
  if (!a || !b) throw new Error("'compare' needs two files: compare <a.wav> <b.wav>.");
  if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);
  const result = await compareFiles({
    a,
    b,
    references,
    profile,
    outDir: out ?? join(process.env.TROUBLEMAKER_DATA_DIR ?? '.troublemaker', 'compare'),
  });
  process.stdout.write(`${result.report}\n`);
  return result.comparison.preferred === 'B' ? 0 : 1;
}

async function ab(argv: string[]): Promise<number> {
  const args = [...argv];
  const resolved = await resolveReferences(args);
  const references = resolved.files;
  const [profileOption] = takeOption(args, '--profile');
  const profile = profileOption ?? resolved.profile ?? undefined;
  if (resolved.describe.length) process.stderr.write(`${resolved.describe.join('\n')}\n`);
  const [reason] = takeOption(args, '--reason');
  const [bars] = takeOption(args, '--bars');
  const [scene] = takeOption(args, '--scene');
  const keep = takeFlag(args, '--keep');
  const mixRepair = takeFlag(args, '--mix-repair');
  const allowWiden = takeFlag(args, '--allow-widen');
  const [role, value, ...extra] = args;
  if (!role || value === undefined) throw new Error('Usage: ab <role> <value> --reason "<why>"');
  if (!reason) throw new Error('An A/B trial needs --reason "<the hypothesis it tests>".');
  if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);
  const numeric = Number(value);
  const result = await runAb(
    { post },
    {
      role,
      value: Number.isFinite(numeric) && value.trim() !== '' ? numeric : value,
      reason,
      bars: bars ? parseInteger('--bars', bars) : undefined,
      scene_id: scene ? parseInteger('--scene', scene) : undefined,
      references,
      profile,
      keepRegardless: keep,
      mix_repair: mixRepair,
      allow_widen: allowWiden,
    },
    (line) => process.stderr.write(`${line}\n`),
  );
  process.stdout.write(
    `${result.report}\n\nKept: ${result.kept}${result.kept === 'A' ? ' (change reverted)' : ' (change kept)'}\n`,
  );
  return 0;
}

async function fx(argv: string[]): Promise<number> {
  const args = [...argv];
  const [sub, ...rest] = args;
  switch (sub) {
    case 'list': {
      const options = [...rest];
      const [family] = takeOption(options, '--family');
      const [energy] = takeOption(options, '--energy');
      for (const e of loadCodex().effects) {
        if (family && e.family !== family) continue;
        if (energy && !e.energy.includes(energy)) continue;
        const how = e.build.method === 'unsupported' ? `not buildable (${e.availability})` : e.build.method;
        process.stdout.write(`  ${e.id.padEnd(24)} ${e.family.padEnd(12)} ${e.energy.join('/').padEnd(22)} ${how}\n`);
      }
      return 0;
    }
    case 'show': {
      const e = findEffect(rest.join(' '));
      const lines = [
        `${e.name}  (${e.id})`,
        `  also: ${e.aliases.join(', ')}`,
        `  cue: ${e.cue}`,
        `  mechanism: ${e.mechanism}`,
        `  control: ${e.control}; time scale: ${e.time_scale}; energy: ${e.energy.join(', ')}`,
        ...Object.entries(e.params ?? {}).map(([k, v]) => `  ${k}: ${v}`),
        ...(e.distinguish_from ?? []).map((d) => `  not ${d.id}: ${d.how}`),
        ...(e.mistakes ?? []).map((m) => `  mistake: ${m}`),
        `  build: ${e.build.method}${e.build.placement ? ` (${e.build.placement})` : ''}` +
          (e.build.devices ? ` - ${e.build.devices.map((d) => d.name).join(' -> ')}` : '') +
          (e.build.generator ? ` - ${e.build.generator}` : ''),
        ...(e.build.note ? [`  note: ${e.build.note}`] : []),
        ...e.references.map((r) => `  listen: ${r.track}${r.where ? ` (${r.where})` : ''} [${r.evidence === 'D' ? 'documented' : 'auditory'}]`),
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
      return 0;
    }
    case 'apply': {
      const options = [...rest];
      const dryRun = takeFlag(options, '--dry-run');
      const [track] = takeOption(options, '--track');
      const [slot] = takeOption(options, '--slot');
      const [start] = takeOption(options, '--start');
      const [bars] = takeOption(options, '--bars');
      const [length] = takeOption(options, '--length');
      const [pitch] = takeOption(options, '--pitch');
      const [root] = takeOption(options, '--root');
      const sets = takeOption(options, '--set');
      const [id, ...extra] = options;
      if (!id || !track) throw new Error('Usage: fx apply <id> --track <id> [options]');
      if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);
      const set: Record<string, number | string> = {};
      for (const pair of sets) {
        const [k, ...v] = pair.split('=');
        const raw = v.join('=');
        set[k!.trim()] = raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw.trim();
      }
      const result = await applyEffect(
        { post },
        {
          effect: id,
          track_id: parseInteger('--track', track),
          clip_slot: slot ? parseInteger('--slot', slot) : undefined,
          start_beat: start ? parseNumber('--start', start) : undefined,
          length_beats: length ? parseNumber('--length', length) : bars ? parseNumber('--bars', bars) * 4 : undefined,
          pitch: pitch ? parseInteger('--pitch', pitch) : undefined,
          root,
          set,
          dry_run: dryRun,
        },
      );
      process.stdout.write(`${result.effect} on track ${result.track_id}\n`);
      for (const step of result.steps) process.stdout.write(`  - ${step}\n`);
      for (const warning of result.warnings) process.stdout.write(`  ! ${warning}\n`);
      return 0;
    }
    case 'identify': {
      const options = [...rest];
      const [start] = takeOption(options, '--start');
      const [duration] = takeOption(options, '--duration');
      const [file] = options;
      if (!file) throw new Error('Usage: fx identify <file> [--start s] [--duration s]');
      const id = await identifyEffect(
        file,
        start ? parseNumber('--start', start) : 0,
        duration ? parseNumber('--duration', duration) : undefined,
      );
      const known = id.effect === 'unknown' ? null : findEffect(id.effect);
      process.stdout.write(
        `Sounds like: ${known ? known.name : 'no clear single effect'} (${id.confidence} confidence, auditory identification)
`,
      );
      for (const line of id.evidence) process.stdout.write(`  - ${line}
`);
      if (known) process.stdout.write(`  mechanism: ${known.mechanism}
`);
      return 0;
    }
    default:
      throw new Error('Unknown fx subcommand. Try: list, show, apply, identify.');
  }
}

async function samples(argv: string[]): Promise<number> {
  const args = [...argv];
  const loops = takeFlag(args, '--loops');
  const [genre] = takeOption(args, '--genre');
  const [character] = takeOption(args, '--character');
  const [key] = takeOption(args, '--key');
  const [pair] = takeOption(args, '--pair');
  const [part] = takeOption(args, '--part');
  const [sub, target] = args;
  if (sub === 'scan') {
    const folder = target ?? sampleLibraryConfig()?.root;
    if (!folder) throw new Error('Give a folder, or set "root" in config/sample-library.json.');
    const index = await scanSamples(folder, { onProgress: (done, total) => process.stderr.write(`\r${done}/${total}`) });
    process.stderr.write('\n');
    const roles: Record<string, number> = {};
    for (const e of index.entries) roles[e.role] = (roles[e.role] ?? 0) + 1;
    process.stdout.write(`${index.entries.length} samples in ${folder}\n${Object.entries(roles).map(([r, n]) => `  ${String(n).padStart(4)}  ${r}`).join('\n')}\n`);
    return 0;
  }
  if (sub !== 'pick' || !target) throw new Error('Usage: samples scan [folder] | samples pick <role> [--genre g] [--character a,b] [--key F] [--loops]');
  const brief = soundBrief(target, { genre, character: character?.split(',').map((w) => w.trim()) });
  const context = pair || part ? { pairTrackId: pair ? parseInteger('--pair', pair) : undefined, partTrackId: part ? parseInteger('--part', part) : undefined } : undefined;
  const found = await shortlistLocalSamples(brief, { root: key, loops, client: { post }, context });
  if (!found) throw new Error('No sample library: set "root" in config/sample-library.json.');
  process.stdout.write(`${brief.need}\n${found.context.map((n) => `  context: ${n}\n`).join('')}`);
  for (const s of found.samples) {
    process.stdout.write(`  ${s.score.toFixed(1).padStart(5)}  ${s.name.padEnd(40)} tail ${String(s.tailMs).padStart(4)} ms  attack ${String(s.attackMs).padStart(3)} ms  sub ${s.subDb} dB${s.transpose !== null ? `  transpose ${s.transpose}` : ''}\n         ${s.why.join('; ')}\n`);
  }
  return 0;
}

async function drums(argv: string[]): Promise<number> {
  const args = [...argv];
  const phrase = takeFlag(args, '--phrase');
  const humanize = takeFlag(args, '--humanize');
  const chance = takeFlag(args, '--chance');
  const laidBack = takeFlag(args, '--laid-back');
  const [energy] = takeOption(args, '--energy');
  const [variant] = takeOption(args, '--variant');
  const [swing] = takeOption(args, '--swing');
  const [bars] = takeOption(args, '--bars');
  const [seed] = takeOption(args, '--seed');
  const [track] = takeOption(args, '--track');
  const [slot] = takeOption(args, '--slot');
  const [sub, genre, ...extra] = args;
  if (!sub || !genre) throw new Error(`Usage: drums show|write <genre>. Genres: ${drumGenres().join(', ')}`);
  if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);
  const options: DrumOptions = {
    phrase,
    humanize,
    chance,
    energy: energy as Energy | undefined,
    variant: variant as Variant | undefined,
    swingPercent: swing ? parseNumber('--swing', swing) : undefined,
    feel: laidBack ? 'laid_back' : undefined,
    bars: bars ? parseInteger('--bars', bars) : undefined,
    seed: seed ? parseInteger('--seed', seed) : undefined,
  };
  const findings = checkDrumPattern(drumPattern(genre, options), genre);
  const checks = findings.length ? findings.map((f) => `  [${f.severity.toUpperCase()}] ${f.message}`).join('\n') : '  no findings';
  if (sub === 'show') {
    process.stdout.write(`${formatGrid(drumGrids(genre, options))}\n\nChecks:\n${checks}\n`);
    return 0;
  }
  if (sub !== 'write') throw new Error('Unknown drums subcommand. Try: show, write.');
  if (!track) throw new Error('drums write needs --track <id>.');
  const target = { track_id: parseInteger('--track', track), clip_slot: slot ? parseInteger('--slot', slot) : 0 };
  const written = await writeDrums({ post }, target, genre, options);
  process.stdout.write(`Wrote ${written.note_count} ${genre} notes to track ${target.track_id} slot ${target.clip_slot}.\n${written.kit}\nChecks:\n${checks}\n`);
  return 0;
}

async function arrangement(argv: string[]): Promise<number> {
  const args = [...argv];
  const dryRun = takeFlag(args, '--dry-run');
  const replace = takeFlag(args, '--replace');
  const [rolesText] = takeOption(args, '--roles');
  const [mapText] = takeOption(args, '--map');
  const [sub, style] = args;
  if (!sub || !style) throw new Error(`Usage: arrangement plan|build <style>. Styles: ${styleNames().join(', ')}`);

  if (sub === 'plan') {
    const plan = planArrangement(style, rolesText ? { roles: rolesText.split(',').map((r) => r.trim()) } : {});
    process.stdout.write(`${formatPlan(plan, checkStylePlan(style, plan))}\n`);
    return 0;
  }
  if (sub !== 'build') throw new Error('Unknown arrangement subcommand. Try: plan, build.');

  // Map tracks to roles: explicit --map role=track_id, otherwise by name,
  // using each track's slot-0 loop as its material.
  const map: Record<string, number> = {};
  for (const pair of (mapText ?? '').split(',').filter(Boolean)) {
    const [role, id] = pair.split('=');
    map[role!.trim()] = parseInteger('--map', id);
  }
  const built = await buildArrangement({ post }, { style, map, replace, dryRun });
  const roles = Object.entries(built.roles).map(([r, id]) => `${r} -> track ${id}`).join(', ');
  process.stdout.write(`${formatPlan(built.plan, built.findings)}\n\nRoles: ${roles}\n`);
  process.stdout.write(
    built.dryRun ? '[dry run] nothing placed.\n' : `Placed ${built.placed} clips on the Arrangement.\n`,
  );
  return 0;
}

async function captureMaster(
  bars: string | undefined,
  scene: string | undefined,
): Promise<{ file_path: string; seconds: number }> {
  const args: Record<string, unknown> = { bars: bars ? parseInteger('--bars', bars) : 16 };
  if (scene) args.scene_id = parseInteger('--scene', scene);
  process.stderr.write(`Capturing ${args.bars} bars of the Master output in real time...\n`);
  const result = (await post('master.capture', args)) as { file_path: string; seconds: number };
  process.stderr.write(`Captured ${result.seconds} s -> ${result.file_path}\n`);
  return result;
}

async function master(argv: string[]): Promise<number> {
  const args = [...argv];
  const [trackOption] = takeOption(args, '--track');
  const track = trackOption ? { track_id: parseInteger('--track', trackOption) } : {};
  const [sub, ...rest] = args;
  switch (sub) {
    case 'chain': {
      const chain = (await post('master.inspect_chain', track)) as {
        devices: Array<{ name: string; class_name: string }>;
        roles: Record<
          string,
          { display: string | null; range: [number, number] | null; unit: string | null; options: string[] | null }
        >;
        limiter_true_peak: string;
        warnings: string[];
      };
      process.stdout.write(
        `Master chain: ${chain.devices.map((d) => d.name).join(' -> ') || '(empty)'}\n\n`,
      );
      for (const [role, info] of Object.entries(chain.roles)) {
        const allowed = info.range
          ? `safe ${info.range[0]}..${info.range[1]} ${info.unit}`
          : `one of ${info.options!.join(' | ')}`;
        process.stdout.write(`  ${role.padEnd(18)} ${String(info.display ?? '?').padEnd(14)} ${allowed}\n`);
      }
      process.stdout.write(`\nLimiter True Peak mode: ${chain.limiter_true_peak}\n`);
      for (const warning of chain.warnings) process.stdout.write(`  ! ${warning}\n`);
      return 0;
    }
    case 'set': {
      const options = [...rest];
      const [reason] = takeOption(options, '--reason');
      const mixRepair = takeFlag(options, '--mix-repair');
      const allowWiden = takeFlag(options, '--allow-widen');
      const override = takeFlag(options, '--override');
      const [role, value] = options;
      if (!role || value === undefined) {
        throw new Error('Usage: master set <role> <value> --reason "<why>"');
      }
      if (!reason) throw new Error('Every master change needs --reason "<why>" for the audit trail.');
      const numeric = Number(value);
      const result = (await post('master.set', {
        ...track,
        role,
        value: Number.isFinite(numeric) && value.trim() !== '' ? numeric : value,
        reason,
        ...(mixRepair ? { mix_repair: true } : {}),
        ...(allowWiden ? { allow_widen: true } : {}),
        ...(override ? { override: true } : {}),
      })) as { display_before: string; display_after: string; warnings: string[] };
      process.stdout.write(`${role}: ${result.display_before} -> ${result.display_after}\n`);
      for (const warning of result.warnings) process.stdout.write(`  ${warning}\n`);
      return 0;
    }
    case 'decisions':
      print(await post('master.decisions', rest[0] ? { role: rest[0] } : {}));
      return 0;
    case 'reset':
      print(await post('master.reset_decisions', rest[0] ? { label: rest[0] } : {}));
      return 0;
    case 'checkpoint':
      if (!rest[0]) throw new Error('master checkpoint needs a label.');
      print(await post('master.checkpoint', { ...track, label: rest.join(' ') }));
      return 0;
    case 'restore':
      if (!rest[0]) throw new Error('master restore needs a checkpoint id.');
      print(await post('master.restore_checkpoint', { checkpoint_id: rest[0] }));
      return 0;
    case 'capture': {
      const options = [...rest];
      const [bars] = takeOption(options, '--bars');
      const [scene] = takeOption(options, '--scene');
      print(await captureMaster(bars, scene));
      return 0;
    }
    case 'build': {
      const options = [...rest];
      const noPreset = takeFlag(options, '--no-preset');
      const [preset] = takeOption(options, '--preset');
      print(await post('master.build_chain', { ...track, preset: noPreset ? null : (preset ?? 'clean') }));
      return 0;
    }
    case 'preset':
      if (!rest[0]) throw new Error('master preset needs a preset name, e.g. clean.');
      print(await post('master.apply_preset', { ...track, preset: rest[0] }));
      return 0;
    case 'meters':
      print(
        await post('master.meters', {
          ...track,
          ...(rest[0] ? { seconds: parseNumber('seconds', rest[0]) } : {}),
        }),
      );
      return 0;
    default:
      throw new Error(
        'Unknown master subcommand. Try: chain, set, decisions, reset, checkpoint, restore, build, preset, meters, capture.',
      );
  }
}

/**
 * The acceptance check from the plan's Milestone 1: prove the round trip to
 * Live works, and restore anything it changed.
 */
async function selftest(): Promise<number> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['bridge reachable', () => post('bridge.status')],
    ['Live connected', () => post('ping')],
    ['capabilities', () => post('live.get_capabilities')],
    ['read tempo', () => post('live.get_tempo')],
    ['read tracks', () => post('live.get_tracks')],
    ['read project state', () => post('live.get_project_state', { include_devices: false })],
  ];

  let failures = 0;
  for (const [label, run] of steps) {
    try {
      await run();
      process.stdout.write(`  PASS  ${label}\n`);
    } catch (error) {
      failures += 1;
      process.stdout.write(`  FAIL  ${label}\n        ${(error as Error).message}\n`);
    }
  }

  // Tempo round trip, restored afterwards so the user's Set is untouched.
  try {
    const { bpm } = (await post('live.get_tempo')) as { bpm: number };
    const probe = bpm >= 125 ? bpm - 1 : bpm + 1;
    await post('live.set_tempo', { bpm: probe });
    const { bpm: readBack } = (await post('live.get_tempo')) as { bpm: number };
    await post('live.set_tempo', { bpm });
    if (Math.abs(readBack - probe) > 0.01) {
      failures += 1;
      process.stdout.write(`  FAIL  tempo write (wrote ${probe}, read ${readBack})\n`);
    } else {
      process.stdout.write(`  PASS  tempo write round trip (restored to ${bpm})\n`);
    }
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL  tempo write\n        ${(error as Error).message}\n`);
  }

  // Validation must reject bad input before it reaches Live.
  try {
    await post('live.set_tempo', { bpm: 9999 });
    failures += 1;
    process.stdout.write('  FAIL  validation rejected an out-of-range tempo\n');
  } catch {
    process.stdout.write('  PASS  validation rejects an out-of-range tempo\n');
  }

  process.stdout.write(
    failures === 0
      ? '\nAll checks passed.\n'
      : `\n${failures} check${failures === 1 ? '' : 's'} failed.\n`,
  );
  return failures === 0 ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
