/**
 * The master chain controller.
 *
 * Template-first, as MIXING.md prescribes: the chain is on the Master track,
 * and the agent adjusts roles within safe ranges. On Live 12.3+ the agent
 * builds the chain itself (master.build_chain inserts the devices and applies
 * the "clean" starting preset); on Live 11 the user drags the devices in.
 * Every write is read back, checked against its target, and logged with a
 * reason, so the decision trail survives a bridge restart.
 *
 * All commands default to the Master track but accept a track_id, so a chain
 * can be built and exercised on a scratch track without touching the mix.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { BridgeError } from '../errors.js';
import type { LiveTransport } from '../transport.js';
import {
  CHAIN_ORDER,
  CORE_ROLES,
  PRESETS,
  ROLES,
  TEMPLATE_DEVICES,
  displayInRoleUnits,
  parseDisplay,
  roleSpec,
  softWarnings,
  type NumericRole,
  type OptionRole,
  type RoleSpec,
} from './roles.js';

interface LiveParameter {
  parameter_id: number;
  name: string;
  value: number;
  min: number;
  max: number;
  is_quantized: boolean;
  display_value: string | null;
  display_min?: string | null;
  display_max?: string | null;
}

interface LiveDevice {
  device_id: number;
  name: string;
  class_name: string | null;
  parameters: LiveParameter[];
}

export type TruePeakMode = 'on' | 'off' | 'unavailable' | 'no-limiter';

export interface ResolvedRole {
  role: string;
  kind: 'number' | 'option';
  unit: string | null;
  device_id: number;
  device_name: string;
  parameter_id: number;
  parameter_name: string;
  /** Engineering-unit value for numeric roles; the display string for options. */
  value: number | string | null;
  display: string | null;
  range: [number, number] | null;
  options: string[] | null;
  /** True when Live shows this parameter's numbers without a unit. */
  unitless: boolean;
  description: string;
}

export interface ChainInspection {
  track_id: number;
  is_master: boolean;
  devices: Array<{ device_id: number; name: string; class_name: string | null; position: number }>;
  roles: Record<string, ResolvedRole>;
  missing_core_roles: string[];
  /** 'unavailable' = the Limiter has no True Peak control (Live 11). */
  limiter_true_peak: TruePeakMode;
  order_ok: boolean;
  warnings: string[];
  readings: Array<{ role: string; value: number; unit: string; display: string | null }>;
}

export interface DecisionRecord {
  id: string;
  at: string;
  track_id: number;
  role: string;
  before: number | string | null;
  after: number | string | null;
  target: number | string;
  unit: string | null;
  display_before: string | null;
  display_after: string | null;
  reason: string;
  override: boolean;
  /** Set when a preset made this change; presets reset the reversal count. */
  preset?: string;
}

export interface ChainCheckpoint {
  checkpoint_id: string;
  label: string;
  created_at: string;
  track_id: number;
  parameters: Array<{
    device_id: number;
    device_name: string;
    parameter_id: number;
    name: string;
    value: number;
    display: string | null;
  }>;
}

export interface SetArgs {
  role: string;
  value: number | string;
  reason: string;
  mix_repair?: boolean;
  allow_widen?: boolean;
  override?: boolean;
  track_id?: number;
  /** Internal: the preset making this change. */
  preset?: string;
}

const REVERSALS_BEFORE_STOP = 2;

export class MasterChain {
  private readonly dataDir: string;
  private readonly logPath: string;
  private decisions: DecisionRecord[] = [];
  private checkpoints = new Map<string, ChainCheckpoint>();

  constructor(
    private readonly transport: LiveTransport,
    dataDir = process.env.TROUBLEMAKER_DATA_DIR ?? '.troublemaker',
  ) {
    this.dataDir = dataDir;
    this.logPath = join(dataDir, 'decisions.jsonl');
    this.loadDecisions();
  }

  // -- target track -------------------------------------------------------

  private async masterTrackId(): Promise<number> {
    const tracks = (await this.transport.send('live.get_tracks')) as {
      master_track: { track_id: number };
    };
    return tracks.master_track.track_id;
  }

