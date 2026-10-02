/**
 * End-to-end tests against a fake Remote Script.
 *
 * The fake speaks the same newline-delimited JSON protocol as the Python
 * side, so these cover framing, id correlation, reconnect, validation,
 * snapshots and transactions without needing Ableton running.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bridge } from '../src/server.js';
import { Logger } from '../src/logger.js';
import { FakeLive } from './helpers/fake-live.js';

let live: FakeLive;
let bridge: Bridge;

beforeEach(async () => {
  live = new FakeLive();
  await live.listen();
  bridge = new Bridge({
    port: 0,
    livePort: live.port,
    logger: new Logger('silent'),
  });
  await bridge.start();
  await bridge.transport.waitUntilReady(5_000);
});

afterEach(async () => {
  await bridge.stop();
  await live.close();
});

describe('round trip', () => {
  it('forwards a validated command and returns the result', async () => {
    live.handlers.set('live.get_tempo', () => ({ bpm: 124 }));
    await expect(bridge.execute('live.get_tempo', {})).resolves.toEqual({ bpm: 124 });
  });

  it('matches responses to requests by id under concurrency', async () => {
    live.handlers.set('live.get_track', (_command, args) => ({ track_id: args.track_id }));
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((id) => bridge.execute('live.get_track', { track_id: id })),
    );
    expect(results).toEqual([1, 2, 3, 4, 5].map((id) => ({ track_id: id })));
  });

  it('survives a thousand sequential commands without dropping the link', async () => {
    live.handlers.set('live.get_tempo', () => ({ bpm: 124 }));
    for (let i = 0; i < 1000; i += 1) {
      await bridge.execute('live.get_tempo', {});
    }
    expect(bridge.transport.isConnected).toBe(true);
    expect(bridge.transport.status().commandsSent).toBeGreaterThanOrEqual(1000);
  });

  it('re-wraps a Live-side error, keeping its recovery hints', async () => {
    live.handlers.set('live.set_device_parameter', () => {
      throw new Error('nope');
    });
    await expect(
      bridge.execute('live.set_device_parameter', {
        track_id: 1,
        device_id: 2,
        parameter_name: 'Cutoff',
        normalized: 0.5,
      }),
    ).rejects.toMatchObject({ code: 'LIVE_ERROR' });
  });
});

describe('validation happens before Live is touched', () => {
  it('rejects an out-of-range tempo without sending anything', async () => {
    await expect(bridge.execute('live.set_tempo', { bpm: 9999 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(live.received).toHaveLength(0);
  });

  it('rejects an unknown command and lists the real ones', async () => {
    await expect(bridge.execute('live.do_magic', {})).rejects.toMatchObject({
      code: 'UNKNOWN_COMMAND',
    });
    expect(live.received).toHaveLength(0);
  });

  it('rejects a bad note without sending the good ones either', async () => {
    await expect(
      bridge.execute('live.add_notes', {
        track_id: 1,
        clip_slot: 0,
        notes: [
          { pitch: 36, start: 0, duration: 1 },
          { pitch: 200, start: 1, duration: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(live.received).toHaveLength(0);
  });
});

describe('dry run', () => {
  it('reports the operation and changes nothing', async () => {
    const result = (await bridge.execute('live.set_tempo', { bpm: 126 }, { dryRun: true })) as {
      applied: boolean;
      operations: unknown[];
    };
    expect(result.applied).toBe(false);
    expect(result.operations).toEqual([{ command: 'live.set_tempo', args: { bpm: 126 } }]);
    expect(live.received).toHaveLength(0);
  });

  it('still validates, so a dry run catches bad arguments', async () => {
    await expect(
      bridge.execute('live.set_tempo', { bpm: -5 }, { dryRun: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('reconnect', () => {
  it('fails in-flight requests when Live goes away, then recovers', async () => {
    live.handlers.set('live.get_tempo', () => ({ bpm: 124 }));
    await bridge.execute('live.get_tempo', {});

    live.dropClients();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(bridge.execute('live.get_tempo', {})).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });

    await bridge.transport.waitUntilReady(5_000);
    await expect(bridge.execute('live.get_tempo', {})).resolves.toEqual({ bpm: 124 });
  });
});

describe('snapshots', () => {
  function installClipHandlers(notes: Array<Record<string, unknown>>): void {
    let current = [...notes];
    live.handlers.set('live.get_clip', () => ({
      clip_id: 1,
      name: 'Bass Main',
      is_midi_clip: true,
      length_beats: 16,
      loop_start: 0,
      loop_end: 16,
      looping: true,
    }));
    live.handlers.set('live.get_track', () => ({ track_id: 1, name: 'Bass' }));
    live.handlers.set('live.get_notes', () => ({ notes: current }));
    live.handlers.set('live.replace_notes', (_c, args) => {
      current = args.notes as Array<Record<string, unknown>>;
      return { note_count: current.length };
    });
    live.handlers.set('live.set_clip_loop', () => ({ ok: true }));
    live.handlers.set('live.set_clip_name', () => ({ ok: true }));
  }

  it('captures a clip and restores it note for note', async () => {
    installClipHandlers([
      { note_id: 1, pitch: 41, start: 0, duration: 0.5, velocity: 100, mute: false },
      { note_id: 2, pitch: 44, start: 1, duration: 0.5, velocity: 90, mute: false },
    ]);

    const snapshot = (await bridge.execute('live.snapshot_clip', {
      track_id: 1,
      clip_slot: 0,
    })) as { snapshot_id: string; note_count: number };
    expect(snapshot.note_count).toBe(2);

    await bridge.execute('live.replace_notes', { track_id: 1, clip_slot: 0, notes: [] });
    const restored = (await bridge.execute('live.restore_clip', {
      snapshot_id: snapshot.snapshot_id,
    })) as { notes_restored: number };
    expect(restored.notes_restored).toBe(2);

    const after = (await bridge.execute('live.get_notes', {
      track_id: 1,
      clip_slot: 0,
    })) as { notes: Array<{ pitch: number }> };
    expect(after.notes.map((n) => n.pitch)).toEqual([41, 44]);
  });

  it('strips note ids on restore, since Live assigns new ones', async () => {
    installClipHandlers([
      { note_id: 1, pitch: 41, start: 0, duration: 0.5, velocity: 100, mute: false },
    ]);
    const snapshot = (await bridge.execute('live.snapshot_clip', {
      track_id: 1,
      clip_slot: 0,
    })) as { snapshot_id: string };
    live.received = [];
    await bridge.execute('live.restore_clip', { snapshot_id: snapshot.snapshot_id });
    const replace = live.received.find((r) => r.command === 'live.replace_notes')!;
    expect((replace.args.notes as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'note_id',
    );
  });

  it('reports a snapshot id it does not hold', async () => {
    await expect(
      bridge.execute('live.restore_clip', { snapshot_id: 'nope' }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });
});

describe('transactions', () => {
  it('runs every command in order', async () => {
    live.handlers.set('live.set_tempo', (_c, args) => ({ bpm: args.bpm }));
    live.handlers.set('live.rename_track', (_c, args) => ({ name: args.name }));

    const result = (await bridge.execute('transaction', {
      commands: [
        { command: 'live.set_tempo', args: { bpm: 126 } },
        { command: 'live.rename_track', args: { track_id: 1, name: 'Bass' } },
      ],
    })) as { applied: boolean; command_count: number };

    expect(result.applied).toBe(true);
    expect(result.command_count).toBe(2);
    expect(live.received.map((r) => r.command)).toEqual([
      'live.set_tempo',
      'live.rename_track',
    ]);
  });

  it('validates the whole batch before running any of it', async () => {
    live.handlers.set('live.set_tempo', () => ({ bpm: 126 }));
    await expect(
      bridge.execute('transaction', {
        commands: [
          { command: 'live.set_tempo', args: { bpm: 126 } },
          { command: 'live.set_tempo', args: { bpm: 100000 } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(live.received).toHaveLength(0);
  });

  it('says exactly how far it got when a command fails mid-batch', async () => {
    live.handlers.set('live.set_tempo', () => ({ bpm: 126 }));
    live.handlers.set('live.rename_track', () => {
      throw new Error('track is gone');
    });

    await expect(
      bridge.execute('transaction', {
        commands: [
          { command: 'live.set_tempo', args: { bpm: 126 } },
          { command: 'live.rename_track', args: { track_id: 1, name: 'Bass' } },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      details: { failed_index: 1, commands_applied: 1, rolled_back: false },
    });
  });

  it('refuses to nest transactions', async () => {
    await expect(
      bridge.execute('transaction', {
        commands: [{ command: 'transaction', args: { commands: [] } }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('reports the plan without applying it on a dry run', async () => {
    const result = (await bridge.execute(
      'transaction',
      { commands: [{ command: 'live.set_tempo', args: { bpm: 126 } }] },
      { dryRun: true },
    )) as { applied: boolean };
    expect(result.applied).toBe(false);
    expect(live.received).toHaveLength(0);
  });
});

describe('status', () => {
  it('reports the live connection and the command count', async () => {
    const status = bridge.status() as {
      live: { connected: boolean };
      command_count: number;
    };
    expect(status.live.connected).toBe(true);
    expect(status.command_count).toBeGreaterThan(40);
  });
});
