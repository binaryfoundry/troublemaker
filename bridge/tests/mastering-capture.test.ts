/**
 * The Master-capture sequence through the real bridge against a fake Live
 * that simulates a clip recording for a while and then finishing.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CAPTURED = join(tmpdir(), 'tm-capture-test.wav');
writeFileSync(CAPTURED, 'RIFF');
// Live writes this once a recording is complete; the capture waits for it.
writeFileSync(`${CAPTURED}.asd`, 'asd');

import { Bridge } from '../src/server.js';
import { Logger } from '../src/logger.js';
import { FakeLive } from './helpers/fake-live.js';

let live: FakeLive;
let bridge: Bridge;
let tracks: Array<{ track_id: number; name: string; type: string }>;
let armed: boolean;
let recordingPolls: number;
let routing: string;
let monitoring: string;

beforeEach(async () => {
  live = new FakeLive();
  await live.listen();
  bridge = new Bridge({ port: 0, livePort: live.port, logger: new Logger('silent') });
  await bridge.start();
  await bridge.transport.waitUntilReady(5_000);

  tracks = [{ track_id: 1, name: 'Drums', type: 'midi' }];
  armed = false;
  recordingPolls = -1;
  routing = 'Ext. In';
  monitoring = 'auto';
  live.handlers.set('live.get_record_settings', () => ({ tempo: 120, signature: [4, 4] }));
  live.handlers.set('live.get_tracks', () => ({ tracks }));
  live.handlers.set('live.create_audio_track', (_c, args) => {
    const track = { track_id: 9, name: args.name as string, type: 'audio' };
    tracks.push(track);
    return track;
  });
  live.handlers.set('live.get_input_routing', () => ({
    current: routing,
    available: ['Ext. In', 'Resampling', 'No Input'],
  }));
  live.handlers.set('live.set_input_routing', (_c, args) => {
    routing = args.routing as string;
    return {};
  });
  live.handlers.set('live.set_monitoring', (_c, args) => {
    monitoring = args.state as string;
    return {};
  });
  live.handlers.set('live.get_clip_slots', () => ({ clip_slots: [{ slot: 0, has_clip: false }] }));
  live.handlers.set('live.set_track_arm', (_c, args) => {
    armed = args.enabled as boolean;
    return {};
  });
  live.handlers.set('live.fire_scene', () => ({}));
  live.handlers.set('live.delete_clip', () => ({ deleted: true }));
  live.handlers.set('live.stop_clip', () => ({ stopped: true }));
  live.handlers.set('live.stop', () => ({}));
  live.handlers.set('live.play', () => ({}));
  live.handlers.set('live.get_transport', () => ({ playing: live.received.some((r) => r.command === 'live.play') }));
  live.handlers.set('live.record_with_scene', () => {
    recordingPolls = 3;
    return { started: true };
  });
  live.handlers.set('live.record_clip', () => {
    recordingPolls = 3;
    return { started: true };
  });
  live.handlers.set('live.get_clip_slot_status', () => {
    if (recordingPolls < 0) return { has_clip: false, is_recording: false, file_path: null };
    recordingPolls -= 1;
    return {
      has_clip: true,
      is_recording: recordingPolls >= 0,
      file_path: CAPTURED,
    };
  });
});

afterEach(async () => {
  await bridge.stop();
  await live.close();
});

describe('master.capture', () => {
  it('creates and routes a capture track, records, and returns the file', async () => {
    const result = (await bridge.execute('master.capture', { bars: 1 })) as any;
    expect(result).toMatchObject({ file_path: CAPTURED, length_beats: 4, seconds: 2 });
    expect(tracks.map((t) => t.name)).toContain('TM Capture');
    expect(routing).toBe('Resampling');
    expect(monitoring).toBe('off');
  });

  it('stops the clip and lets Live finish the file before removing the clip', async () => {
    await bridge.execute('master.capture', { bars: 1 });
    const order = live.received.map((r) => r.command);
    expect(order.indexOf('live.stop_clip')).toBeGreaterThan(order.lastIndexOf('live.get_clip_slot_status'));
    expect(order.indexOf('live.delete_clip')).toBeGreaterThan(order.indexOf('live.stop_clip'));
  });

  it('disarms the capture track and stops playback afterwards', async () => {
    await bridge.execute('master.capture', { bars: 1 });
    expect(armed).toBe(false);
    expect(live.received.at(-1)?.command).toBe('live.set_track_arm');
    expect(live.received.some((r) => r.command === 'live.stop')).toBe(true);
  });

  it('reuses an existing capture track', async () => {
    tracks.push({ track_id: 9, name: 'TM Capture', type: 'audio' });
    await bridge.execute('master.capture', { bars: 1 });
    expect(live.received.some((r) => r.command === 'live.create_audio_track')).toBe(false);
  });

  it('starts the transport, then launches scene and recording together', async () => {
    await bridge.execute('master.capture', { bars: 1, scene_id: 5 });
    const commands = live.received.map((r) => r.command);
    expect(commands.indexOf('live.play')).toBeLessThan(commands.indexOf('live.record_with_scene'));
    expect(commands).not.toContain('live.record_clip');
  });

  it('falls back to separate launches on an older Remote Script', async () => {
    live.handlers.delete('live.record_with_scene');
    await bridge.execute('master.capture', { bars: 1, scene_id: 5 });
    const order = live.received.map((r) => r.command);
    expect(order.indexOf('live.fire_scene')).toBeLessThan(order.indexOf('live.record_clip'));
  });

  // An override from any parameter write survives Back to Arrangement and would
  // capture an automated part flat (measured, Live 12.4).
  it('re-enables automation before it records', async () => {
    live.handlers.set('live.re_enable_automation', () => ({ was_overridden: true }));
    await bridge.execute('master.capture', { bars: 1 });
    const order = live.received.map((r) => r.command);
    expect(order).toContain('live.re_enable_automation');
    expect(order.indexOf('live.re_enable_automation')).toBeLessThan(order.indexOf('live.record_clip'));
  });

  it('records from start_beat only once Live is playing there', async () => {
    // Live starts from the top first, as when the launch beats continue_playing.
    let position = 0;
    let playing = false;
    live.handlers.set('live.back_to_arrangement', () => ({}));
    live.handlers.set('live.set_song_time', (_c, args) => {
      position = args.beat as number;
      return { current_song_time: position };
    });
    live.handlers.set('live.continue_playing', () => {
      playing = true;
      position = 0;
      return {};
    });
    live.handlers.set('live.get_transport', () => ({ playing, current_song_time: position }));
    await bridge.execute('master.capture', { bars: 1, start_beat: 256 });
    const order = live.received.map((r) => r.command);
    const seeks = live.received.filter((r) => r.command === 'live.set_song_time');
    expect(seeks.length).toBeGreaterThan(1);
    expect(seeks.at(-1)?.args).toMatchObject({ beat: 256 });
    expect(order.lastIndexOf('live.set_song_time')).toBeLessThan(order.indexOf('live.record_clip'));
  });

  it('fails rather than record the wrong place when the transport never gets there', async () => {
    live.handlers.set('live.back_to_arrangement', () => ({}));
    live.handlers.set('live.set_song_time', () => ({}));
    live.handlers.set('live.continue_playing', () => ({}));
    live.handlers.set('live.get_transport', () => ({ playing: false, current_song_time: 0 }));
    await expect(bridge.execute('master.capture', { bars: 1, start_beat: 256 })).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
    expect(live.received.some((r) => r.command === 'live.record_clip')).toBe(false);
  }, 15_000);

  it('refuses when Live offers no Resampling input', async () => {
    live.handlers.set('live.get_input_routing', () => ({ current: 'Ext. In', available: ['Ext. In'] }));
    await expect(bridge.execute('master.capture', { bars: 1 })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('validates its arguments', async () => {
    await expect(bridge.execute('master.capture', { bars: 4, seconds: 10 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
