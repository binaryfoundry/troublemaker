/**
 * The track audit as code: the timeline, GROOVE.md's hierarchy, CAMELPHAT.md's
 * lead numbers, HOOKS.md's map, EMOTION.md's peak, and the audit steps, on
 * small hand-built Arrangements. Properties, not exact reports.
 */

import { describe, expect, it } from 'vitest';

import type { Note } from '../src/protocol.js';
import { auditTrack, gatherTimeline } from '../src/workflows.js';
import { auditTimeline, checkDjEnds, checkHygiene, checkRanges, findRubs, formatAuditReport, instrumentFor } from '../../agent/src/audit.js';
import { checkLeadNumbers } from '../../agent/src/camelphat.js';
import { checkEmotion } from '../../agent/src/emotion.js';
import { checkGroove, grooveProfile, isDisplacedBar } from '../../agent/src/groove.js';
import { checkHook } from '../../agent/src/hooks.js';
import { buildTimeline, isPitched, placeClipNotes, type ArrangementClipData, type TrackData } from '../../agent/src/timeline.js';

// --- builders --------------------------------------------------------------

const n = (pitch: number, start: number, duration = 0.25, velocity = 100): Note => ({ pitch, start, duration, velocity });

/** Notes from a 16-step pattern repeated over bars [from, to] (1-based, inclusive). */
function steps(pattern: string, pitch: number | ((bar: number, step: number) => number), from: number, to: number, duration = 0.2): Note[] {
  const out: Note[] = [];
  for (let bar = from; bar <= to; bar += 1) {
    [...pattern.replace(/\s/g, '')].forEach((c, i) => {
      if (c === 'x') out.push(n(typeof pitch === 'number' ? pitch : pitch(bar, i), (bar - 1) * 4 + i * 0.25, duration));
    });
  }
  return out;
}

/** One Arrangement clip from beat 0 holding notes already in arrangement beats. */
function track(name: string, notes: Note[], bars: number, extra: Partial<TrackData> = {}): TrackData {
  return {
    track_id: Math.floor(Math.random() * 1e6),
    name,
    clips: [{ name, start: 0, end: bars * 4, is_midi_clip: true, arrangement_index: 0, notes }],
    ...extra,
  };
}

const KICK = (bars: number, from = 1, to = bars) => track('Kick', steps('x...x...x...x...', 36, from, to, 0.25), bars);

// --- timeline ----------------------------------------------------------------

describe('timeline', () => {
  it('places a clip\'s notes at its Arrangement position', () => {
    const clip: ArrangementClipData = { name: 'a', start: 32, end: 36, is_midi_clip: true, arrangement_index: 0, notes: [n(60, 0), n(62, 1)] };
    const placed = placeClipNotes(clip);
    expect(placed.notes.map((x) => x.start)).toEqual([32, 33]);
    expect(placed.wrapped).toBe(false);
  });

  it('wraps a looped clip that is longer than its loop', () => {
    const clip: ArrangementClipData = {
      name: 'a', start: 0, end: 8, is_midi_clip: true, arrangement_index: 0,
      notes: [n(60, 0), n(62, 2)], looping: true, loop_start: 0, loop_end: 4, start_marker: 0,
    };
    const placed = placeClipNotes(clip);
    expect(placed.notes.map((x) => x.start)).toEqual([0, 2, 4, 6]);
    expect(placed.wrapped).toBe(true);
  });

  it('starts from the start marker and skips muted notes', () => {
    const clip: ArrangementClipData = {
      name: 'a', start: 16, end: 18, is_midi_clip: true, arrangement_index: 0,
      notes: [n(60, 0), n(62, 2), { ...n(64, 3), mute: true }], looping: false, start_marker: 2, end_marker: 4,
    };
    expect(placeClipNotes(clip).notes.map((x) => [x.pitch, x.start])).toEqual([[62, 16]]);
  });

  it('treats drum roles, Drum Racks and drum names as unpitched', () => {
    expect(isPitched('Kick', 'kick')).toBe(false);
    expect(isPitched('Rack', 'unknown', ['DrumGroupDevice'])).toBe(false);
    expect(isPitched('Drums', 'unknown')).toBe(false);
    expect(isPitched('Lead', 'lead')).toBe(true);
    expect(isPitched('Riser', 'atmosphere', [], ['Riser'])).toBe(false);
  });
});