  private async target(trackId?: number): Promise<{ trackId: number; isMaster: boolean }> {
    const master = await this.masterTrackId();
    return { trackId: trackId ?? master, isMaster: (trackId ?? master) === master };
  }

  private async devicesOn(trackId: number): Promise<LiveDevice[]> {
    const result = (await this.transport.send('live.get_devices', {
      track_id: trackId,
      include_parameters: true,
    })) as { devices: LiveDevice[] };
    return result.devices;
  }

  // -- inspection ---------------------------------------------------------

  async inspect(trackId?: number): Promise<ChainInspection> {
    const target = await this.target(trackId);
    const devices = await this.devicesOn(target.trackId);
    const roles: Record<string, ResolvedRole> = {};
    const warnings: string[] = [];

    for (const spec of ROLES) {
      const resolved = resolveRole(spec, devices);
      if (resolved) roles[spec.role] = resolved;
    }

    const missing = CORE_ROLES.filter((role) => !roles[role]);
    if (missing.length) {
      warnings.push(
        `Missing core roles: ${missing.join(', ')}. Run master.build_chain (Live 12.3+), or load ` +
          'Utility -> EQ Eight -> Glue Compressor -> Saturator -> Limiter by hand.',
      );
    }

    const classes = devices.map((d) => d.class_name ?? '');
    const positions = CHAIN_ORDER.map((alternatives) =>
      classes.findIndex((c) => alternatives.split('|').includes(c)),
    ).filter((p) => p >= 0);
    const orderOk = positions.every((p, i) => i === 0 || p > positions[i - 1]!);
    if (!orderOk) warnings.push('Chain order differs from Utility -> EQ -> Glue -> Saturator -> Limiter.');
    const limiterIndex = classes.lastIndexOf('Limiter');
    if (limiterIndex >= 0 && limiterIndex !== devices.length - 1) {
      warnings.push('The Limiter is not the last device; anything after it can push past the ceiling.');
    }

    const limiterTruePeak = detectTruePeak(devices);
    if (limiterTruePeak === 'unavailable') {
      warnings.push(
        "The Limiter exposes no True Peak mode (Live 11's Limiter has none). The true-peak ceiling " +
          'is enforced by measuring the exported file; Live 12 adds the mode.',
      );
    } else if (limiterTruePeak === 'off') {
      warnings.push("The Limiter's True Peak mode is off. Set limiter_mode to 'True Peak' for masters.");
    }

    return {
      track_id: target.trackId,
      is_master: target.isMaster,
      devices: devices.map((d, position) => ({
        device_id: d.device_id,
        name: d.name,
        class_name: d.class_name,
        position,
      })),
      roles,
      missing_core_roles: missing,
      limiter_true_peak: limiterTruePeak,
      order_ok: orderOk,
      warnings,
      readings: Object.values(roles)
        .filter((r) => r.kind === 'number' && typeof r.value === 'number')
        .map((r) => ({ role: r.role, value: r.value as number, unit: r.unit!, display: r.display })),
    };
  }

  // -- writes -------------------------------------------------------------

  async set(args: SetArgs): Promise<Record<string, unknown>> {
    const spec = roleSpec(args.role);
    if (!spec) {
      throw new BridgeError('UNKNOWN_ROLE', `No mastering role '${args.role}'.`, {
        available_roles: ROLES.map((r) => r.role),
      });
    }
    const chain = await this.inspect(args.track_id);
    const resolved = chain.roles[args.role];
    if (!resolved) {
      throw new BridgeError(
        'ROLE_NOT_AVAILABLE',
        `The chain has no device providing '${args.role}' (needs ${spec.deviceClasses.join(' or ')}).`,
        { available_roles: Object.keys(chain.roles) },
      );
    }
    return spec.kind === 'option'
      ? this.setOption(spec, resolved, chain.track_id, args)
      : this.setNumber(spec, resolved, chain.track_id, args);
  }

