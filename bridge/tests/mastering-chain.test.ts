/**
 * The master-chain controller through the real bridge, against a fake Live
 * whose Master track carries a Live 11 style chain.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bridge } from '../src/server.js';
import { Logger } from '../src/logger.js';
import { parseDisplay, PRESETS, ROLES, type NumericRole } from '../src/mastering/roles.js';
import { FakeLive } from './helpers/fake-live.js';

interface Param {
  parameter_id: number;
  name: string;
  value: number;
  min: number;
  max: number;
  is_quantized: boolean;
  display_value: string;
}

/** A tiny model of a Live 11 Master chain with dB-displayed parameters. */
function chain(options: { truePeak?: boolean } = {}) {
  let nextId = 100;
  const param = (name: string, value: number, min = -24, max = 24): Param => ({
    parameter_id: nextId++,
    name,
    value,
    min,
    max,
    is_quantized: false,
    display_value: `${value.toFixed(1)} dB`,
  });
  const devices = [
    { device_id: 10, name: 'Utility', class_name: 'StereoGain', parameters: [param('Output', 0, -35, 35)] },
    { device_id: 11, name: 'EQ Eight', class_name: 'Eq8', parameters: [param('1 Gain A', 0, -15, 15)] },
    {
      device_id: 12,
      name: 'Limiter',
      class_name: 'Limiter',
      parameters: [
        param('Input Gain', 0, 0, 24),
        param('Ceiling', 0, -24, 0),
        ...(options.truePeak
          ? [{ ...param('Mode', 1, 0, 1), is_quantized: true, display_value: 'True Peak' }]
          : []),
      ],
    },
  ];
  return devices;
}

let live: FakeLive;
let bridge: Bridge;
let dataDir: string;
let devices: ReturnType<typeof chain>;