// --- GROOVE.md -----------------------------------------------------------------

describe('groove hierarchy (GROOVE.md 15, 26)', () => {
  it('reads a pattern that repeats on the beat as straight, however busy', () => {
    expect(isDisplacedBar([...'xxxxxxxxxxxxxxxx'].map((c) => c === 'x'))).toBe(false); // 16th hats
    expect(isDisplacedBar([...'.xxx.xxx.xxx.xxx'].map((c) => c === 'x'))).toBe(false); // KBBB roll
    expect(isDisplacedBar([...'..x...x...x...x.'].map((c) => c === 'x'))).toBe(false); // offbeat bass
    expect(isDisplacedBar([...'x..x..x.x..x..x.'].map((c) => c === 'x'))).toBe(true); // 3-3-2
  });

  it('finds one groove layer over a straight kick and a rolling bass', () => {
    const timeline = buildTimeline([
      KICK(8),
      track('Bass', steps('.xxx.xxx.xxx.xxx', 38, 1, 8), 8),
      track('Lead', steps('x..x..x.x..x..x.', 62, 1, 8), 8),
    ]);
    const { profiles, findings } = checkGroove(timeline);
    expect(profiles.find((p) => p.track === 'Kick')!.role).toBe('anchor');
    expect(profiles.find((p) => p.track === 'Bass')!.role).toBe('straight');
    expect(profiles.find((p) => p.track === 'Lead')!.role).toBe('groove');
    expect(findings.filter((f) => f.severity === 'warn')).toEqual([]);
  });

  it('warns when two parts are both the groove layer', () => {
    const timeline = buildTimeline([
      KICK(8),
      track('Lead', steps('x..x..x.x..x..x.', 62, 1, 8), 8),
      track('Stabs', steps('...x..x....x..x.', 57, 1, 8), 8),
    ]);
    expect(checkGroove(timeline).findings.some((f) => f.severity === 'warn' && /2 groove layers/.test(f.message))).toBe(true);
  });

  it('measures a dotted-8th line as dotted', () => {
    const notes: Note[] = [];
    for (let t = 0; t < 32; t += 0.75) notes.push(n(45, t, 0.25));
    const timeline = buildTimeline([track('Bass', notes, 8)]);
    expect(grooveProfile(timeline, timeline.tracks[0]!).dottedShare).toBeGreaterThan(0.9);
  });

  it('warns when the kick leaves the beat', () => {
    const timeline = buildTimeline([track('Kick', [...steps('x...x...x...x...', 36, 1, 4), n(36, 2.75)], 4)]);
    expect(checkGroove(timeline).findings.some((f) => /off the beat/.test(f.message))).toBe(true);
  });
});

// --- CAMELPHAT.md 6 ------------------------------------------------------------------

describe('lead numbers (CAMELPHAT.md 6)', () => {
  it('passes a pack-shaped lead: anchor floor, 3-3-2 cell, short notes, one register', () => {
    // 3-3-2 twice per bar on A57 with steps up to C60 and E64.
    const shape = [57, 57, 60, 57, 57, 64];
    const lead = steps('x..x..x.x..x..x.', (_, i) => shape[[0, 3, 6, 8, 11, 14].indexOf(i)]!, 1, 4, 0.3);
    const failed = checkLeadNumbers(lead).filter((c) => !c.pass).map((c) => c.check);
    expect(failed).toEqual([]);
  });

  it('fails an arpeggio that climbs out of the register on every 16th', () => {
    const arp = steps('xxxxxxxxxxxxxxxx', (bar, i) => 60 + ((i * 7 + bar * 5) % 24), 1, 4, 0.25);
    const failed = checkLeadNumbers(arp).filter((c) => !c.pass).map((c) => c.check);
    expect(failed).toEqual(expect.arrayContaining(['Onsets a bar', 'Anchor share', 'Range', 'Register']));
  });
});