  private async setNumber(
    spec: NumericRole,
    resolved: ResolvedRole,
    trackId: number,
    args: SetArgs,
  ): Promise<Record<string, unknown>> {
    if (typeof args.value !== 'number') {
      throw new BridgeError('VALIDATION_FAILED', `${spec.role} takes a number in ${spec.unit}.`);
    }
    const value = args.value;
    const range =
      (args.allow_widen && spec.widenRange) || (args.mix_repair && spec.mixRepairRange) || spec.range;
    if (value < range[0] || value > range[1]) {
      throw new BridgeError(
        'OUT_OF_SAFE_RANGE',
        `${spec.role} = ${value} ${spec.unit} is outside the safe range ` +
          `${range[0]} to ${range[1]} ${spec.unit}.` +
          (spec.mixRepairRange && !args.mix_repair
            ? ' Larger moves need mix_repair - and usually belong in the mix.'
            : '') +
          (spec.widenRange && !args.allow_widen ? ' Widening needs allow_widen.' : ''),
        { role: spec.role, safe_range: range, unit: spec.unit },
      );
    }

    const before = typeof resolved.value === 'number' ? resolved.value : null;
    if (before !== null) {
      const reversals = countRoleReversals([
        ...this.decisionsFor(spec.role, trackId),
        { before, after: value },
      ]);
      if (reversals >= REVERSALS_BEFORE_STOP && !args.override) {
        throw new BridgeError(
          'STOP_AND_REVIEW',
          `${spec.role} would reverse direction ${reversals} times. Freeze processing: this usually ` +
            'means a room anomaly or an unstable loop. Get independent monitoring evidence, then ' +
            'pass override=true or reset the decision log for a new job.',
          { role: spec.role, reversals, history: this.decisionsFor(spec.role, trackId) },
        );
      }
    }

    // Live shows some values without a unit (Glue's release ".6" is 0.6 s);
    // the search on the Live side compares displayed numbers, so convert.
    const displayTarget = resolved.unitless && spec.unitlessScale ? value / spec.unitlessScale : value;

    const result = (await this.transport.send('live.set_device_parameter_display', {
      track_id: trackId,
      device_id: resolved.device_id,
      parameter_id: resolved.parameter_id,
      target: displayTarget,
    })) as { before: LiveParameter; after: LiveParameter };

    const achieved = displayInRoleUnits(spec, result.after.display_value) ?? value;
    const span = Math.abs(range[1] - range[0]) || 1;
    const tolerance = Math.max(0.05, span * 0.01);
    const warnings = softWarnings(spec.role, achieved);
    if (Math.abs(achieved - value) > tolerance) {
      warnings.push(
        `NOTE: Live settled on ${achieved} ${spec.unit} (${result.after.display_value}), the nearest step to ${value}.`,
      );
    }

    const record = this.record(spec.role, trackId, {
      before: before ?? achieved,
      after: achieved,
      target: value,
      unit: spec.unit,
      display_before: result.before.display_value,
      display_after: result.after.display_value,
      reason: args.reason,
      override: Boolean(args.override),
      ...(args.preset ? { preset: args.preset } : {}),
    });
    return {
      role: spec.role,
      device: resolved.device_name,
      parameter: resolved.parameter_name,
      before: record.before,
      after: record.after,
      unit: spec.unit,
      display_before: record.display_before,
      display_after: record.display_after,
      reason: args.reason,
      warnings,
    };
  }

