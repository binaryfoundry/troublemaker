/**
 * Build effects in Live from the codex recipes (agent/knowledge/effects.json).
 *
 * Deterministic: a recipe names native devices, parameter values in display
 * units or named options, and automation over the effect's span. This module
 * inserts, sets and automates exactly that, reporting every step, and refuses
 * effects the codex marks unsupported instead of improvising a substitute.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BridgeError } from './errors.js';
import {
  fill,
  impact,
  polymeterClip,
  retriggerRamp,
  risingNotes,
  toNotes,
  type Pattern,
} from '../../agent/src/patterns.js';
import { planToCommands, silenceGap } from '../../agent/src/transforms.js';
import type { Note } from './protocol.js';

export interface LiveClient {
  post(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

type ParamValue = number | string;

interface DeviceStep {
  name: string;
  params: Record<string, ParamValue>;
}

interface AutomationLane {
  device?: string;
  parameter?: string;
  mixer?: 'volume' | 'send';
  curve: 'linear' | 'exponential' | 'step';
  points: Array<{ at: number; value: ParamValue }>;
}

interface Recipe {
  method: 'devices' | 'midi' | 'unsupported';
  placement?: 'insert' | 'return';
  return_name?: string;
  source?: {
    instrument: string;
    params: Record<string, ParamValue>;
    note?: { pitch: number; sustain?: boolean };
  };
  devices?: DeviceStep[];
  automation?: AutomationLane[];
  generator?: string;
  args?: Record<string, unknown>;
  note?: string;
}

export interface EffectEntry {
  id: string;
  name: string;
  aliases: string[];
  family: string;
  cue: string;
  mechanism: string;
  control: string;
  time_scale: string;
  energy: string[];
  params?: Record<string, string>;
  distinguish_from?: Array<{ id: string; how: string }>;
  mistakes?: string[];
  build: Recipe;
  availability: string;
  references: Array<{ track: string; where: string; evidence: string }>;
}

const CODEX_PATH = fileURLToPath(new URL('../../agent/knowledge/effects.json', import.meta.url));
let codex: { effects: EffectEntry[]; energy_functions: Record<string, string> } | null = null;

export function loadCodex(path = CODEX_PATH) {
  if (!codex) codex = JSON.parse(readFileSync(path, 'utf8'));
  return codex!;
}

/** Find an effect by id, name or alias. */
export function findEffect(query: string): EffectEntry {
  const q = query.trim().toLowerCase();
  const effects = loadCodex().effects;
  const hit =
    effects.find((e) => e.id === q) ??
    effects.find((e) => e.name.toLowerCase() === q) ??
    effects.find((e) => e.aliases.some((a) => a.toLowerCase() === q));
  if (!hit) {
    const near = effects
      .filter((e) => e.id.includes(q) || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.includes(q)))
      .map((e) => e.id);
    throw new BridgeError('UNKNOWN_EFFECT', `No effect '${query}' in the codex.`, {
      suggestions: near.length ? near : effects.map((e) => e.id),
    });
  }
  return hit;
}

export interface ApplyOptions {
  effect: string;
  /** Source track: where an insert effect goes, or whose send feeds a return. */
  track_id: number;
  /** Clip on that track carrying automation or generated notes. */
  clip_slot?: number;
  /** Span of the effect in beats, inside the clip. */
  start_beat?: number;
  length_beats?: number;
  /** Parameter overrides, by device parameter name. */
  set?: Record<string, ParamValue>;
  /** For MIDI generators. */
  pitch?: number;
  root?: string;
  dry_run?: boolean;
}

export interface ApplyResult {
  effect: string;
  steps: string[];
  warnings: string[];
  track_id: number;
  created?: { track_id?: number; return_track_id?: number };
}

interface LiveDevice {
  device_id: number;
  name: string;
  parameters?: Array<{ parameter_id: number; name: string; min: number; max: number; display_min?: string | null; display_max?: string | null }>;
}

/** Exponential curves are expanded into this many segments. */
const CURVE_SEGMENTS = 8;

