/**
 * Runtime validation for every command before it reaches Live.
 *
 * LLM-generated JSON is never trusted: pitches, velocities, beat positions
 * and durations are all bounds-checked here, and unknown keys are rejected
 * so a typo becomes a clear error instead of a silently ignored argument.
 */

import { z } from 'zod';

import { ValidationError } from './errors.js';
import { PITCH_MAX, PITCH_MIN, VELOCITY_MAX, VELOCITY_MIN } from './protocol.js';

export const MAX_BEAT = 4096;
export const MAX_NOTES_PER_CALL = 8192;

const handle = z.number().int().nonnegative();
const beat = z.number().finite().min(0).max(MAX_BEAT);
const positiveBeats = z.number().finite().gt(0).max(MAX_BEAT);
const pitch = z.number().int().min(PITCH_MIN).max(PITCH_MAX);
const velocity = z.number().finite().min(VELOCITY_MIN).max(VELOCITY_MAX);
const unitInterval = z.number().finite().min(0).max(1);
const nonEmptyName = z.string().trim().min(1).max(256);

export const noteSchema = z
  .object({
    pitch,
    start: beat,
    duration: positiveBeats,
    velocity: velocity.default(100),
    mute: z.boolean().optional(),
    probability: unitInterval.optional(),
    /** Accepted and ignored on write, so a read result can be written back. */
    note_id: z.number().int().nullable().optional(),
  })
  .strict();

