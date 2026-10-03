/**
 * The MCP server end to end: an MCP client in memory, the real bridge, and a
 * fake Live holding one MIDI clip.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { Bridge } from '../src/server.js';
import { Logger } from '../src/logger.js';
import { createMcpServer } from '../../mcp/tools.js';
import { FakeLive } from './helpers/fake-live.js';

interface StoredNote {
  note_id: number;
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
  mute: boolean;
}

let live: FakeLive;
let bridge: Bridge;
let client: Client;
let notes: StoredNote[];
let clipExists: boolean;
let nextId: number;

function addNotes(list: Array<Record<string, unknown>>): void {
  for (const n of list) {
    notes.push({
      note_id: nextId++,
      pitch: Number(n.pitch),
      start_time: Number(n.start_time ?? n.start),
      duration: Number(n.duration),
      velocity: Number(n.velocity ?? 100),
      mute: Boolean(n.mute),
    });
  }
}

function payload(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const first = (result.content as Array<{ type: string; text: string }>)[0]!;
  return JSON.parse(first.text);
}

beforeEach(async () => {
  live = new FakeLive();
  await live.listen();
  bridge = new Bridge({ port: 0, livePort: live.port, logger: new Logger('silent') });
  await bridge.start();
  await bridge.transport.waitUntilReady(5_000);

  notes = [];
  nextId = 1;
  clipExists = true;
  addNotes([0, 1, 2, 3].map((beat) => ({ pitch: 36, start_time: beat, duration: 0.25, velocity: 100 })));

  const clip = () => {
    if (!clipExists) throw new Error('No clip in slot 0');
    return { track_id: 1, clip_slot: 0, length_beats: 4, is_midi: true, name: 'Kick', loop_start: 0, loop_end: 4 };
  };
  live.handlers.set('live.get_capabilities', () => ({ live_version: '12.4.6', arrangement_placement: true }));
  live.handlers.set('live.get_transport', () => ({ playing: false }));
  live.handlers.set('live.get_time_signature', () => ({ numerator: 4, denominator: 4 }));
  live.handlers.set('live.get_tempo', () => ({ bpm: 124 }));
  live.handlers.set('live.get_clip', clip);
  live.handlers.set('live.get_notes', () => ({ ...clip(), notes: notes.map((n) => ({ ...n })) }));
  live.handlers.set('live.create_midi_clip', () => {
    clipExists = true;
    notes = [];
    return clip();
  });
  live.handlers.set('live.replace_notes', (_c, args) => {
    notes = [];
    addNotes(args.notes as Array<Record<string, unknown>>);
    return { count: notes.length };
  });
  live.handlers.set('live.add_notes', (_c, args) => {
    addNotes(args.notes as Array<Record<string, unknown>>);
    return { count: notes.length };
  });
  live.handlers.set('live.update_notes', (_c, args) => {
    for (const update of args.updates as Array<Record<string, unknown>>) {
      const note = notes.find((n) => n.note_id === update.note_id);
      if (note) Object.assign(note, update);
    }
    return { updated: (args.updates as unknown[]).length };
  });
  live.handlers.set('live.remove_notes', (_c, args) => {
    const ids = new Set(args.note_ids as number[]);
    notes = notes.filter((n) => !ids.has(n.note_id));
    return {};
  });
  live.handlers.set('live.get_track', () => ({ track_id: 1, name: 'Kick', type: 'midi' }));
  live.handlers.set('live.set_clip_loop', () => ({}));
  live.handlers.set('live.set_clip_name', () => ({}));
  live.handlers.set('live.set_device_parameter_display', (_c, args) => ({ ...args, achieved: args.target }));

  const server = createMcpServer({ post: (command, args = {}, options = {}) => bridge.execute(command, args, options) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  await bridge.stop();
  await live.close();
});

describe('MCP server', () => {
  it('lists the curated tools, prompts and resources', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of ['live_status', 'get_project', 'read_clip', 'transform_clip', 'write_part', 'qc', 'ab_trial', 'apply_effect', 'arrangement', 'bridge_command']) {
      expect(names).toContain(expected);
    }
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['system', 'composition', 'effects', 'mastering', 'drums', 'basslines', 'chords', 'edm-tips', 'melodic-techno', 'progressive-house', 'sound-selection', 'vocals', 'jon-hopkins', 'tinlicker']));
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('troublemaker://effects-codex');
    expect(resources.map((r) => r.uri)).toContain('troublemaker://artists');
  });

  it('serves the system prompt from agent/prompts', async () => {
    const prompt = await client.getPrompt({ name: 'system' });
    const content = prompt.messages[0]!.content as { type: string; text: string };
    expect(content.text.length).toBeGreaterThan(200);
  });

  it('reads Live status', async () => {
    const result = (await payload(await client.callTool({ name: 'live_status', arguments: {} }))) as {
      capabilities: { live_version: string };
    };
    expect(result.capabilities.live_version).toBe('12.4.6');
  });

  it('transforms a clip with a snapshot and verification', async () => {
    const result = payload(
      await client.callTool({ name: 'transform_clip', arguments: { track_id: 1, clip_slot: 0, transform: 'transpose', semitones: 2 } }),
    ) as { snapshot_id: string; updates: number };
    expect(result.updates).toBe(4);
    expect(result.snapshot_id).toBeTruthy();
    expect(notes.every((n) => n.pitch === 38)).toBe(true);

    await client.callTool({ name: 'restore_snapshot', arguments: { snapshot_id: result.snapshot_id } });
    expect(notes.every((n) => n.pitch === 36)).toBe(true);
  });

  it('does not touch Live on a dry run', async () => {
    await client.callTool({ name: 'transform_clip', arguments: { track_id: 1, clip_slot: 0, transform: 'transpose', semitones: 5, dry_run: true } });
    expect(notes.every((n) => n.pitch === 36)).toBe(true);
  });

  it('writes a generated part into the slot', async () => {
    const result = payload(
      await client.callTool({ name: 'write_part', arguments: { track_id: 1, clip_slot: 0, part: 'euclidean', hits: 5, steps: 16, pitch: 42 } }),
    ) as { note_count: number };
    expect(result.note_count).toBe(5);
    expect(notes.every((n) => n.pitch === 42)).toBe(true);
  });

  it('writes a DRUMS.md genre groove and returns its grid and checks', async () => {
    const result = await client.callTool({
      name: 'write_part',
      arguments: { track_id: 1, clip_slot: 0, part: 'drums', genre: 'house', bars: 1 },
    });
    const [summary, grid, checks] = (result.content as Array<{ text: string }>).map((c) => c.text);
    expect(JSON.parse(summary!).note_count).toBe(notes.length);
    expect(notes.filter((n) => n.pitch === 36).map((n) => n.start_time)).toEqual([0, 1, 2, 3]);
    expect(grid).toContain('BD');
    expect(checks).toMatch(/no findings/);
  });

  it("plays a drum fill on the pads of the track's Drum Rack, not on assumed notes", async () => {
    live.handlers.set('live.get_devices', () => ({ devices: [{ device_id: 9, name: '909 Core Kit', class_name: 'DrumGroupDevice' }] }));
    live.handlers.set('live.get_drum_pads', () => ({
      pads: [[36, 'Bass Drum'], [39, 'Hand Clap'], [42, 'Closed Hi Hat'], [44, 'Low Tom'], [45, 'Mid Tom'], [46, 'Open Hi Hat'], [47, 'Hi Tom'], [50, 'Ride'], [51, 'Ride']]
        .map(([note, name]) => ({ note, name })),
    }));
    const result = await client.callTool({
      name: 'write_part',
      arguments: { track_id: 1, clip_slot: 0, part: 'drums', genre: 'house', variant: 'F', bars: 1 },
    });
    const summary = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { kit: string };
    expect(summary.kit).toMatch(/Remapped/);
    const pitches = new Set(notes.map((n) => n.pitch));
    expect(pitches.has(47)).toBe(true);
    expect(pitches.has(50)).toBe(false);
  });

  it('writes a BASSLINES.md pattern in the key and returns the bass checks', async () => {
    const result = await client.callTool({
      name: 'write_part',
      arguments: { track_id: 1, clip_slot: 0, part: 'bassline', pattern: 'house_offbeat', root: 'F' },
    });
    expect(result.isError).toBeFalsy();
    expect(notes.map((n) => n.start_time)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(notes[0]!.pitch).toBe(41);
    expect((result.content as Array<{ text: string }>).map((c) => c.text).join(' ')).toMatch(/Bass checks: no findings/);
  });

  it('voices a CHORDS.md template and reports the voice leading', async () => {
    const result = await client.callTool({ name: 'write_part', arguments: { track_id: 1, clip_slot: 0, part: 'chords', template: 'H08' } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>).map((c) => c.text).join(' ');
    expect(text).toMatch(/Dm9: /);
    expect(text).toMatch(/Voice leading: Dm9 → G\/D/);
    const lowest = Math.min(...notes.filter((n) => n.start_time === 4).map((n) => n.pitch));
    expect(lowest % 12).toBe(2);
  });

  it('writes a cycle arpeggio whose notes all come from the progression', async () => {
    const result = await client.callTool({
      name: 'write_part',
      arguments: { track_id: 1, clip_slot: 0, part: 'arp', root: 'F', bars: 4, beats_per_chord: 4 },
    });
    expect(result.isError).toBeFalsy();
    const fMinor = [5, 7, 8, 10, 0, 1, 3];
    expect(notes.length).toBeGreaterThan(40);
    for (const n of notes) expect(fMinor).toContain(n.pitch % 12);
    expect((result.content as Array<{ text: string }>)[1]!.text).toMatch(/repeats after 560 sixteenths/);
  });

  it('sets a fader in dB through its display', async () => {
    await client.callTool({ name: 'set_mixer', arguments: { track_id: 1, volume_db: -8 } });
    const sent = live.received.find((r) => r.command === 'live.set_device_parameter_display');
    expect(sent?.args).toMatchObject({ track_id: 1, mixer: 'volume', target: -8 });
  });

  it('loads the best-matching kit and reports its pads', async () => {
    live.handlers.set('live.browse', (_c, args) => ({
      items:
        args.category === 'drums'
          ? [
              { name: '808 Core Kit Extended.adg', path: ['808 Core Kit Extended.adg'], is_loadable: true, is_folder: false },
              { name: '808 Core Kit.adg', path: ['808 Core Kit.adg'], is_loadable: true, is_folder: false },
            ]
          : [],
    }));
    live.handlers.set('live.load_browser_item', (_c, args) => ({
      track_id: 1,
      loaded: { path: args.path },
      devices: [{ device_id: 50, name: '808 Core Kit', class_name: 'DrumGroupDevice' }],
    }));
    live.handlers.set('live.get_drum_pads', () => ({ pads: [{ note: 36, name: 'Kick 808' }] }));
    const result = payload(
      await client.callTool({ name: 'load_sound', arguments: { track_id: 1, query: '808 Core Kit' } }),
    ) as { loaded: { path: string[] }; pads: unknown[]; alternatives: unknown[] };
    expect(result.loaded.path).toEqual(['808 Core Kit.adg']);
    expect(result.pads).toEqual([{ note: 36, name: 'Kick 808' }]);
    expect(result.alternatives).toHaveLength(1);
  });

  it('returns bridge errors as tool errors with the code', async () => {
    const result = await client.callTool({ name: 'bridge_command', arguments: { command: 'live.nonsense' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('UNKNOWN_COMMAND');
  });

  it('plans an arrangement without Live', async () => {
    const result = await client.callTool({ name: 'arrangement', arguments: { action: 'plan', style: 'melodic_techno' } });
    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/Final Peak/);
  });
});
