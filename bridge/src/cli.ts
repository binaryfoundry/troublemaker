#!/usr/bin/env node
/**
 * ableton-agent - a thin CLI over the bridge's HTTP API.
 *
 * It talks to a running bridge rather than opening its own connection to
 * Live, so the CLI and an agent can both be connected at once.
 */

import { COMMANDS } from './commands/registry.js';

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

    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
      return 2;
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