export const noteUpdateSchema = z
  .object({
    note_id: z.number().int(),
    pitch: pitch.optional(),
    start: beat.optional(),
    duration: positiveBeats.optional(),
    velocity: velocity.optional(),
    mute: z.boolean().optional(),
    probability: unitInterval.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 1,
    'An update must change at least one property besides note_id.',
  );

const noteArray = z.array(noteSchema).max(MAX_NOTES_PER_CALL);

/** A parameter write takes a native value or a normalized one, never neither. */
const parameterValueFields = {
  value: z.number().finite().optional(),
  normalized: unitInterval.optional(),
};

const NEEDS_A_VALUE = "Provide either 'value' (native units) or 'normalized' (0.0-1.0).";

function hasAValue(v: { value?: number; normalized?: number }): boolean {
  return v.value !== undefined || v.normalized !== undefined;
}

const trackRef = z.object({ track_id: handle });
const clipRef = z.object({ track_id: handle, clip_slot: z.number().int().min(0).max(511) });
const deviceRef = z.object({ track_id: handle, device_id: handle });
const parameterRef = z.object({
  track_id: handle,
  device_id: handle,
  parameter_id: handle.optional(),
  parameter_name: z.string().min(1).optional(),
});

const empty = z.object({}).strict();

const automationPoint = z
  .object({
    beat,
    value: z.number().finite().optional(),
    normalized: unitInterval.optional(),
  })
  .strict()
  .refine(
    (p) => p.value !== undefined || p.normalized !== undefined,
    "Each point needs 'value' or 'normalized'.",
  );

export const schemas = {
  // -- project ----------------------------------------------------------
  'ping': empty,
  'live.get_capabilities': empty,
  'live.get_project_state': z
    .object({
      include_devices: z.boolean().optional(),
      include_return_tracks: z.boolean().optional(),
    })
    .strict(),
  'live.get_tempo': empty,
  'live.set_tempo': z.object({ bpm: z.number().finite().min(20).max(999) }).strict(),
  'live.get_time_signature': empty,
  'live.set_time_signature': z
    .object({
      numerator: z.number().int().min(1).max(99),
      denominator: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(4),
        z.literal(8),
        z.literal(16),
      ]),
    })
    .strict(),
  'live.get_transport': empty,
  'live.play': empty,
  'live.stop': empty,
  'live.continue_playing': empty,
  'live.stop_all_clips': empty,
  'live.set_metronome': z.object({ enabled: z.boolean() }).strict(),
  'live.undo': empty,
  'live.redo': empty,

  // -- tracks -----------------------------------------------------------
  'live.get_tracks': z
    .object({
      include_devices: z.boolean().optional(),
      include_clips: z.boolean().optional(),
    })
    .strict(),
  'live.get_track': trackRef.strict(),
  'live.create_midi_track': z
    .object({ name: nonEmptyName.optional(), index: z.number().int().min(0).optional() })
    .strict(),
  'live.rename_track': trackRef.extend({ name: nonEmptyName }).strict(),
  'live.set_track_volume': trackRef.extend(parameterValueFields).strict().refine(hasAValue, NEEDS_A_VALUE),
  'live.set_track_pan': trackRef.extend(parameterValueFields).strict().refine(hasAValue, NEEDS_A_VALUE),
  'live.set_track_send': trackRef
    .extend({ send_index: z.number().int().min(0).max(63) })
    .extend(parameterValueFields)
    .strict()
    .refine(hasAValue, NEEDS_A_VALUE),
  'live.set_track_mute': trackRef.extend({ enabled: z.boolean() }).strict(),
  'live.set_track_solo': trackRef.extend({ enabled: z.boolean() }).strict(),
  'live.set_track_arm': trackRef.extend({ enabled: z.boolean() }).strict(),

  // -- clips ------------------------------------------------------------
  'live.get_clip_slots': trackRef.strict(),
  'live.get_clip': clipRef.strict(),
  'live.create_midi_clip': clipRef
    .extend({
      length_beats: positiveBeats,
      name: nonEmptyName.optional(),
      replace_existing: z.boolean().optional(),
    })
    .strict(),
  'live.delete_clip': clipRef.strict(),
  'live.set_clip_name': clipRef.extend({ name: z.string().max(256) }).strict(),
  'live.set_clip_loop': clipRef
    .extend({
      start: beat.optional(),
      length: positiveBeats.optional(),
      end: beat.optional(),
      looping: z.boolean().optional(),
    })
    .strict()
    .refine(
      (v) => v.length !== undefined || v.end !== undefined,
      "Provide either 'length' or 'end' (in beats).",
    ),
  'live.fire_clip': clipRef.strict(),
  'live.stop_clip': trackRef.strict(),

  // -- notes ------------------------------------------------------------
  'live.get_notes': clipRef
    .extend({
      from_time: beat.optional(),
      time_span: positiveBeats.optional(),
      from_pitch: pitch.optional(),
      pitch_span: z.number().int().min(1).max(128).optional(),
    })
    .strict(),
  'live.add_notes': clipRef.extend({ notes: noteArray }).strict(),
  'live.replace_notes': clipRef.extend({ notes: noteArray }).strict(),
  'live.remove_notes': clipRef
    .extend({
      note_ids: z.array(z.number().int()).optional(),
      from_time: beat.optional(),
      time_span: positiveBeats.optional(),
      from_pitch: pitch.optional(),
      pitch_span: z.number().int().min(1).max(128).optional(),
    })
    .strict(),
  'live.update_notes': clipRef
    .extend({ updates: z.array(noteUpdateSchema).max(MAX_NOTES_PER_CALL) })
    .strict(),

  // -- scenes -----------------------------------------------------------
  'live.get_scenes': empty,
  'live.get_scene': z.object({ scene_id: handle }).strict(),
  'live.create_scene': z
    .object({ index: z.number().int().min(-1).optional(), name: nonEmptyName.optional() })
    .strict(),
  'live.rename_scene': z.object({ scene_id: handle, name: nonEmptyName }).strict(),
  'live.fire_scene': z.object({ scene_id: handle }).strict(),

  // -- devices ----------------------------------------------------------
  'live.get_devices': trackRef.extend({ include_parameters: z.boolean().optional() }).strict(),
  'live.get_device': deviceRef.strict(),
  'live.get_device_parameters': deviceRef.strict(),
  'live.set_device_parameter': parameterRef
    .extend(parameterValueFields)
    .strict()
    .refine(hasAValue, NEEDS_A_VALUE)
    .refine(
      (v) => v.parameter_id !== undefined || v.parameter_name !== undefined,
      "Identify the parameter with 'parameter_id' or 'parameter_name'.",
    ),
  'live.set_device_active': deviceRef.extend({ enabled: z.boolean() }).strict(),

  // -- automation -------------------------------------------------------
  'live.get_automation': clipRef
    .extend({
      device_id: handle,
      parameter_id: handle.optional(),
      parameter_name: z.string().min(1).optional(),
      resolution: positiveBeats.optional(),
    })
    .strict(),
  'live.set_automation': clipRef
    .extend({
      device_id: handle,
      parameter_id: handle.optional(),
      parameter_name: z.string().min(1).optional(),
      points: z.array(automationPoint).min(1).max(1024),
      step: positiveBeats.optional(),
      clear_first: z.boolean().optional(),
    })
    .strict(),
  'live.clear_automation': clipRef
    .extend({
      device_id: handle,
      parameter_id: handle.optional(),
      parameter_name: z.string().min(1).optional(),
      from_beat: beat.optional(),
      to_beat: beat.optional(),
    })
    .strict(),

  // -- selection --------------------------------------------------------
  'live.get_selected_track': empty,
  'live.get_selected_scene': empty,
  'live.get_selected_clip': empty,
  'live.get_selected_device': empty,
  'live.select_track': trackRef.strict(),
  'live.select_clip_slot': clipRef.strict(),

  // -- mastering (Live side) ---------------------------------------------
  'live.set_device_parameter_display': parameterRef
    .extend({ target: z.number().finite(), apply: z.boolean().optional() })
    .strict()
    .refine(
      (v) => v.parameter_id !== undefined || v.parameter_name !== undefined,
      "Identify the parameter with 'parameter_id' or 'parameter_name'.",
    ),
  'live.set_device_parameter_option': parameterRef
    .extend({ option: z.string().min(1), aliases: z.array(z.string()).optional() })
    .strict()
    .refine(
      (v) => v.parameter_id !== undefined || v.parameter_name !== undefined,
      "Identify the parameter with 'parameter_id' or 'parameter_name'.",
    ),
  'live.insert_device': trackRef
    .extend({ device_name: nonEmptyName, index: z.number().int().min(0).optional() })
    .strict(),
  'live.get_meters': trackRef.strict(),
  'live.place_clip_in_arrangement': clipRef.extend({ beat }).strict(),
  'live.get_arrangement_clips': trackRef.strict(),
  'live.clear_arrangement': trackRef.strict(),
  'live.create_return_track': z.object({ name: nonEmptyName.optional() }).strict(),
  'live.set_song_time': z.object({ beat }).strict(),

  // -- capture ----------------------------------------------------------
  'live.create_audio_track': z
    .object({ name: nonEmptyName.optional(), index: z.number().int().min(0).optional() })
    .strict(),
  'live.get_input_routing': trackRef.strict(),
  'live.set_input_routing': trackRef.extend({ routing: z.string().min(1) }).strict(),
  'live.set_monitoring': trackRef
    .extend({ state: z.enum(['in', 'auto', 'off']) })
    .strict(),
  'live.record_clip': clipRef.extend({ length_beats: positiveBeats }).strict(),
  'live.get_clip_slot_status': clipRef.strict(),
  'live.get_record_settings': empty,
  'master.capture': z
    .object({
      bars: z.number().int().min(1).max(256).optional(),
      seconds: z.number().min(2).max(600).optional(),
      scene_id: handle.optional(),
      start_beat: beat.optional(),
    })
    .strict()
    .refine((v) => !(v.bars !== undefined && v.seconds !== undefined), 'Give bars or seconds, not both.')
    .refine(
      (v) => !(v.scene_id !== undefined && v.start_beat !== undefined),
      'Give scene_id or start_beat, not both.',
    ),

  // -- mastering (bridge side) -------------------------------------------
  'master.inspect_chain': z.object({ track_id: handle.optional() }).strict(),
  'master.set': z
    .object({
      role: z.string().min(1),
      value: z.union([z.number().finite(), z.string().min(1)]),
      track_id: handle.optional(),
      reason: z.string().trim().min(3, 'Every master change needs a reason for the audit trail.').max(500),
      mix_repair: z.boolean().optional(),
      allow_widen: z.boolean().optional(),
      override: z.boolean().optional(),
    })
    .strict(),
  'master.decisions': z
    .object({ role: z.string().min(1).optional(), track_id: handle.optional() })
    .strict(),
  'master.reset_decisions': z.object({ label: z.string().max(80).optional() }).strict(),
  'master.checkpoint': z
    .object({ label: z.string().trim().min(1).max(80), track_id: handle.optional() })
    .strict(),
  'master.apply_preset': z
    .object({ preset: z.string().min(1), track_id: handle.optional() })
    .strict(),
  'master.restore_checkpoint': z.object({ checkpoint_id: z.string().min(1) }).strict(),
  'master.list_checkpoints': empty,
  'master.build_chain': z
    .object({ track_id: handle.optional(), preset: z.string().min(1).nullable().optional() })
    .strict(),
  'master.meters': z
    .object({ seconds: z.number().min(0.2).max(30).optional(), track_id: handle.optional() })
    .strict(),

  // -- bridge-side ------------------------------------------------------
  'live.snapshot_clip': clipRef.extend({ label: z.string().max(128).optional() }).strict(),
  'live.restore_clip': z.object({ snapshot_id: z.string().min(1) }).strict(),
  'live.list_snapshots': empty,
  'live.duplicate_clip': z
    .object({
      track_id: handle,
      clip_slot: z.number().int().min(0).max(511),
      target_slot: z.number().int().min(0).max(511),
      target_track_id: handle.optional(),
      replace_existing: z.boolean().optional(),
    })
    .strict(),
  'bridge.status': empty,
  'bridge.get_commands': empty,
} as const;

export type CommandName = keyof typeof schemas;

export const commandNames = Object.keys(schemas).sort() as CommandName[];

export function isKnownCommand(name: string): name is CommandName {
  return Object.prototype.hasOwnProperty.call(schemas, name);
}

/**
 * Validate one command's arguments, turning Zod's report into a flat,
 * agent-readable list of problems.
 */
export function validateArgs(
  command: CommandName,
  args: unknown,
): Record<string, unknown> {
  const schema = schemas[command] as z.ZodTypeAny;
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) {
    return parsed.data as Record<string, unknown>;
  }
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  const summary = issues
    .slice(0, 5)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');
  throw new ValidationError(`Invalid arguments for ${command} - ${summary}`, {
    command,
    issues,
  });
}
