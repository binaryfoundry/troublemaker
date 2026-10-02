import { describe, expect, it } from 'vitest';

import { applyEffect, expand, findEffect, type LiveClient } from '../src/fx.js';

/** A scripted bridge that records calls and simulates devices appearing. */
function client() {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const devices = new Map<number, Array<{ device_id: number; name: string; parameters: unknown[] }>>();
  let nextId = 100;
  let returns: Array<{ track_id: number; name: string }> = [];
  const post: LiveClient['post'] = async (command, args = {}) => {
    calls.push({ command, args });
    switch (command) {
      case 'live.get_tempo':
        return { bpm: 124 };
      case 'live.get_notes':
        return { notes: [
          { note_id: 1, pitch: 36, start: 14, duration: 0.25, velocity: 100 },
          { note_id: 2, pitch: 36, start: 15.5, duration: 0.25, velocity: 100 },
        ] };
      case 'live.create_midi_track':
        return { track_id: 50 };
      case 'live.create_return_track': {
        const track = { track_id: 70 + returns.length, name: String(args.name) };
        returns = [...returns, track];
        return track;
      }
      case 'live.get_tracks':
        return { return_tracks: returns };
      case 'live.insert_device': {
        const list = devices.get(args.track_id as number) ?? [];
        list.push({
          device_id: nextId++,
          name: String(args.device_name),
          parameters: [{ parameter_id: 1, name: 'Repeat', min: 0, max: 1, display_min: 'Off', display_max: 'On' }],
        });
        devices.set(args.track_id as number, list);
        return {};
      }
      case 'live.get_devices':
        return { devices: devices.get(args.track_id as number) ?? [] };
      case 'live.set_device_parameter_display':
        return args.apply === false ? { native: Number(args.target) / 1000 } : { after: {} };
      default:
        return {};
    }
  };
  return { post, calls };
}

describe('codex lookup', () => {
  it('finds effects by id, name or alias', () => {
    expect(findEffect('roulette wheel slowing down').id).toBe('retrigger_deceleration');
    expect(findEffect('Tape stop').id).toBe('tape_stop');
    expect(findEffect('trance gate').id).toBe('trance_gate');
  });

  it('suggests near matches for an unknown name', () => {
    expect(() => findEffect('reverb')).toThrow(/No effect/);
    try {
      findEffect('reverb');
    } catch (error) {
      expect((error as { details: { suggestions: string[] } }).details.suggestions).toContain('gated_reverb');
    }
  });
});

describe('expand', () => {
  it('interpolates exponential curves geometrically, like a filter sweep should', () => {
    const points = expand(
      { curve: 'exponential', points: [{ at: 0, value: 300 }, { at: 1, value: 19200 }] },
      [0, 16],
    );
    expect(points).toHaveLength(9);
    const ratios = points.slice(1).map(([, v], i) => Number(v) / Number(points[i]![1]));
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 2);
  });

  it('keeps step lanes as given', () => {
    const points = expand({ curve: 'step', points: [{ at: 0, value: 'On' }, { at: 1, value: 'Off' }] }, [12, 16]);
    expect(points).toEqual([[12, 'On'], [16, 'Off']]);
  });
});

describe('applyEffect', () => {
  it('refuses effects the codex marks unsupported, with the reason', async () => {
    const { post } = client();
    await expect(applyEffect({ post }, { effect: 'tape_stop', track_id: 1 })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(/varispeed|variable-speed/),
    });
  });

  it('inserts devices, sets params by display value and option, and automates the span', async () => {
    const live = client();
    const result = await applyEffect({ post: live.post }, { effect: 'filter_sweep', track_id: 3, start_beat: 48, length_beats: 16 });
    const commands = live.calls.map((c) => c.command);
    expect(commands).toContain('live.insert_device');
    expect(live.calls.find((c) => c.command === 'live.set_device_parameter_option')!.args).toMatchObject({
      parameter_name: 'Filter Type', option: 'Low-pass',
    });
    const automation = live.calls.find((c) => c.command === 'live.set_automation')!.args as {
      points: Array<{ beat: number }>;
    };
    expect(automation.points[0]!.beat).toBe(48);
    expect(automation.points.at(-1)!.beat).toBe(64);
    expect(result.warnings).toEqual([]);
  });

  it('builds a return effect and automates the source send for a throw', async () => {
    const live = client();
    await applyEffect({ post: live.post }, { effect: 'dub_delay_throw', track_id: 3, length_beats: 4 });
    expect(live.calls.find((c) => c.command === 'live.create_return_track')!.args).toEqual({ name: 'DUB ECHO' });
    const send = live.calls.find((c) => c.command === 'live.set_automation')!.args;
    expect(send).toMatchObject({ track_id: 3, mixer: 'send:0' });
  });

  it('sets a fixed send when a return effect has no send automation', async () => {
    const live = client();
    await applyEffect({ post: live.post }, { effect: 'gated_reverb', track_id: 3 });
    expect(live.calls.find((c) => c.command === 'live.set_track_send')!.args).toMatchObject({ track_id: 3, send_index: 0 });
  });

  it('gives a sourced effect its own track and instrument', async () => {
    const live = client();
    const result = await applyEffect({ post: live.post }, { effect: 'noise_riser', track_id: 3, length_beats: 32 });
    expect(result.track_id).toBe(50);
    expect(live.calls.some((c) => c.command === 'live.insert_device' && c.args.device_name === 'Drift')).toBe(true);
    expect(live.calls.find((c) => c.command === 'live.add_notes')!.args).toMatchObject({ track_id: 50 });
  });

  it('writes generated notes for MIDI effects, snapshotting first', async () => {
    const live = client();
    await applyEffect({ post: live.post }, { effect: 'exponential_ratchet', track_id: 3, start_beat: 60, length_beats: 4 });
    const order = live.calls.map((c) => c.command);
    expect(order.indexOf('live.snapshot_clip')).toBeLessThan(order.indexOf('live.add_notes'));
    const notes = live.calls.find((c) => c.command === 'live.add_notes')!.args.notes as Array<{ start: number }>;
    expect(notes[0]!.start).toBe(60);
  });

  it('clears the span for a pre-drop silence gap', async () => {
    const live = client();
    await applyEffect({ post: live.post }, { effect: 'silence_gap', track_id: 3, start_beat: 15, length_beats: 1 });
    const tx = live.calls.find((c) => c.command === 'transaction')!.args as { commands: Array<{ args: { note_ids?: number[] } }> };
    expect(tx.commands[0]!.args.note_ids).toEqual([2]);
  });

  it('plans without touching Live on a dry run', async () => {
    const live = client();
    const result = await applyEffect({ post: live.post }, { effect: 'noise_riser', track_id: 3, dry_run: true });
    expect(result.steps.every((s) => s.startsWith('[dry run]'))).toBe(true);
    expect(live.calls.filter((c) => c.command !== 'live.get_tempo')).toEqual([]);
  });
});
