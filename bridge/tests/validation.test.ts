import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/errors.js';
import { commandNames, isKnownCommand, validateArgs } from '../src/validation.js';
import { COMMANDS } from '../src/commands/registry.js';

describe('command surface', () => {
  it('describes every command it validates', () => {
    const described = new Set(COMMANDS.map((c) => c.name));
    for (const name of commandNames) {
      expect(described.has(name), `${name} is missing a catalogue entry`).toBe(true);
      expect(COMMANDS.find((c) => c.name === name)!.summary.length).toBeGreaterThan(0);
    }
  });

  it('rejects unknown commands', () => {
    expect(isKnownCommand('live.get_tempo')).toBe(true);
    expect(isKnownCommand('live.execute_arbitrary_code')).toBe(false);
  });
});

describe('device deletion', () => {
  it('needs a track and a device, and nothing else', () => {
    expect(validateArgs('live.delete_device', { track_id: 3, device_id: 7 })).toEqual({
      track_id: 3,
      device_id: 7,
    });
    expect(() => validateArgs('live.delete_device', { track_id: 3 })).toThrow(ValidationError);
    expect(() => validateArgs('live.delete_device', { track_id: 3, device_id: 7, index: 0 })).toThrow(
      ValidationError,
    );
  });
});

describe('tempo validation', () => {
  it('accepts a sane tempo', () => {
    expect(validateArgs('live.set_tempo', { bpm: 124 })).toEqual({ bpm: 124 });
  });

  it('rejects tempos outside Live range', () => {
    expect(() => validateArgs('live.set_tempo', { bpm: 0 })).toThrow(ValidationError);
    expect(() => validateArgs('live.set_tempo', { bpm: 9999 })).toThrow(ValidationError);
  });

  it('rejects a missing or non-numeric tempo', () => {
    expect(() => validateArgs('live.set_tempo', {})).toThrow(ValidationError);
    expect(() => validateArgs('live.set_tempo', { bpm: '124' })).toThrow(ValidationError);
  });

  it('rejects unknown keys so a typo is never silently ignored', () => {
    expect(() => validateArgs('live.set_tempo', { bpm: 124, tempo: 130 })).toThrow(
      ValidationError,
    );
  });
});