  private async setOption(
    spec: OptionRole,
    resolved: ResolvedRole,
    trackId: number,
    args: SetArgs,
  ): Promise<Record<string, unknown>> {
    const wanted = String(args.value);
    const option = spec.options.find((o) => o.toLowerCase() === wanted.toLowerCase());
    if (!option) {
      throw new BridgeError(
        'INVALID_OPTION',
        `${spec.role} accepts ${spec.options.map((o) => `'${o}'`).join(', ')}; got '${wanted}'.`,
        { role: spec.role, options: spec.options },
      );
    }
    const result = (await this.transport.send('live.set_device_parameter_option', {
      track_id: trackId,
      device_id: resolved.device_id,
      parameter_id: resolved.parameter_id,
      option,
      aliases: spec.aliases?.[option] ?? [],
    })) as { before: LiveParameter; after: LiveParameter };

    this.record(spec.role, trackId, {
      before: result.before.display_value,
      after: result.after.display_value,
      target: option,
      unit: null,
      display_before: result.before.display_value,
      display_after: result.after.display_value,
      reason: args.reason,
      override: Boolean(args.override),
      ...(args.preset ? { preset: args.preset } : {}),
    });
    return {
      role: spec.role,
      device: resolved.device_name,
      parameter: resolved.parameter_name,
      before: result.before.display_value,
      after: result.after.display_value,
      display_before: result.before.display_value,
      display_after: result.after.display_value,
      reason: args.reason,
      warnings: softWarnings(spec.role, option),
    };
  }

  /** Apply a named starting preset, skipping roles the chain cannot provide. */
  async applyPreset(name: string, trackId?: number): Promise<Record<string, unknown>> {
    const preset = PRESETS[name];
    if (!preset) {
      throw new BridgeError('UNKNOWN_PRESET', `No preset '${name}'.`, { presets: Object.keys(PRESETS) });
    }
    const chain = await this.inspect(trackId);
    const applied: Array<{ role: string; display: string | null }> = [];
    const skipped: Array<{ role: string; reason: string }> = [];
    for (const step of preset) {
      if (!chain.roles[step.role]) {
        skipped.push({ role: step.role, reason: 'no device on the chain provides it' });
        continue;
      }
      try {
        const result = (await this.set({
          role: step.role,
          value: step.value,
          reason: `preset '${name}': ${step.why}`,
          track_id: chain.track_id,
          // Presets reset to a known start; they are not an optimiser step.
          override: true,
          preset: name,
        })) as { display_after: string | null };
        applied.push({ role: step.role, display: result.display_after });
      } catch (error) {
        skipped.push({ role: step.role, reason: (error as Error).message });
      }
    }
    return { preset: name, track_id: chain.track_id, applied, skipped };
  }

  // -- decision log -------------------------------------------------------

  private record(
    role: string,
    trackId: number,
    fields: Omit<DecisionRecord, 'id' | 'at' | 'role' | 'track_id'>,
  ): DecisionRecord {
    const record: DecisionRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      track_id: trackId,
      role,
      ...fields,
    };
    this.decisions.push(record);
    mkdirSync(this.dataDir, { recursive: true });
    appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  private decisionsFor(role: string, trackId?: number): DecisionRecord[] {
    return this.decisions.filter(
      (d) => d.role === role && (trackId === undefined || d.track_id === undefined || d.track_id === trackId),
    );
  }

  listDecisions(role?: string, trackId?: number): DecisionRecord[] {
    return this.decisions.filter(
      (d) =>
        (role === undefined || d.role === role) &&
        (trackId === undefined || d.track_id === undefined || d.track_id === trackId),
    );
  }

  /** Start a new job: archive the log so reversal counting starts fresh. */
  resetDecisions(label?: string): { archived: string | null; cleared: number } {
    const cleared = this.decisions.length;
    let archived: string | null = null;
    if (existsSync(this.logPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      archived = join(this.dataDir, `decisions-${label ? `${slug(label)}-` : ''}${stamp}.jsonl`);
      renameSync(this.logPath, archived);
    }
    this.decisions = [];
    return { archived, cleared };
  }

  private loadDecisions(): void {
    if (!existsSync(this.logPath)) return;
    const lines = readFileSync(this.logPath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        this.decisions.push(JSON.parse(line) as DecisionRecord);
      } catch {
        // A torn final line from a crash; skip it rather than refuse to start.
      }
    }
  }

  // -- checkpoints --------------------------------------------------------