// --- HOOKS.md --------------------------------------------------------------------

describe('hook map and audit (HOOKS.md 11, 18, 41, 42)', () => {
  const cell = (bar: number, i: number) => [62, 62, 65, 62, 62, 69][[0, 3, 6, 8, 11, 14].indexOf(i)]!;

  it('maps first appearance, removal and return, and the nucleus length', () => {
    const notes = [...steps('x..x..x.x..x..x.', cell, 17, 32), ...steps('x..x..x.x..x..x.', cell, 49, 64)];
    const timeline = buildTimeline([KICK(80), track('Lead', notes, 80)]);
    const { map, findings } = checkHook(timeline, timeline.tracks[1]!);
    expect(map.firstFull).toBe(17);
    expect(map.removedAt).toBe(33);
    expect(map.returnsAt).toBe(49);
    expect(map.nucleusBars).toBe(1);
    expect(map.identity).toBe(1);
    expect(findings.some((f) => /never removed/.test(f.message))).toBe(false);
  });

  it('warns when the hook is never removed', () => {
    const timeline = buildTimeline([track('Lead', steps('x..x..x.x..x..x.', cell, 17, 64), 80)]);
    expect(checkHook(timeline, timeline.tracks[0]!).findings.some((f) => /never removed/.test(f.message))).toBe(true);
  });

  it('warns when the hook plays the notes the pad is holding', () => {
    const pad = track('Pad', Array.from({ length: 8 }, (_, b) => [n(62, b * 4, 4), n(65, b * 4, 4), n(69, b * 4, 4)]).flat(), 8);
    const timeline = buildTimeline([pad, track('Lead', steps('x..x..x.x..x..x.', cell, 1, 8), 8)]);
    expect(checkHook(timeline, timeline.tracks[1]!).findings.some((f) => /fuses into it/.test(f.message))).toBe(true);
  });

  it('lists another part that quotes the hook\'s cell, in any transposition', () => {
    const timeline = buildTimeline([
      track('Lead', steps('x..x..x.x..x..x.', cell, 17, 32), 48),
      track('Violins', steps('x..x..x.x..x..x.', (b, i) => cell(b, i) + 12, 41, 41), 48),
    ]);
    const quote = checkHook(timeline, timeline.tracks[0]!).findings.find((f) => /quotes/.test(f.message));
    expect(quote?.message).toMatch(/Violins quotes Lead's opening cell at bar 41/);
  });
});

// --- EMOTION.md ------------------------------------------------------------------

describe('emotion (EMOTION.md 53, 55, 56)', () => {
  it('warns when the highest note is spent before the peak', () => {
    const timeline = buildTimeline([
      KICK(96),
      track('Lead', [...steps('x.......x.......', 62, 33, 48), n(84, 40 * 4), ...steps('x...x...x...x...', 64, 65, 80)], 96),
      track('Pad', steps('x...............', 50, 65, 80, 4), 96),
    ]);
    const { findings } = checkEmotion(timeline, { peak: { from: 65, to: 80 } });
    expect(findings.some((f) => f.severity === 'warn' && /highest note .* bar 41/.test(f.message))).toBe(true);
  });

  it('notes a kick that is never withheld in the body of the track', () => {
    const timeline = buildTimeline([KICK(128)]);
    expect(checkEmotion(timeline).findings.some((f) => /kick is never out/.test(f.message))).toBe(true);
  });

  it('does not ask for withholding when there is no body between the DJ intro and outro', () => {
    const timeline = buildTimeline([KICK(72)]);
    expect(checkEmotion(timeline).findings.some((f) => /never out/.test(f.message))).toBe(false);
  });

  it('accepts a kick taken out for a breakdown', () => {
    const timeline = buildTimeline([track('Kick', [...steps('x...x...x...x...', 36, 1, 48), ...steps('x...x...x...x...', 36, 65, 128)], 128)]);
    expect(checkEmotion(timeline).findings.some((f) => /kick is never out/.test(f.message))).toBe(false);
  });
});

// --- the audit steps -----------------------------------------------------------------

describe('audit steps', () => {
  it('fails a clip off the bar grid and a stray ref clip', () => {
    const timeline = buildTimeline([
      { track_id: 1, name: 'Lead', clips: [
        { name: 'hook', start: 64, end: 72, is_midi_clip: true, arrangement_index: 0, notes: [] },
        { name: 'ref', start: 67.4, end: 75.4, is_midi_clip: true, arrangement_index: 1, notes: [] },
      ] },
    ]);
    const text = checkHygiene(timeline).map((f) => `${f.severity}: ${f.message}`).join('\n');
    expect(text).toMatch(/fail: Lead: clip "ref" starts at beat 67\.4/);
    expect(text).toMatch(/stray reference clip/);
  });

  it('flags an Arrangement copy that differs from its Session clip', () => {
    const timeline = buildTimeline([{
      track_id: 1, name: 'Bass',
      clips: [{ name: 'loop', start: 0, end: 4, is_midi_clip: true, arrangement_index: 0, notes: [n(38, 0), n(38, 1)] }],
      session: [{ name: 'loop', slot: 0, notes: [n(38, 0), n(40, 1)] }],
    }]);
    expect(checkHygiene(timeline).some((f) => /differ from their Session clip/.test(f.message))).toBe(true);
  });

  it('fails pitched material in the first 16 bars and bars without a kick on every beat', () => {
    const timeline = buildTimeline([
      track('Kick', [...steps('x...x...x...x...', 36, 1, 9), ...steps('x...x...x...x...', 36, 11, 96)], 96),
      track('Pad', steps('x...............', 57, 9, 80, 4), 96),
    ]);
    const text = checkDjEnds(timeline).filter((f) => f.severity === 'fail').map((f) => f.message).join('\n');
    expect(text).toMatch(/Pad: pitched notes in the first 16 bars \(from bar 9\)/);
    expect(text).toMatch(/kick on every beat .*bar 10/);
  });

  it('counts a held chord as playing until it ends (found on Live: a pad "left" a bar early)', () => {
    // Two-bar chords from bar 9; the last one starts at bar 39 and holds through bar 40.
    const pad = Array.from({ length: 16 }, (_, i) => n(57, (8 + i * 2) * 4, 8));
    const timeline = buildTimeline([KICK(96), track('Pad', pad, 96)]);
    expect(checkDjEnds(timeline).some((f) => /Pad leaves after bar/.test(f.message))).toBe(false);
  });

  it('finds a semitone held across two parts, but not a 32nd tail', () => {
    const timeline = buildTimeline([
      track('Pad', [n(64, 0, 4)], 4),
      track('Lead', [n(65, 1, 1), n(77, 3.9, 0.5)], 4), // F against E for a beat; a short tail at the end
    ]);
    const rubs = findRubs(timeline);
    expect(rubs).toHaveLength(1);
    expect(rubs[0]).toMatchObject({ bar: 1, pitches: [64, 65], overlap: 1 });
  });

  it('range-checks an orchestral part by its name, in scientific pitch', () => {
    expect(instrumentFor('Violins I')).toBe('violin');
    expect(instrumentFor('Celli')).toBe('cello');
    expect(instrumentFor('Bass')).toBeNull();
    const timeline = buildTimeline([track('Violins', [n(52, 0), n(60, 1)], 1)]);
    expect(checkRanges(timeline)[0]!.message).toMatch(/E2 in Live/);
  });

  it('runs all eleven steps, marks the unmeasurable ones manual, and reports failures first', () => {
    const timeline = buildTimeline([
      KICK(96),
      track('Bass', steps('.xxx.xxx.xxx.xxx', 38, 33, 80), 96),
      track('Lead', steps('x..x..x.x..x..x.', 62, 3, 64), 96), // enters in the DJ intro
    ]);
    const report = auditTimeline(timeline, { date: '2026-10-07', title: 'Test' });
    expect(report.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const status = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(status['DJ intro and outro']).toBe('FAIL');
    expect(status['Automation']).toBe('MANUAL');
    expect(status['Mix']).toBe('MANUAL');
    const markdown = formatAuditReport(report, timeline);
    expect(markdown).toMatch(/## Audit 2026-10-07: Test/);
    expect(markdown.indexOf('DJ intro and outro - FAIL')).toBeLessThan(markdown.indexOf('Automation - MANUAL'));
    expect(markdown).toMatch(/Arrangement map/);
  });

  it('asks for the hook rather than guessing between several lead parts', () => {
    const timeline = buildTimeline([track('Lead', [n(60, 0)], 4), track('Arp', [n(64, 0)], 4)]);
    const hook = auditTimeline(timeline).steps.find((s) => s.name === 'Hook')!;
    expect(hook.status).toBe('MANUAL');
    expect(hook.summary).toMatch(/name the primary hook/);
  });
});

// --- the workflow, against a stub Live -----------------------------------------------

describe('auditTrack workflow', () => {
  /** Answers the read commands the audit uses, the way the Remote Script does. */
  function stubLive() {
    const kick = steps('x...x...x...x...', 36, 1, 1, 0.25); // a one-bar loop, placed every bar
    const calls: string[] = [];
    const client = {
      async post(command: string, args: Record<string, unknown> = {}) {
        calls.push(command);
        switch (command) {
          case 'live.get_tracks':
            return { tracks: [
              { track_id: 1, name: 'Kick', type: 'midi', devices: [{ class_name: 'DrumGroupDevice' }], clips: [{ name: 'kick', slot: 0, is_midi_clip: true }] },
              { track_id: 2, name: 'Pad', type: 'midi', devices: [], clips: [] },
              { track_id: 3, name: 'Group', type: 'audio', devices: [], clips: [] },
            ] };
          case 'live.get_time_signature': return { numerator: 4, denominator: 4 };
          case 'live.get_tempo': return { bpm: 124 };
          case 'live.get_arrangement_clips':
            if (args.track_id === 1) return { clips: Array.from({ length: 64 }, (_, i) => ({ name: 'kick', start: i * 4, end: i * 4 + 4, length_beats: 4, is_midi_clip: true })) };
            if (args.track_id === 2) return { clips: [{ name: 'pad', start: 64, end: 128, length_beats: 64, is_midi_clip: true }] };
            throw new Error('UNSUPPORTED: no Arrangement clips on a group track');
          case 'live.get_notes':
            if (args.track_id === 1) return { notes: kick, start_marker: 0, end_marker: 4, loop_start: 0, loop_end: 4, looping: true };
            return { notes: [n(57, 0, 64)], start_marker: 0, end_marker: 64, loop_start: 0, loop_end: 64, looping: true };
          default:
            throw new Error(`unexpected ${command}`);
        }
      },
    };
    return { client, calls };
  }

  it('reads every Arrangement clip into arrangement time, read-only, and skips what it cannot read', async () => {
    const { client, calls } = stubLive();
    const { timeline, tempo, skipped } = await gatherTimeline(client);
    expect(tempo).toBe(124);
    expect(timeline.bars).toBe(64);
    expect(timeline.tracks.find((t) => t.name === 'Kick')!.notes).toHaveLength(256);
    expect(timeline.tracks.find((t) => t.name === 'Pad')!.notes[0]!.start).toBe(64);
    expect(skipped).toEqual([expect.stringMatching(/^Group \(UNSUPPORTED/)]);
    // Session copies are compared: slot 0 "kick" shares its name with the Arrangement clips.
    expect(calls.filter((c) => c === 'live.get_notes').length).toBe(64 + 1 + 1);
    expect(calls.every((c) => c.startsWith('live.get_'))).toBe(true);
  });

  it('returns a report whose markdown names the tracks it could not read', async () => {
    const { client } = stubLive();
    const { report, markdown } = await auditTrack(client, { date: '2026-10-07', title: 'Stub' });
    expect(report.tempo).toBe(124);
    expect(markdown).toMatch(/64 bars at 124 BPM/);
    expect(markdown).toMatch(/Tracks not read: Group/);
  });
});