function install(chainDevices = chain()) {
  devices = chainDevices;
  live.handlers.set('live.get_tracks', () => ({ tracks: [], master_track: { track_id: 1 } }));
  live.handlers.set('live.get_devices', () => ({ devices }));
  live.handlers.set('live.get_capabilities', () => ({ device_insertion: false }));
  live.handlers.set('live.set_device_parameter_display', (_c, args) => {
    const param = devices.flatMap((d) => d.parameters).find((p) => p.parameter_id === args.parameter_id)!;
    const before = { ...param };
    param.value = args.target as number;
    param.display_value = `${param.value.toFixed(1)} dB`;
    return { achieved: param.value, before, after: { ...param } };
  });
  live.handlers.set('live.set_device_parameter_option', (_c, args) => {
    const param = devices.flatMap((d) => d.parameters).find((p) => p.parameter_id === args.parameter_id)!;
    const before = { ...param };
    param.display_value = args.option as string;
    return { before, after: { ...param } };
  });
  live.handlers.set('live.set_device_parameter', (_c, args) => {
    const param = devices.flatMap((d) => d.parameters).find((p) => p.parameter_id === args.parameter_id)!;
    param.value = args.value as number;
    param.display_value = `${param.value.toFixed(1)} dB`;
    return {};
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tm-master-'));
  live = new FakeLive();
  await live.listen();
  bridge = new Bridge({ port: 0, livePort: live.port, logger: new Logger('silent'), dataDir });
  await bridge.start();
  await bridge.transport.waitUntilReady(5_000);
  install();
});

afterEach(async () => {
  await bridge.stop();
  await live.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const set = (role: string, value: number | string, extra: Record<string, unknown> = {}) =>
  bridge.execute('master.set', { role, value, reason: 'test change', ...extra });

describe('roles', () => {
  it('gives every numeric role a sane, ordered safe range', () => {
    for (const role of ROLES) {
      if (role.kind === 'number') expect(role.range[0], role.role).toBeLessThan(role.range[1]);
      else expect(role.options.length, role.role).toBeGreaterThan(0);
    }
  });

  it('keeps every preset value inside its role limits', () => {
    for (const step of PRESETS.clean!) {
      const role = ROLES.find((r) => r.role === step.role)!;
      expect(role, step.role).toBeDefined();
      if (role.kind === 'number') {
        expect(step.value as number).toBeGreaterThanOrEqual(role.range[0]);
        expect(step.value as number).toBeLessThanOrEqual(role.range[1]);
      } else {
        expect(role.options).toContain(step.value);
      }
    }
  });

  it('keeps broad EQ within +/-2 dB unless in mix-repair mode', () => {
    const eq = ROLES.find((r) => r.role === 'eq_1_gain') as NumericRole;
    expect(eq.range).toEqual([-2, 2]);
    expect(eq.mixRepairRange).toEqual([-6, 6]);
  });

  it('parses Live displays into canonical units', () => {
    expect(parseDisplay('-1.0 dB')).toEqual({ value: -1, unit: 'dB' });
    expect(parseDisplay('1.20 kHz')).toEqual({ value: 1200, unit: 'Hz' });
    expect(parseDisplay('0.25 s')).toEqual({ value: 250, unit: 'ms' });
    // Glue's release shows bare decimals of a second.
    expect(parseDisplay('.6')).toEqual({ value: 0.6, unit: '' });
    expect(parseDisplay('Off')).toBeNull();
  });
});

describe('inspect', () => {
  it('maps devices to roles with current values', async () => {
    const result = (await bridge.execute('master.inspect_chain', {})) as any;
    expect(Object.keys(result.roles)).toEqual(
      expect.arrayContaining(['input_trim', 'eq_1_gain', 'limiter_gain', 'limiter_ceiling']),
    );
    expect(result.roles.limiter_ceiling.value).toBe(0);
    expect(result.missing_core_roles).toEqual([]);
  });

  it('reports a Live 11 Limiter as having no True Peak mode', async () => {
    const result = (await bridge.execute('master.inspect_chain', {})) as any;
    expect(result.limiter_true_peak).toBe('unavailable');
    expect(result.warnings.join(' ')).toMatch(/no True Peak mode/);
  });

  it("detects a Live 12 style Limiter's True Peak mode", async () => {
    install(chain({ truePeak: true }));
    const result = (await bridge.execute('master.inspect_chain', {})) as any;
    expect(result.limiter_true_peak).toBe('on');
  });

  it('names the missing core roles on an empty Master', async () => {
    install([]);
    const result = (await bridge.execute('master.inspect_chain', {})) as any;
    expect(result.missing_core_roles).toEqual(['input_trim', 'limiter_gain', 'limiter_ceiling']);
  });
});

describe('set', () => {
  it('writes by display value, reads back, and logs a reason', async () => {
    const result = (await set('limiter_ceiling', -1)) as any;
    expect(result).toMatchObject({ before: 0, after: -1, display_after: '-1.0 dB' });
    const log = readFileSync(join(dataDir, 'decisions.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(log[0]!)).toMatchObject({ role: 'limiter_ceiling', reason: 'test change' });
  });

  it('refuses a change without a reason', async () => {
    await expect(
      bridge.execute('master.set', { role: 'limiter_gain', value: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a value outside the safe range, before touching Live', async () => {
    live.received = [];
    await expect(set('eq_1_gain', 5)).rejects.toMatchObject({ code: 'OUT_OF_SAFE_RANGE' });
    expect(live.received.some((r) => r.command === 'live.set_device_parameter_display')).toBe(false);
  });

  it('allows a larger EQ move in mix-repair mode, with a review warning', async () => {
    const result = (await set('eq_1_gain', 4, { mix_repair: true })) as any;
    expect(result.warnings.join(' ')).toMatch(/REVIEW/);
  });

  it('warns past 3 dB of limiter drive', async () => {
    const result = (await set('limiter_gain', 3.5)) as any;
    expect(result.warnings.join(' ')).toMatch(/WARN.*3 dB/);
  });

  it('refuses a role the chain cannot provide', async () => {
    await expect(set('saturator_drive', 1)).rejects.toMatchObject({ code: 'ROLE_NOT_AVAILABLE' });
  });

  it('refuses an unknown role and lists the real ones', async () => {
    await expect(set('loudness', 1)).rejects.toMatchObject({ code: 'UNKNOWN_ROLE' });
  });

  it('stops after a control reverses direction twice, unless overridden', async () => {
    await set('input_trim', -2);
    await set('input_trim', -1);
    await expect(set('input_trim', -2)).rejects.toMatchObject({ code: 'STOP_AND_REVIEW' });
    await expect(set('input_trim', -2, { override: true })).resolves.toBeTruthy();
  });

  it('remembers decisions across a bridge restart', async () => {
    await set('input_trim', -2);
    await set('input_trim', -1);
    await bridge.stop();
    bridge = new Bridge({ port: 0, livePort: live.port, logger: new Logger('silent'), dataDir });
    await bridge.start();
    await bridge.transport.waitUntilReady(5_000);
    await expect(set('input_trim', -2)).rejects.toMatchObject({ code: 'STOP_AND_REVIEW' });
  });

  it('starts fresh after the decision log is reset', async () => {
    await set('input_trim', -2);
    await set('input_trim', -1);
    const reset = (await bridge.execute('master.reset_decisions', { label: 'next job' })) as any;
    expect(reset.cleared).toBe(2);
    await expect(set('input_trim', -2)).resolves.toBeTruthy();
  });
});

describe('option roles', () => {
  it('sets the Limiter to True Peak by name', async () => {
    install(chain({ truePeak: true }));
    devices[2]!.parameters.at(-1)!.display_value = 'Standard';
    expect(((await bridge.execute('master.inspect_chain', {})) as any).limiter_true_peak).toBe('off');
    const result = (await set('limiter_mode', 'True Peak')) as any;
    expect(result.after).toBe('True Peak');
    expect(((await bridge.execute('master.inspect_chain', {})) as any).limiter_true_peak).toBe('on');
  });

  it('refuses an option the role does not offer', async () => {
    install(chain({ truePeak: true }));
    await expect(set('limiter_mode', 'Loud')).rejects.toMatchObject({ code: 'INVALID_OPTION' });
  });

  it('refuses a number for an option role and a word for a numeric role', async () => {
    await expect(set('limiter_ceiling', 'low')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('presets', () => {
  it('applies the roles the chain provides and reports the rest', async () => {
    const result = (await bridge.execute('master.apply_preset', { preset: 'clean' })) as any;
    expect(result.applied.map((a: any) => a.role)).toEqual(
      expect.arrayContaining(['input_trim', 'limiter_gain', 'limiter_ceiling']),
    );
    expect(result.skipped.map((s: any) => s.role)).toContain('saturator_drive');
    const now = (await bridge.execute('master.inspect_chain', {})) as any;
    expect(now.roles.limiter_ceiling.value).toBe(-1);
  });

  it('is not blocked by the reversal stop', async () => {
    await set('limiter_ceiling', -2);
    await set('limiter_ceiling', -1.5);
    await expect(bridge.execute('master.apply_preset', { preset: 'clean' })).resolves.toBeTruthy();
  });
});

describe('target track', () => {
  it('inspects and writes a chain on a track other than Master', async () => {
    const seen: number[] = [];
    live.handlers.set('live.get_devices', (_c, args) => {
      seen.push(args.track_id as number);
      return { devices };
    });
    const result = (await bridge.execute('master.inspect_chain', { track_id: 42 })) as any;
    expect(result).toMatchObject({ track_id: 42, is_master: false });
    await bridge.execute('master.set', { role: 'limiter_ceiling', value: -1, reason: 'scratch', track_id: 42 });
    expect(seen.every((id) => id === 42)).toBe(true);
  });
});

describe('checkpoints', () => {
  it('restores every parameter that changed since the checkpoint', async () => {
    const checkpoint = (await bridge.execute('master.checkpoint', { label: 'clean' })) as any;
    await set('limiter_gain', 2);
    await set('limiter_ceiling', -1);
    const result = (await bridge.execute('master.restore_checkpoint', {
      checkpoint_id: checkpoint.checkpoint_id,
    })) as any;
    expect(result.restored).toBe(2);
    const chainNow = (await bridge.execute('master.inspect_chain', {})) as any;
    expect(chainNow.roles.limiter_gain.value).toBe(0);
  });
});

describe('build', () => {
  it('explains the manual steps when Live cannot insert devices', async () => {
    await expect(bridge.execute('master.build_chain', {})).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(/Live 12\.3/),
    });
  });

  it('inserts only the missing devices where Live supports insertion', async () => {
    live.handlers.set('live.get_capabilities', () => ({ device_insertion: true }));
    const inserted: string[] = [];
    live.handlers.set('live.insert_device', (_c, args) => {
      inserted.push(args.device_name as string);
      return {};
    });
    const result = (await bridge.execute('master.build_chain', {})) as any;
    expect(inserted).toEqual(['Glue Compressor', 'Saturator']);
    expect(result.preset.preset).toBe('clean');
  });

  it('can build without applying a preset', async () => {
    live.handlers.set('live.get_capabilities', () => ({ device_insertion: true }));
    live.handlers.set('live.insert_device', () => ({}));
    const result = (await bridge.execute('master.build_chain', { preset: null })) as any;
    expect(result.preset).toBeNull();
  });
});