describe('note validation', () => {
  const base = { track_id: 1, clip_slot: 0 };

  it('accepts a well-formed note and defaults velocity', () => {
    const result = validateArgs('live.add_notes', {
      ...base,
      notes: [{ pitch: 36, start: 0, duration: 0.25 }],
    }) as { notes: Array<{ velocity: number }> };
    expect(result.notes[0]!.velocity).toBe(100);
  });

  it('rejects pitches outside 0-127', () => {
    for (const pitch of [-1, 128, 3.5]) {
      expect(() =>
        validateArgs('live.add_notes', { ...base, notes: [{ pitch, start: 0, duration: 1 }] }),
      ).toThrow(ValidationError);
    }
  });

  it('rejects velocities outside 0-127', () => {
    expect(() =>
      validateArgs('live.add_notes', {
        ...base,
        notes: [{ pitch: 36, start: 0, duration: 1, velocity: 200 }],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects zero-length and negative-length notes', () => {
    for (const duration of [0, -1]) {
      expect(() =>
        validateArgs('live.add_notes', {
          ...base,
          notes: [{ pitch: 36, start: 0, duration }],
        }),
      ).toThrow(ValidationError);
    }
  });

  it('rejects negative beat positions', () => {
    expect(() =>
      validateArgs('live.add_notes', {
        ...base,
        notes: [{ pitch: 36, start: -0.25, duration: 1 }],
      }),
    ).toThrow(ValidationError);
  });

  it('accepts a note read back from Live, note_id and all', () => {
    expect(() =>
      validateArgs('live.add_notes', {
        ...base,
        notes: [{ note_id: 7, pitch: 36, start: 0, duration: 0.25, velocity: 100, mute: false }],
      }),
    ).not.toThrow();
  });

  it('requires an update to change something besides note_id', () => {
    expect(() =>
      validateArgs('live.update_notes', { ...base, updates: [{ note_id: 1 }] }),
    ).toThrow(ValidationError);
    expect(() =>
      validateArgs('live.update_notes', { ...base, updates: [{ note_id: 1, pitch: 40 }] }),
    ).not.toThrow();
  });

  it('reports the offending index so an agent can fix just that note', () => {
    try {
      validateArgs('live.add_notes', {
        ...base,
        notes: [
          { pitch: 36, start: 0, duration: 1 },
          { pitch: 999, start: 1, duration: 1 },
        ],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const issues = (error as ValidationError).details.issues as Array<{ path: string }>;
      expect(issues[0]!.path).toContain('notes.1.pitch');
    }
  });
});

describe('parameter writes', () => {
  it('accepts a native value or a normalized one', () => {
    expect(() =>
      validateArgs('live.set_device_parameter', {
        track_id: 1,
        device_id: 2,
        parameter_name: 'Frequency',
        value: 1200,
      }),
    ).not.toThrow();
    expect(() =>
      validateArgs('live.set_device_parameter', {
        track_id: 1,
        device_id: 2,
        parameter_id: 3,
        normalized: 0.5,
      }),
    ).not.toThrow();
  });

  it('refuses a write with neither value nor normalized', () => {
    expect(() =>
      validateArgs('live.set_device_parameter', {
        track_id: 1,
        device_id: 2,
        parameter_name: 'Frequency',
      }),
    ).toThrow(/value.*normalized/i);
  });

  it('refuses a write that names no parameter', () => {
    expect(() =>
      validateArgs('live.set_device_parameter', { track_id: 1, device_id: 2, normalized: 0.5 }),
    ).toThrow(ValidationError);
  });

  it('keeps normalized inside 0..1', () => {
    expect(() =>
      validateArgs('live.set_track_volume', { track_id: 1, normalized: 1.5 }),
    ).toThrow(ValidationError);
  });
});

describe('clip loop validation', () => {
  it('needs a length or an end', () => {
    expect(() => validateArgs('live.set_clip_loop', { track_id: 1, clip_slot: 0 })).toThrow(
      /length.*end/i,
    );
  });

  it('accepts either form', () => {
    expect(() =>
      validateArgs('live.set_clip_loop', { track_id: 1, clip_slot: 0, start: 0, length: 16 }),
    ).not.toThrow();
    expect(() =>
      validateArgs('live.set_clip_loop', { track_id: 1, clip_slot: 0, start: 0, end: 16 }),
    ).not.toThrow();
  });
});

describe('automation validation', () => {
  it('requires at least one breakpoint with a value', () => {
    expect(() =>
      validateArgs('live.set_automation', {
        track_id: 1,
        clip_slot: 0,
        device_id: 2,
        parameter_name: 'Frequency',
        points: [],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      validateArgs('live.set_automation', {
        track_id: 1,
        clip_slot: 0,
        device_id: 2,
        parameter_name: 'Frequency',
        points: [{ beat: 0 }],
      }),
    ).toThrow(ValidationError);
  });

  it('accepts a two-point ramp', () => {
    expect(() =>
      validateArgs('live.set_automation', {
        track_id: 1,
        clip_slot: 0,
        device_id: 2,
        parameter_name: 'Frequency',
        points: [
          { beat: 32, normalized: 0.2 },
          { beat: 64, normalized: 0.8 },
        ],
      }),
    ).not.toThrow();
  });

  // Placing a Session clip on the Arrangement copies its notes but drops its
  // envelopes, so an Arrangement clip is edited in place. Automation accepts
  // the address so the Remote Script can refuse it with UNSUPPORTED and say why.
  it('accepts arrangement_index in place of clip_slot', () => {
    expect(() =>
      validateArgs('live.set_automation', {
        track_id: 1,
        arrangement_index: 3,
        device_id: 2,
        parameter_name: 'Frequency',
        points: [
          { beat: 0, normalized: 0.2 },
          { beat: 64, normalized: 0.8 },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validateArgs('live.get_automation', {
        track_id: 1,
        arrangement_index: 0,
        device_id: 2,
        parameter_name: 'Frequency',
      }),
    ).not.toThrow();
    expect(() =>
      validateArgs('live.clear_automation', {
        track_id: 1,
        arrangement_index: 0,
        device_id: 2,
        parameter_name: 'Frequency',
      }),
    ).not.toThrow();
  });

  it('rejects both clip_slot and arrangement_index, and neither', () => {
    for (const target of [
      { clip_slot: 0, arrangement_index: 0 },
      {},
    ]) {
      expect(() =>
        validateArgs('live.get_automation', {
          track_id: 1,
          ...target,
          device_id: 2,
          parameter_name: 'Frequency',
        }),
      ).toThrow(ValidationError);
    }
  });

  it('rejects a negative or non-integer arrangement_index', () => {
    for (const arrangement_index of [-1, 1.5]) {
      expect(() =>
        validateArgs('live.get_automation', {
          track_id: 1,
          arrangement_index,
          device_id: 2,
          parameter_name: 'Frequency',
        }),
      ).toThrow(ValidationError);
    }
  });

  it('lets notes be read and updated on an Arrangement clip', () => {
    expect(() =>
      validateArgs('live.get_notes', { track_id: 1, arrangement_index: 2 }),
    ).not.toThrow();
    expect(() =>
      validateArgs('live.update_notes', {
        track_id: 1,
        arrangement_index: 2,
        updates: [{ note_id: 7, pitch: 76 }],
      }),
    ).not.toThrow();
    expect(() =>
      validateArgs('live.update_notes', {
        track_id: 1,
        clip_slot: 0,
        arrangement_index: 2,
        updates: [{ note_id: 7, pitch: 76 }],
      }),
    ).toThrow(ValidationError);
  });

  it('keeps destructive note commands Session-only', () => {
    for (const command of ['live.replace_notes', 'live.add_notes'] as const) {
      expect(() =>
        validateArgs(command, { track_id: 1, arrangement_index: 0, notes: [] }),
      ).toThrow(ValidationError);
    }
  });
});
