/**
 * Integration pass against a real, running Ableton Live.
 *
 *   npm run bridge            # with Live open and TroubleMaker selected
 *   npm run test:live
 *
 * Works on a scratch MIDI track it creates, restores the tempo and selection
 * it changes, and prints a PASS/FAIL line per check. Not part of `npm test`,
 * which must run without Ableton.
 */

import { makeMoreSyncopated, compareMaterial, planToCommands } from '../../agent/src/transforms.js';
import { fourOnTheFloorKick, toNotes } from '../../agent/src/patterns.js';
import type { Note } from '../src/protocol.js';

const BASE = process.env.TROUBLEMAKER_URL ?? 'http://127.0.0.1:8765';

interface Failure {
  code: string;
  message: string;
  [k: string]: unknown;
}

async function call(command: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  const body = (await response.json()) as { ok: boolean; result?: unknown; error?: Failure };
  if (!body.ok) {
    const error = new Error(`${body.error!.code}: ${body.error!.message}`) as Error & {
      payload?: Failure;
    };
    error.payload = body.error;
    throw error;
  }
  return body.result;
}

async function expectError(command: string, args: Record<string, unknown>, code: string) {
  try {
    await call(command, args);
  } catch (error) {
    const payload = (error as { payload?: Failure }).payload;
    if (payload?.code === code) return payload;
    throw new Error(`expected ${code}, got ${payload?.code ?? String(error)}`);
  }
  throw new Error(`expected ${code}, but the command succeeded`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const results: Array<{ name: string; ok: boolean; detail: string; ms: number }> = [];

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  const started = Date.now();
  try {
    const detail = (await fn()) ?? '';
    results.push({ name, ok: true, detail, ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, detail: (error as Error).message, ms: Date.now() - started });
  }
}

async function main(): Promise<number> {
  const caps = await call('live.get_capabilities');
  const originalTempo = (await call('live.get_tempo')).bpm as number;
  let originalSelection: number | null = null;
  try {
    originalSelection = (await call('live.get_selected_track')).track_id;
  } catch {
    /* nothing selected */
  }

  let trackId = -1;
  const slot = 0;

  await check('capabilities report note ids and clip automation', async () => {
    assert(caps.note_ids && caps.clip_automation, JSON.stringify(caps));
    return `Live ${caps.live_version}`;
  });

  await check('handles are stable across reads', async () => {
    const a = (await call('live.get_tracks')).tracks.map((t: any) => t.track_id);
    const b = (await call('live.get_tracks')).tracks.map((t: any) => t.track_id);
    assert(JSON.stringify(a) === JSON.stringify(b), `${a} vs ${b}`);
    return `ids ${a.join(', ')}`;
  });

  await check('tempo write and read back', async () => {
    await call('live.set_tempo', { bpm: 126 });
    const bpm = (await call('live.get_tempo')).bpm;
    assert(Math.abs(bpm - 126) < 0.01, `read ${bpm}`);
    await call('live.set_tempo', { bpm: originalTempo });
    return `126 then restored to ${originalTempo}`;
  });

  await check('create a MIDI track', async () => {
    const track = await call('live.create_midi_track', { name: 'TM Test' });
    trackId = track.track_id;
    assert(track.name === 'TM Test', track.name);
    return `track_id ${trackId}`;
  });

  await check('new track handle survives a later read', async () => {
    const track = await call('live.get_track', { track_id: trackId });
    assert(track.track_id === trackId, `got ${track.track_id}`);
  });

  await check('create a 1-bar MIDI clip', async () => {
    const clip = await call('live.create_midi_clip', {
      track_id: trackId,
      clip_slot: slot,
      length_beats: 4,
      name: 'Kick',
    });
    assert(clip.length_beats === 4, `length ${clip.length_beats}`);
  });

  await check('four-on-the-floor lands on beats 0,1,2,3 (Milestone 3)', async () => {
    await call('live.replace_notes', {
      track_id: trackId,
      clip_slot: slot,
      notes: toNotes(fourOnTheFloorKick({ bars: 1 })),
    });
    const { notes } = await call('live.get_notes', { track_id: trackId, clip_slot: slot });
    const starts = notes.map((n: Note) => n.start);
    assert(JSON.stringify(starts) === '[0,1,2,3]', `starts ${starts}`);
    assert(notes.every((n: Note) => n.pitch === 36), 'pitch');
    return `starts ${starts.join(', ')}`;
  });

  await check('notes read back with correct pitch/start/duration/velocity (Milestone 2)', async () => {
    const written: Note[] = [
      { pitch: 41, start: 0, duration: 0.25, velocity: 105 },
      { pitch: 44, start: 1.5, duration: 0.5, velocity: 90 },
      { pitch: 48, start: 2.75, duration: 1, velocity: 64 },
    ];
    await call('live.replace_notes', { track_id: trackId, clip_slot: slot, notes: written });
    const { notes } = await call('live.get_notes', { track_id: trackId, clip_slot: slot });
    assert(notes.length === 3, `count ${notes.length}`);
    written.forEach((w, i) => {
      const r = notes[i];
      assert(
        r.pitch === w.pitch && r.start === w.start && r.duration === w.duration && r.velocity === w.velocity,
        `note ${i}: wrote ${JSON.stringify(w)} read ${JSON.stringify(r)}`,
      );
    });
  });

  await check('add notes leaves existing notes alone', async () => {
    const result = await call('live.add_notes', {
      track_id: trackId,
      clip_slot: slot,
      notes: [{ pitch: 60, start: 3.5, duration: 0.25, velocity: 80 }],
    });
    assert(result.note_count_before === 3 && result.note_count === 4, JSON.stringify(result));
  });

  await check('update notes in place by note_id', async () => {
    const { notes } = await call('live.get_notes', { track_id: trackId, clip_slot: slot });
    const target = notes[0];
    await call('live.update_notes', {
      track_id: trackId,
      clip_slot: slot,
      updates: [{ note_id: target.note_id, velocity: 50, start: 0.25 }],
    });
    const after = (await call('live.get_notes', { track_id: trackId, clip_slot: slot })).notes;
    const moved = after.find((n: Note) => n.note_id === target.note_id);
    assert(moved && moved.velocity === 50 && moved.start === 0.25, JSON.stringify(moved));
    assert(after.length === notes.length, 'count changed');
    return `note ${target.note_id} kept its id`;
  });

  await check('remove notes by id', async () => {
    const { notes } = await call('live.get_notes', { track_id: trackId, clip_slot: slot });
    const result = await call('live.remove_notes', {
      track_id: trackId,
      clip_slot: slot,
      note_ids: [notes.at(-1).note_id],
    });
    assert(result.notes_removed === 1, JSON.stringify(result));
  });

  await check('remove notes by window', async () => {
    const result = await call('live.remove_notes', {
      track_id: trackId,
      clip_slot: slot,
      from_time: 1,
      time_span: 1,
    });
    assert(result.notes_removed === 1, JSON.stringify(result));
  });

  await check('set clip loop', async () => {
    const clip = await call('live.set_clip_loop', {
      track_id: trackId,
      clip_slot: slot,
      start: 0,
      length: 8,
    });
    assert(clip.loop_end === 8, `loop_end ${clip.loop_end}`);
    await call('live.set_clip_loop', { track_id: trackId, clip_slot: slot, start: 0, length: 4 });
  });

  await check('select a clip slot, then resolve "this clip"', async () => {
    await call('live.select_clip_slot', { track_id: trackId, clip_slot: slot });
    const clip = await call('live.get_selected_clip');
    assert(clip.track_id === trackId && clip.clip_slot === slot, JSON.stringify(clip));
    return `"${clip.name}" on ${clip.track_name}, slot ${clip.clip_slot}`;
  });

  await check('MVP: syncopate the selected clip, keep the melody, verify, restore', async () => {
    const selected = await call('live.get_selected_clip');
    const eighths: Note[] = [41, 41, 44, 41, 48, 41, 44, 43].map((pitch, i) => ({
      pitch,
      start: i * 0.5,
      duration: 0.45,
      velocity: 100,
    }));
    await call('live.replace_notes', { track_id: selected.track_id, clip_slot: slot, notes: eighths });
    const snapshot = await call('live.snapshot_clip', { track_id: selected.track_id, clip_slot: slot });
    const before = (await call('live.get_notes', { track_id: selected.track_id, clip_slot: slot })).notes;

    const plan = makeMoreSyncopated(before, { lengthBeats: 4, amount: 0.6, seed: 11 });
    await call('transaction', {
      atomic: true,
      commands: planToCommands(selected.track_id, slot, plan),
    });
    const after = (await call('live.get_notes', { track_id: selected.track_id, clip_slot: slot })).notes;
    const cmp = compareMaterial(before, after);
    assert(cmp.noteCountDelta === 0, `count delta ${cmp.noteCountDelta}`);
    assert(cmp.offGridNotes >= 2, `off-grid ${cmp.offGridNotes}`);
    const pitchesBefore = [...before.map((n: Note) => n.pitch)].sort().join();
    const pitchesAfter = [...after.map((n: Note) => n.pitch)].sort().join();
    assert(pitchesBefore === pitchesAfter, 'pitches changed');

    await call('live.restore_clip', { snapshot_id: snapshot.snapshot_id });
    const restored = (await call('live.get_notes', { track_id: selected.track_id, clip_slot: slot })).notes;
    assert(
      JSON.stringify(restored.map((n: Note) => n.start)) ===
        JSON.stringify(before.map((n: Note) => n.start)),
      'restore mismatch',
    );
    return `${plan.summary[0]}; off-grid ${cmp.offGridNotes}; restored`;
  });

  await check('atomic transaction rolls back on failure', async () => {
    const before = (await call('live.get_notes', { track_id: trackId, clip_slot: slot })).notes;
    try {
      await call('transaction', {
        atomic: true,
        commands: [
          { command: 'live.replace_notes', args: { track_id: trackId, clip_slot: slot, notes: [] } },
          { command: 'live.get_clip', args: { track_id: trackId, clip_slot: 7 } },
        ],
      });
      throw new Error('transaction should have failed');
    } catch (error) {
      const payload = (error as { payload?: Failure }).payload;
      assert(payload?.code === 'TRANSACTION_FAILED', String(error));
      assert(payload.rolled_back === true, 'not rolled back');
    }
    const after = (await call('live.get_notes', { track_id: trackId, clip_slot: slot })).notes;
    assert(after.length === before.length, `notes ${before.length} -> ${after.length}`);
    return `failed at step 1, ${after.length} notes restored`;
  });

  await check('mixer: volume, pan, send', async () => {
    const vol = await call('live.set_track_volume', { track_id: trackId, normalized: 0.7 });
    const pan = await call('live.set_track_pan', { track_id: trackId, normalized: 0.25 });
    const send = await call('live.set_track_send', { track_id: trackId, send_index: 0, normalized: 0.3 });
    assert(Math.abs(vol.volume.normalized - 0.7) < 1e-3, 'volume');
    assert(Math.abs(pan.pan.value - -0.5) < 1e-3, `pan ${pan.pan.value}`);
    assert(Math.abs(send.send.normalized - 0.3) < 1e-3, 'send');
    return `volume ${vol.volume.display_value}, pan ${pan.pan.display_value}, send ${send.send.display_value}`;
  });

  await check('device parameters: read range, write, verify (return-track Reverb)', async () => {
    const state = await call('live.get_project_state', { include_return_tracks: true });
    const reverbTrack = state.return_tracks.find((t: any) => t.devices.length > 0);
    assert(reverbTrack, 'no return track with a device');
    const device = reverbTrack.devices[0];
    const { parameters } = await call('live.get_device_parameters', {
      track_id: reverbTrack.track_id,
      device_id: device.device_id,
    });
    const param = parameters.find((p: any) => !p.is_quantized && p.name !== 'Device On');
    assert(param, 'no continuous parameter');
    const target = param.normalized > 0.5 ? param.normalized - 0.1 : param.normalized + 0.1;
    const result = await call('live.set_device_parameter', {
      track_id: reverbTrack.track_id,
      device_id: device.device_id,
      parameter_id: param.parameter_id,
      normalized: target,
    });
    assert(Math.abs(result.after.normalized - target) < 1e-3, JSON.stringify(result.after));
    await call('live.set_device_parameter', {
      track_id: reverbTrack.track_id,
      device_id: device.device_id,
      parameter_id: param.parameter_id,
      value: param.value,
    });
    return `${device.name} "${param.name}" ${result.before.display_value} -> ${result.after.display_value} -> restored`;
  });

  await check('unknown parameter error lists the real ones', async () => {
    const state = await call('live.get_project_state', { include_return_tracks: true });
    const reverbTrack = state.return_tracks.find((t: any) => t.devices.length > 0);
    const payload = await expectError(
      'live.set_device_parameter',
      {
        track_id: reverbTrack.track_id,
        device_id: reverbTrack.devices[0].device_id,
        parameter_name: 'Cutoff',
        normalized: 0.5,
      },
      'PARAMETER_NOT_FOUND',
    );
    const available = payload.available_parameters as string[];
    assert(available.length > 3, 'no alternatives');
    return `${available.length} alternatives offered`;
  });

  await check('clip automation: write a ramp and read it back rising', async () => {
    const { devices } = await call('live.get_devices', { track_id: trackId });
    if (devices.length === 0) {
      throw new Error(
        'SKIPPED - the test track has no device. Drop any device (e.g. Auto Filter) onto "TM Test" and re-run.',
      );
    }
    const device = devices[0];
    const { parameters } = await call('live.get_device_parameters', {
      track_id: trackId,
      device_id: device.device_id,
    });
    const param = parameters.find((p: any) => !p.is_quantized && p.name !== 'Device On');
    await call('live.set_automation', {
      track_id: trackId,
      clip_slot: slot,
      device_id: device.device_id,
      parameter_id: param.parameter_id,
      points: [
        { beat: 0, normalized: 0.1 },
        { beat: 4, normalized: 0.9 },
      ],
    });
    const curve = await call('live.get_automation', {
      track_id: trackId,
      clip_slot: slot,
      device_id: device.device_id,
      parameter_id: param.parameter_id,
      resolution: 1,
    });
    const values = curve.points.map((p: any) => p.value);
    assert(values.at(-1) > values[0], `curve ${values}`);
    return `${device.name} "${param.name}" ${values.map((v: number) => v.toFixed(2)).join(' -> ')}`;
  });

  await check('scenes: list, create, rename', async () => {
    const before = (await call('live.get_scenes')).scenes.length;
    const scene = await call('live.create_scene', { name: 'TM Scene' });
    const renamed = await call('live.rename_scene', { scene_id: scene.scene_id, name: 'TM Scene 2' });
    const after = (await call('live.get_scenes')).scenes.length;
    assert(after === before + 1 && renamed.name === 'TM Scene 2', `${before} -> ${after}`);
    return `scene_id ${scene.scene_id}`;
  });

  await check('launch and stop the clip', async () => {
    await call('live.fire_clip', { track_id: trackId, clip_slot: slot });
    await call('live.stop_clip', { track_id: trackId });
    await call('live.stop');
  });

  await check('structured errors from Live: empty slot, bad track', async () => {
    const empty = await expectError('live.get_clip', { track_id: trackId, clip_slot: 5 }, 'CLIP_NOT_FOUND');
    await expectError('live.get_track', { track_id: 999999 }, 'TRACK_NOT_FOUND');
    return `occupied_slots ${JSON.stringify(empty.occupied_slots)}`;
  });

  await check('bridge validation rejects bad input before Live', async () => {
    await expectError(
      'live.add_notes',
      { track_id: trackId, clip_slot: slot, notes: [{ pitch: 200, start: 0, duration: 1 }] },
      'VALIDATION_FAILED',
    );
  });

  await check('latency: 200 sequential commands', async () => {
    const started = Date.now();
    for (let i = 0; i < 200; i += 1) await call('live.get_tempo');
    const average = (Date.now() - started) / 200;
    assert(average < 150, `average ${average.toFixed(1)} ms`);
    return `average ${average.toFixed(1)} ms per command`;
  });

  if (originalSelection !== null) {
    try {
      await call('live.select_track', { track_id: originalSelection });
    } catch {
      /* original track gone */
    }
  }

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.ok ? 'PASS' : r.detail.startsWith('SKIPPED') ? 'SKIP' : 'FAIL';
    process.stdout.write(`  ${status}  ${r.name.padEnd(width)}  ${r.detail}\n`);
  }
  const failed = results.filter((r) => !r.ok && !r.detail.startsWith('SKIPPED'));
  const skipped = results.filter((r) => r.detail.startsWith('SKIPPED'));
  process.stdout.write(
    `\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped.\n`,
  );
  if (trackId >= 0) {
    process.stdout.write('Left the "TM Test" track and "TM Scene 2" in the Set for inspection.\n');
  }
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