export async function applyEffect(client: LiveClient, options: ApplyOptions): Promise<ApplyResult> {
  const effect = findEffect(options.effect);
  const recipe = effect.build;
  const steps: string[] = [];
  const warnings: string[] = [];
  const result: ApplyResult = { effect: effect.id, steps, warnings, track_id: options.track_id };

  if (recipe.method === 'unsupported') {
    throw new BridgeError('UNSUPPORTED', `${effect.name} cannot be built here: ${recipe.note}`, {
      effect: effect.id,
      availability: effect.availability,
    });
  }
  if (recipe.note) warnings.push(recipe.note);

  const slot = options.clip_slot ?? 0;
  const start = options.start_beat ?? 0;
  const length = options.length_beats ?? 16;
  const plan = (line: string) => steps.push(options.dry_run ? `[dry run] ${line}` : line);

  // An effect with its own sound source gets its own track and clip.
  let target = options.track_id;
  if (recipe.source) {
    plan(`create a MIDI track with ${recipe.source.instrument} for ${effect.name}`);
    if (!options.dry_run) {
      const track = (await client.post('live.create_midi_track', { name: `FX ${effect.name}` })) as { track_id: number };
      target = track.track_id;
      result.created = { track_id: target };
      await client.post('live.insert_device', { track_id: target, device_name: recipe.source.instrument });
      const instrument = await lastDevice(client, target, recipe.source.instrument);
      await setParams(client, target, instrument, recipe.source.params, warnings);
      await client.post('live.create_midi_clip', {
        track_id: target, clip_slot: slot, length_beats: start + length, name: effect.name, replace_existing: true,
      });
      if (recipe.source.note?.sustain) {
        await client.post('live.add_notes', {
          track_id: target,
          clip_slot: slot,
          notes: [{ pitch: options.pitch ?? recipe.source.note.pitch, start, duration: length, velocity: 110 }],
        });
      }
    }
    result.track_id = target;
  }

  if (recipe.method === 'midi') {
    await applyGenerator(client, effect, recipe, { ...options, track_id: target, clip_slot: slot, start, length }, plan, warnings);
    return result;
  }

  // Where the devices go.
  let deviceTrack = target;
  let sendIndex: number | null = null;
  if (recipe.placement === 'return') {
    const name = recipe.return_name ?? effect.name.toUpperCase();
    plan(`use return '${name}' (create it if missing)`);
    if (!options.dry_run) {
      const tracks = (await client.post('live.get_tracks')) as { return_tracks: Array<{ track_id: number; name: string }> };
      let index = tracks.return_tracks.findIndex((t) => t.name === name);
      if (index < 0) {
        const created = (await client.post('live.create_return_track', { name })) as { track_id: number };
        const refreshed = (await client.post('live.get_tracks')) as { return_tracks: Array<{ track_id: number }> };
        index = refreshed.return_tracks.findIndex((t) => t.track_id === created.track_id);
        result.created = { ...result.created, return_track_id: created.track_id };
        deviceTrack = created.track_id;
      } else {
        deviceTrack = tracks.return_tracks[index]!.track_id;
      }
      sendIndex = index;
    }
  }

  const inserted = new Map<string, LiveDevice>();
  for (const step of recipe.devices ?? []) {
    const params = { ...step.params, ...(options.set ?? {}) };
    plan(`insert ${step.name}: ${Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (options.dry_run) continue;
    await client.post('live.insert_device', { track_id: deviceTrack, device_name: step.name });
    const device = await lastDevice(client, deviceTrack, step.name);
    inserted.set(step.name, device);
    // Overrides only apply to parameters this device actually has.
    const own = Object.fromEntries(
      Object.entries(params).filter(([k]) => k in step.params || device.parameters?.some((p) => p.name === k)),
    );
    await setParams(client, deviceTrack, device, own, warnings);
  }

  for (const lane of recipe.automation ?? []) {
    const beats = lane.points.map((p) => start + p.at * length);
    if (lane.mixer) {
      const mixer = lane.mixer === 'send' ? (sendIndex === null ? null : `send:${sendIndex}`) : 'volume';
      if (mixer === null) {
        warnings.push('Send automation needs a return placement; skipped.');
        continue;
      }
      plan(`automate ${mixer} on the source clip over beats ${start}-${start + length}`);
      if (options.dry_run) continue;
      await client.post('live.set_automation', {
        track_id: lane.mixer === 'volume' ? target : options.track_id,
        clip_slot: slot,
        mixer,
        points: expand(lane, beats).map(([beat, value]) => ({ beat, normalized: Number(value) })),
        step: lane.curve === 'step' ? 0.0625 : 0.25,
      });
      continue;
    }
    const device = inserted.get(lane.device!);
    plan(`automate ${lane.device} ${lane.parameter} (${lane.curve}) over beats ${start}-${start + length}`);
    if (options.dry_run) continue;
    if (!device) {
      warnings.push(`No ${lane.device} was inserted, so its automation was skipped.`);
      continue;
    }
    if (recipe.placement === 'return') {
      warnings.push(`Automation of ${lane.device} on a return needs a clip there; Session returns have none. Skipped.`);
      continue;
    }
    const points: Array<{ beat: number; value: number }> = [];
    for (const [beat, value] of expand(lane, beats)) {
      points.push({ beat, value: await nativeValue(client, deviceTrack, device, lane.parameter!, value) });
    }
    await client.post('live.set_automation', {
      track_id: deviceTrack,
      clip_slot: slot,
      device_id: device.device_id,
      parameter_name: lane.parameter,
      points,
      step: lane.curve === 'step' ? 0.0625 : 0.25,
    });
  }

  // A return with no send automation still needs signal.
  if (recipe.placement === 'return' && sendIndex !== null && !recipe.automation?.some((l) => l.mixer === 'send')) {
    plan(`set send ${sendIndex} on the source track to 35%`);
    if (!options.dry_run) {
      await client.post('live.set_track_send', { track_id: options.track_id, send_index: sendIndex, normalized: 0.35 });
    }
  }
  return result;
}

async function lastDevice(client: LiveClient, trackId: number, name: string): Promise<LiveDevice> {
  const { devices } = (await client.post('live.get_devices', { track_id: trackId, include_parameters: true })) as {
    devices: LiveDevice[];
  };
  const match = devices.filter((d) => d.name === name).at(-1);
  if (!match) throw new BridgeError('INSERT_FAILED', `${name} did not appear on track ${trackId} after insertion.`);
  return match;
}

async function setParams(
  client: LiveClient,
  trackId: number,
  device: LiveDevice,
  params: Record<string, ParamValue>,
  warnings: string[],
): Promise<void> {
  for (const [name, value] of Object.entries(params)) {
    try {
      if (typeof value === 'number') {
        await client.post('live.set_device_parameter_display', {
          track_id: trackId, device_id: device.device_id, parameter_name: name, target: value,
        });
      } else {
        await client.post('live.set_device_parameter_option', {
          track_id: trackId, device_id: device.device_id, parameter_name: name, option: value,
        });
      }
    } catch (error) {
      warnings.push(`${device.name} ${name}=${value}: ${(error as Error).message}`);
    }
  }
}

/** A display value (Hz, dB, %) or a named option, as the native value Live automates. */
async function nativeValue(
  client: LiveClient,
  trackId: number,
  device: LiveDevice,
  parameter: string,
  value: ParamValue,
): Promise<number> {
  if (typeof value === 'number') {
    const converted = (await client.post('live.set_device_parameter_display', {
      track_id: trackId, device_id: device.device_id, parameter_name: parameter, target: value, apply: false,
    })) as { native: number };
    return converted.native;
  }
  const p = device.parameters?.find((x) => x.name === parameter);
  if (!p) throw new BridgeError('PARAMETER_NOT_FOUND', `${device.name} has no parameter '${parameter}'.`);
  if (p.display_max === value) return p.max;
  if (p.display_min === value) return p.min;
  throw new BridgeError('INVALID_OPTION', `Cannot automate ${parameter} to '${value}': only its end states can be automated.`);
}

/**
 * Expand a lane into [beat, value] points. Exponential curves interpolate
 * geometrically between breakpoints, which is how a filter sweep should move
 * (equal ratios per step, not equal Hz).
 */
export function expand(lane: AutomationLane, beats: number[]): Array<[number, ParamValue]> {
  const out: Array<[number, ParamValue]> = [];
  lane.points.forEach((point, i) => {
    if (i === 0 || lane.curve !== 'exponential') {
      out.push([round(beats[i]!), point.value]);
      return;
    }
    const prev = lane.points[i - 1]!;
    const a = Number(prev.value);
    const b = Number(point.value);
    const geometric = a > 0 && b > 0;
    for (let s = 1; s <= CURVE_SEGMENTS; s += 1) {
      const t = s / CURVE_SEGMENTS;
      const value = geometric ? a * Math.pow(b / a, t) : a + (b - a) * t * t;
      out.push([round(beats[i - 1]! + (beats[i]! - beats[i - 1]!) * t), round(value)]);
    }
  });
  return out;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

async function applyGenerator(
  client: LiveClient,
  effect: EffectEntry,
  recipe: Recipe,
  options: ApplyOptions & { clip_slot: number; start: number; length: number },
  plan: (line: string) => void,
  warnings: string[],
): Promise<void> {
  const tempo = options.dry_run ? 124 : ((await client.post('live.get_tempo')) as { bpm: number }).bpm;
  const args = recipe.args ?? {};
  let pattern: Pattern;
  switch (recipe.generator) {
    case 'retriggerRamp':
      pattern = retriggerRamp({
        pitch: options.pitch ?? 72,
        startHz: Number(args.startHz ?? 30),
        endHz: Number(args.endHz ?? 3),
        durationBeats: options.length,
        bpm: tempo,
        offsetBeats: options.start,
        velocityEnd: args.direction === 'decelerate' ? 0.75 : 1,
      });
      break;
    case 'fill':
      pattern = fill({ pitches: [options.pitch ?? 38], beats: Math.min(options.length, 2), endBeat: options.start + options.length });
      break;
    case 'risingNotes':
      pattern = risingNotes({ root: options.root ?? 'F', startPitch: options.pitch ?? 65, beats: options.length, offsetBeats: options.start });
      break;
    case 'impact':
      pattern = impact({ pitch: options.pitch ?? 36, atBeat: options.start });
      break;
    case 'polymeterClip': {
      const clip = polymeterClip({ steps: Number(args.steps ?? 5), pitch: options.pitch ?? 42 });
      plan(`write a ${clip.length_beats}-beat polymetric clip (realigns every ${clip.realignsAfterBars} bars)`);
      if (!options.dry_run) {
        await client.post('live.create_midi_clip', {
          track_id: options.track_id, clip_slot: options.clip_slot, length_beats: clip.length_beats, name: 'Polymeter', replace_existing: true,
        });
        await client.post('live.add_notes', { track_id: options.track_id, clip_slot: options.clip_slot, notes: toNotes(clip) });
      }
      return;
    }
    case 'silenceGap': {
      plan(`clear beats ${options.start}-${options.start + options.length} on track ${options.track_id} slot ${options.clip_slot}`);
      if (options.dry_run) return;
      const { notes } = (await client.post('live.get_notes', {
        track_id: options.track_id,
        clip_slot: options.clip_slot,
      })) as { notes: Note[] };
      const edit = silenceGap(notes, options.start, options.start + options.length);
      await client.post('live.snapshot_clip', { track_id: options.track_id, clip_slot: options.clip_slot, label: 'before silence gap' })
        .catch(() => undefined);
      const commands = planToCommands(options.track_id, options.clip_slot, edit);
      if (commands.length) await client.post('transaction', { atomic: true, commands });
      warnings.push(...edit.summary);
      return;
    }
    default:
      throw new BridgeError('UNSUPPORTED', `No generator '${recipe.generator}' for ${effect.name}.`);
  }
  plan(`write ${pattern.events.length} ${effect.name} notes into track ${options.track_id} slot ${options.clip_slot}`);
  if (options.dry_run) return;
  await client.post('live.snapshot_clip', { track_id: options.track_id, clip_slot: options.clip_slot, label: `before ${effect.id}` })
    .catch(() => undefined);
  await client.post('live.add_notes', { track_id: options.track_id, clip_slot: options.clip_slot, notes: toNotes(pattern) });
}