  async checkpoint(label: string, trackId?: number): Promise<ChainCheckpoint> {
    const target = await this.target(trackId);
    const devices = await this.devicesOn(target.trackId);
    const checkpoint: ChainCheckpoint = {
      checkpoint_id: randomUUID(),
      label,
      created_at: new Date().toISOString(),
      track_id: target.trackId,
      parameters: devices.flatMap((d) =>
        d.parameters.map((p) => ({
          device_id: d.device_id,
          device_name: d.name,
          parameter_id: p.parameter_id,
          name: p.name,
          value: p.value,
          display: p.display_value,
        })),
      ),
    };
    this.checkpoints.set(checkpoint.checkpoint_id, checkpoint);
    mkdirSync(join(this.dataDir, 'checkpoints'), { recursive: true });
    writeFileSync(
      join(this.dataDir, 'checkpoints', `${slug(label)}-${checkpoint.checkpoint_id.slice(0, 8)}.json`),
      JSON.stringify(checkpoint, null, 2),
      'utf8',
    );
    return checkpoint;
  }

  listCheckpoints(): Array<Omit<ChainCheckpoint, 'parameters'> & { parameter_count: number }> {
    return [...this.checkpoints.values()].map(({ parameters, ...rest }) => ({
      ...rest,
      parameter_count: parameters.length,
    }));
  }

  async restore(checkpointId: string): Promise<Record<string, unknown>> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new BridgeError('CHECKPOINT_NOT_FOUND', `No checkpoint '${checkpointId}' in this bridge session.`, {
        available: [...this.checkpoints.keys()],
      });
    }
    const devices = await this.devicesOn(checkpoint.track_id);
    const live = new Map(devices.flatMap((d) => d.parameters.map((p) => [p.parameter_id, p] as const)));
    let restored = 0;
    const skipped: string[] = [];
    for (const saved of checkpoint.parameters) {
      const current = live.get(saved.parameter_id);
      if (!current) {
        skipped.push(`${saved.device_name}/${saved.name} (device no longer present)`);
        continue;
      }
      if (current.value === saved.value) continue;
      try {
        await this.transport.send('live.set_device_parameter', {
          track_id: checkpoint.track_id,
          device_id: saved.device_id,
          parameter_id: saved.parameter_id,
          value: saved.value,
        });
        restored += 1;
      } catch (error) {
        skipped.push(`${saved.device_name}/${saved.name}: ${(error as Error).message}`);
      }
    }
    return { checkpoint_id: checkpointId, label: checkpoint.label, restored, skipped };
  }

  // -- Live 12.3+ ---------------------------------------------------------

  /**
   * Insert the template chain (only the devices that are missing) and apply
   * a starting preset. Fully agentic on Live 12.3+; on earlier versions it
   * explains the manual steps instead of pretending.
   */
  async buildChain(options: { trackId?: number; preset?: string | null } = {}): Promise<Record<string, unknown>> {
    const caps = (await this.transport.send('live.get_capabilities')) as { device_insertion?: boolean };
    if (!caps.device_insertion) {
      throw new BridgeError(
        'UNSUPPORTED',
        'This Live version cannot insert devices through its API (added in Live 12.3, native devices only). ' +
          'Drag Utility, EQ Eight, Glue Compressor (or Compressor), Saturator and Limiter onto the Master ' +
          'track in that order, then run master.inspect_chain.',
        { template: TEMPLATE_DEVICES.map((d) => d.name) },
      );
    }
    const target = await this.target(options.trackId);
    const present = new Set((await this.devicesOn(target.trackId)).map((d) => d.class_name));
    const inserted: string[] = [];
    for (const device of TEMPLATE_DEVICES) {
      if (present.has(device.className)) continue;
      if (device.className === 'GlueCompressor' && present.has('Compressor2')) continue;
      await this.transport.send('live.insert_device', {
        track_id: target.trackId,
        device_name: device.name,
      });
      inserted.push(device.name);
    }
    const preset = options.preset === undefined ? 'clean' : options.preset;
    const presetResult = preset ? await this.applyPreset(preset, target.trackId) : null;
    return { inserted, preset: presetResult, chain: await this.inspect(target.trackId) };
  }

  // -- meters -------------------------------------------------------------

  async meters(seconds: number, trackId?: number): Promise<Record<string, unknown>> {
    const target = await this.target(trackId);
    const samples: Array<{ left: number; right: number }> = [];
    const deadline = Date.now() + seconds * 1000;
    let playing = false;
    while (Date.now() < deadline) {
      const reading = (await this.transport.send('live.get_meters', { track_id: target.trackId })) as {
        left: number | null;
        right: number | null;
        playing: boolean;
      };
      playing = playing || reading.playing;
      if (reading.left !== null && reading.right !== null) {
        samples.push({ left: reading.left, right: reading.right });
      }
    }
    const max = (key: 'left' | 'right') => Math.max(0, ...samples.map((s) => s[key]));
    return {
      samples: samples.length,
      playing,
      max_left: max('left'),
      max_right: max('right'),
      note:
        "Live's display meters (0-1), not loudness. Use QC on an exported file for LUFS and true peak.",
    };
  }
}

