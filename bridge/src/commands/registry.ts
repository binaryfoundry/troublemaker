/**
 * The command catalogue.
 *
 * Each entry says what a command does, whether it changes the Set, and
 * whether the bridge handles it itself rather than forwarding it to Live.
 * `bridge.get_commands` serves this, so an agent can discover the surface
 * without the catalogue being duplicated in a prompt that drifts out of date.
 */

import { commandNames, type CommandName } from '../validation.js';

export interface CommandInfo {
  name: CommandName;
  summary: string;
  /** True when the command changes the Live Set. */
  mutates: boolean;
  /** True when the bridge answers without calling Live. */
  bridgeSide: boolean;
}

const SUMMARIES: Record<CommandName, { summary: string; mutates?: boolean; bridgeSide?: boolean }> = {
  'ping': { summary: 'Liveness probe; returns tempo and play state.' },

  'live.get_capabilities': {
    summary: 'What this Live install supports. Consult before assuming an API exists.',
  },
  'live.get_project_state': {
    summary:
      'Compact overview of tempo, tracks, clips, devices and scenes. Excludes notes and ' +
      'parameter values so the payload stays small.',
  },
  'live.get_tempo': { summary: 'Current tempo in BPM.' },
  'live.set_tempo': { summary: 'Set the tempo in BPM.', mutates: true },
  'live.get_time_signature': { summary: 'Song time signature.' },
  'live.set_time_signature': { summary: 'Set the song time signature.', mutates: true },
  'live.get_transport': { summary: 'Play state, song position, metronome and loop.' },
  'live.play': { summary: 'Start playback from the start marker.', mutates: true },
  'live.stop': { summary: 'Stop playback.', mutates: true },
  'live.continue_playing': { summary: 'Resume playback from the current position.', mutates: true },
  'live.stop_all_clips': { summary: 'Stop every playing Session clip.', mutates: true },
  'live.set_metronome': { summary: 'Turn the metronome on or off.', mutates: true },
  'live.undo': { summary: "Undo via Live's own undo stack.", mutates: true },
  'live.redo': { summary: "Redo via Live's own undo stack.", mutates: true },

  'live.get_tracks': { summary: 'All tracks with stable track_ids.' },
  'live.get_track': { summary: 'One track with its clips and devices.' },
  'live.create_midi_track': { summary: 'Create a MIDI track.', mutates: true },
  'live.rename_track': { summary: 'Rename a track.', mutates: true },
  'live.set_track_volume': { summary: 'Set track volume (value or normalized).', mutates: true },
  'live.set_track_pan': { summary: 'Set track pan (value or normalized).', mutates: true },
  'live.set_track_send': { summary: 'Set a send level on a track.', mutates: true },
  'live.set_track_mute': { summary: 'Mute or unmute a track.', mutates: true },
  'live.set_track_solo': { summary: 'Solo or unsolo a track.', mutates: true },
  'live.set_track_arm': { summary: 'Arm or disarm a track.', mutates: true },

  'live.get_clip_slots': { summary: 'Every clip slot on a track and what occupies it.' },
  'live.get_clip': { summary: 'One clip: length, loop region, note count.' },
  'live.create_midi_clip': { summary: 'Create an empty MIDI clip in a slot.', mutates: true },
  'live.delete_clip': { summary: 'Delete the clip in a slot.', mutates: true },
  'live.set_clip_name': { summary: 'Rename a clip.', mutates: true },
  'live.set_clip_loop': { summary: 'Set a clip loop region in beats.', mutates: true },
  'live.fire_clip': { summary: 'Launch a clip.', mutates: true },
  'live.stop_clip': { summary: 'Stop the playing clip on a track.', mutates: true },

  'live.get_notes': {
    summary: 'Read MIDI notes from a clip. Call this before changing an existing pattern.',
  },
  'live.add_notes': { summary: 'Add notes, leaving existing notes alone.', mutates: true },
  'live.replace_notes': {
    summary: 'Delete every note in the clip and write a new set. Destructive.',
    mutates: true,
  },
  'live.remove_notes': { summary: 'Remove notes by id or by time/pitch window.', mutates: true },
  'live.update_notes': {
    summary:
      'Change existing notes in place by note_id. The right tool for edits that must ' +
      'preserve the musical identity of a part.',
    mutates: true,
  },

  'live.get_scenes': { summary: 'All scenes with stable scene_ids.' },
  'live.get_scene': { summary: 'One scene.' },
  'live.create_scene': { summary: 'Create a scene.', mutates: true },
  'live.rename_scene': { summary: 'Rename a scene.', mutates: true },
  'live.fire_scene': { summary: 'Launch a scene.', mutates: true },

  'live.get_devices': { summary: 'Devices on a track, in chain order.' },
  'live.get_device': { summary: 'One device with all of its parameters.' },
  'live.get_device_parameters': {
    summary: 'Parameters with name, value, normalized value, range and display value.',
  },
  'live.set_device_parameter': {
    summary: 'Set one device parameter. Inspect its range first.',
    mutates: true,
  },
  'live.set_device_active': { summary: 'Enable or bypass a device.', mutates: true },

  'live.get_automation': { summary: 'Sample a clip automation envelope on a beat grid.' },
  'live.set_automation': { summary: 'Write a clip automation ramp from breakpoints.', mutates: true },
  'live.clear_automation': { summary: 'Clear a clip automation envelope.', mutates: true },

  'live.get_selected_track': { summary: 'The track the user has selected in Live.' },
  'live.get_selected_scene': { summary: 'The scene the user has selected in Live.' },
  'live.get_selected_clip': { summary: 'The highlighted clip - resolves "this clip".' },
  'live.get_selected_device': { summary: 'The device the user has selected.' },
  'live.select_track': { summary: "Move Live's selection to a track.", mutates: true },
  'live.select_clip_slot': { summary: "Move Live's selection to a clip slot.", mutates: true },

  'live.snapshot_clip': {
    summary: 'Store a clip (notes, loop, name) in bridge memory so an edit can be undone.',
    bridgeSide: true,
  },
  'live.restore_clip': { summary: 'Restore a clip from a snapshot.', mutates: true, bridgeSide: true },
  'live.list_snapshots': { summary: 'Snapshots held in bridge memory.', bridgeSide: true },
  'live.duplicate_clip': {
    summary: 'Copy a MIDI clip into another slot, optionally on another track.',
    mutates: true,
    bridgeSide: true,
  },
  'bridge.status': { summary: 'Bridge connection status and counters.', bridgeSide: true },
  'bridge.get_commands': { summary: 'This catalogue.', bridgeSide: true },
};

export const COMMANDS: CommandInfo[] = commandNames.map((name) => {
  const entry = SUMMARIES[name];
  return {
    name,
    summary: entry?.summary ?? '',
    mutates: entry?.mutates ?? false,
    bridgeSide: entry?.bridgeSide ?? false,
  };
});

/** Commands the bridge answers itself instead of forwarding to Live. */
export const BRIDGE_SIDE_COMMANDS = new Set<string>(
  COMMANDS.filter((c) => c.bridgeSide).map((c) => c.name),
);

export const MUTATING_COMMANDS = new Set<string>(
  COMMANDS.filter((c) => c.mutates).map((c) => c.name),
);