function resolveRole(spec: RoleSpec, devices: LiveDevice[]): ResolvedRole | null {
  for (const className of spec.deviceClasses) {
    // The last matching device: a chain's final Limiter is the one that matters.
    const device = devices.filter((d) => d.class_name === className).at(-1);
    if (!device) continue;
    for (const candidate of spec.parameterNames) {
      const parameter = device.parameters.find(
        (p) => p.name.trim().toLowerCase() === candidate.toLowerCase(),
      );
      if (!parameter) continue;
      return {
        role: spec.role,
        kind: spec.kind,
        unit: spec.kind === 'number' ? spec.unit : null,
        device_id: device.device_id,
        device_name: device.name,
        parameter_id: parameter.parameter_id,
        parameter_name: parameter.name,
        value:
          spec.kind === 'number'
            ? numericValue(spec, parameter)
            : parameter.display_value,
        display: parameter.display_value,
        range: spec.kind === 'number' ? spec.range : null,
        options: spec.kind === 'option' ? spec.options : null,
        // The current value may show a named state ("A" for auto), so take
        // the unit from whichever display is numeric.
        unitless:
          [parameter.display_value, parameter.display_min, parameter.display_max]
            .map((d) => parseDisplay(d))
            .find((p) => p !== null)?.unit === '',
        description: spec.description,
      };
    }
  }
  return null;
}

/** A numeric role's value, scaling unitless displays by the role's unit hint. */
function numericValue(spec: NumericRole, parameter: LiveParameter): number | null {
  const parsed = parseDisplay(parameter.display_value);
  if (!parsed) return null;
  const hint = [parameter.display_min, parameter.display_max]
    .map((d) => parseDisplay(d))
    .find((p) => p !== null);
  const unitless = parsed.unit === '' && (hint?.unit ?? '') === '';
  const scale = unitless && spec.unitlessScale ? spec.unitlessScale : 1;
  return Math.round(parsed.value * scale * 1000) / 1000;
}

/** Whether the final Limiter has a True Peak control, and its state. */
function detectTruePeak(devices: LiveDevice[]): TruePeakMode {
  const limiter = devices.filter((d) => d.class_name === 'Limiter').at(-1);
  if (!limiter) return 'no-limiter';
  for (const p of limiter.parameters) {
    if (/true\s*peak/i.test(p.name)) return p.value > 0 ? 'on' : 'off';
    if (/^mode$/i.test(p.name.trim()) && p.display_value) {
      return /true\s*peak/i.test(p.display_value) ? 'on' : 'off';
    }
  }
  return 'unavailable';
}

function countRoleReversals(
  records: Array<{ before: unknown; after: unknown; preset?: string }>,
): number {
  let reversals = 0;
  let last = 0;
  for (const record of records) {
    if (record.preset) {
      reversals = 0;
      last = 0;
      continue;
    }
    if (typeof record.before !== 'number' || typeof record.after !== 'number') continue;
    const direction = Math.sign(record.after - record.before);
    if (direction === 0) continue;
    if (last !== 0 && direction !== last) reversals += 1;
    last = direction;
  }
  return reversals;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'checkpoint';
}
