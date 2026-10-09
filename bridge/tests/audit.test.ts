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
import { buildTimeline, isPitched, padRole, placeClipNotes, type ArrangementClipData, type TrackData } from '../../agent/src/timeline.js';

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

  it('splits a Drum Rack into kick, snare, hats and perc parts by pad name', () => {
    const pads = [{ note: 36, name: 'Kick 909' }, { note: 39, name: 'Clap' }, { note: 42, name: 'Closed Hat' }, { note: 51, name: 'Ride' }, { note: 70, name: 'Shaker' }];
    const notes = [...steps('x...x...x...x...', 36, 1, 4), ...steps('....x.......x...', 39, 1, 4), ...steps('..x...x...x...x.', 42, 1, 4), n(51, 0), n(70, 1)];
    const timeline = buildTimeline([track('Drums', notes, 4, { devices: ['DrumGroupDevice'], pads })]);
    expect(timeline.tracks.map((t) => [t.name, t.role, t.notes.length])).toEqual([
      ['Drums > Kick', 'kick', 16], ['Drums > Snare/Clap', 'snare', 8], ['Drums > Hats', 'hats', 17], ['Drums > Perc', 'perc', 1],
    ]);
    // The clips are counted once, on the first part.
    expect(timeline.tracks.map((t) => t.clips.length)).toEqual([1, 0, 0, 0]);
    expect(padRole('Ride')).toBe('hats');
    expect(padRole('Rim')).toBe('snare');
    expect(padRole('Conga Hi')).toBe('perc');
  });

  it('lets the kick inside a Drum Rack anchor the DJ beat-led check', () => {
    const pads = [{ note: 36, name: 'BD' }, { note: 42, name: 'CH' }];
    const notes = [...steps('x...x...x...x...', 36, 1, 64), ...steps('..x...x...x...x.', 42, 1, 64)];
    const timeline = buildTimeline([track('Drums', notes, 64, { devices: ['DrumGroupDevice'], pads })]);
    const text = checkDjEnds(timeline).map((f) => f.message).join('\n');
    expect(text).not.toMatch(/No kick track/);
    expect(text).not.toMatch(/without a kick/);
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

  it('warns when two parts are each displaced in their own way', () => {
    const timeline = buildTimeline([
      KICK(8),
      track('Lead', steps('x..x..x.x..x..x.', 62, 1, 8), 8), // 3-3-2
      track('Stabs', steps('x..x..x..x..x..x', 57, 1, 8), 8), // dotted 8ths across the bar
    ]);
    expect(checkGroove(timeline).findings.some((f) => f.severity === 'warn' && /2 groove layers/.test(f.message))).toBe(true);
  });

  it('counts an octave double and hook hints as the same groove layer (found on Threshold)', () => {
    const timeline = buildTimeline([
      KICK(16),
      track('Lead', steps('x..x..x.x..x..x.', 69, 5, 16), 16),
      track('Lead Oct', steps('x..x..x.x..x..x.', 81, 13, 16), 16),
      track('Str Pizz', steps('x..x..x.........', 62, 1, 4), 16), // a hint of the cell before the lead enters
    ]);
    const { profiles, findings } = checkGroove(timeline);
    expect(findings.some((f) => /groove layers/.test(f.message))).toBe(false);
    expect(profiles.find((p) => p.track === 'Lead Oct')!.follows).toBe('Lead');
    expect(profiles.find((p) => p.track === 'Str Pizz')!.follows).toBe('Lead');
    expect(findings.find((f) => /One groove layer/.test(f.message))!.message).toMatch(/Lead Oct, Str Pizz double or quote its rhythm/);
  });

  it('hears a pitch cycle that turns against the beat as a groove layer, even on regular onsets', () => {
    const triplets = (cycle: number[], bars: number) =>
      Array.from({ length: bars * 12 }, (_, i) => n(cycle[i % cycle.length]!, i / 3, 0.25));
    const sixteenths = (cycle: number[], bars: number) =>
      Array.from({ length: bars * 16 }, (_, i) => n(cycle[i % cycle.length]!, i / 4, 0.2));
    const timeline = buildTimeline([
      KICK(8),
      track('Arp', triplets([64, 71, 76, 67], 8), 8), // Cathedral: a 4-note cycle in 8th-note triplets
      track('Arp 2', sixteenths([57, 60, 64, 69, 72], 8), 8), // Black Glass: a 5-note cycle in 16ths
      track('Keys', sixteenths([60, 64, 67, 72], 8), 8), // 4 in 4: lines up with the beat
    ]);
    const { profiles } = checkGroove(timeline);
    expect(profiles.find((p) => p.track === 'Arp')).toMatchObject({ role: 'groove', cycle: 4 });
    expect(profiles.find((p) => p.track === 'Arp 2')).toMatchObject({ role: 'groove', cycle: 5 });
    expect(profiles.find((p) => p.track === 'Keys')!.role).toBe('straight');
  });

  it('hears a velocity accent cycle against the beat, but not humanised velocity', () => {
    // Black Glass's arp: 16ths on one pitch, accented every third note.
    const accented = Array.from({ length: 8 * 16 }, (_, i) => n(64, i / 4, 0.2, i % 3 === 0 ? 112 : 65));
    // Humanised: velocity wanders 85-105 with no pattern.
    const humanised = Array.from({ length: 8 * 16 }, (_, i) => n(64, i / 4, 0.2, 85 + ((i * 7919) % 21)));
    const timeline = buildTimeline([KICK(8), track('Arp', accented, 8), track('Shaker', humanised, 8)]);
    const { profiles } = checkGroove(timeline);
    expect(profiles.find((p) => p.track === 'Arp')).toMatchObject({ role: 'groove', accentCycle: 3 });
    expect(profiles.find((p) => p.track === 'Shaker')!.role).toBe('straight');
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

  it('measures a long-note line against its own family: stepwise, one note every bar or two', () => {
    // Signature Lead Loop 01's shape: A4, G4, F4, A4, two bars each.
    const line = [69, 67, 65, 69].map((pitch, i) => ({ pitch, start: 8 * i, duration: 8 }));
    const checks = checkLeadNumbers(line);
    expect(checks[0]?.value).toMatch(/long-note line/);
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    // The same notes leaping by octaves fail the stepwise rule.
    const leaping = [57, 69, 57, 69].map((pitch, i) => ({ pitch, start: 8 * i, duration: 8 }));
    expect(checkLeadNumbers(leaping).filter((c) => !c.pass).map((c) => c.check)).toContain('Stepwise motion');
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

  it('warns, not fails, on pitch detected in audio inside the DJ intro, and names it in rubs', () => {
    const vocal: TrackData = {
      track_id: 9, name: 'Vocal',
      clips: [{
        name: 'vox', start: 32, end: 96, is_midi_clip: false, arrangement_index: 0,
        audioNotes: [{ pitch: 65, start: 36, duration: 2, velocity: 100 }, { pitch: 65, start: 68, duration: 2, velocity: 100 }],
        audioAnalysis: { analysed: true, voicedShare: 0.6 },
      }],
    };
    const timeline = buildTimeline([KICK(96), vocal, track('Pad', [n(64, 64, 8)], 96)]);
    const dj = checkDjEnds(timeline).filter((f) => /Vocal/.test(f.message));
    expect(dj.map((f) => f.severity)).toEqual(['warn']);
    expect(dj[0]!.message).toMatch(/pitch detected in its audio in the first 16 bars/);
    const rub = findRubs(timeline)[0]!;
    expect(rub.audio).toBe(true);
    const report = auditTimeline(timeline);
    const step3 = report.steps.find((s) => s.step === 3)!;
    expect(step3.summary).toMatch(/1 audio clip analysed \(2 notes detected\)/);
    expect(step3.findings[0]!.message).toMatch(/pitch detected in audio - confirm by ear/);
  });

  it('says why an audio clip in the DJ ends could not be analysed', () => {
    const vocal: TrackData = {
      track_id: 9, name: 'Vocal',
      clips: [{ name: 'vox', start: 0, end: 16, is_midi_clip: false, arrangement_index: 0, audioNotes: [], audioAnalysis: { analysed: false, reason: 'unwarped (its marker mapping is not measured)', voicedShare: 0 } }],
    };
    const timeline = buildTimeline([KICK(64), vocal]);
    expect(checkDjEnds(timeline).some((f) => /could not be analysed \(unwarped/.test(f.message))).toBe(true);
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
  /**
   * Answers the read commands the audit uses, the way the Remote Script does.
   * `batched: false` is an older bridge that does not know live.get_arrangement_notes.
   */
  function stubLive(options: { batched?: boolean } = {}) {
    const batched = options.batched ?? true;
    const kick = steps('x...x...x...x...', 36, 1, 1, 0.25); // a one-bar loop, placed every bar
    const markers = (length: number) => ({ start_marker: 0, end_marker: length, loop_start: 0, loop_end: length, looping: true });
    const arrangement: Record<number, Array<Record<string, unknown>>> = {
      1: Array.from({ length: 64 }, (_, i) => ({ name: 'kick', start: i * 4, end: i * 4 + 4, length_beats: 4, is_midi_clip: true })),
      2: [{ name: 'pad', start: 64, end: 128, length_beats: 64, is_midi_clip: true }],
    };
    const notesOf = (trackId: unknown) => (trackId === 1 ? { notes: kick, ...markers(4) } : { notes: [n(57, 0, 64)], ...markers(64) });
    const calls: string[] = [];
    const client = {
      async post(command: string, args: Record<string, unknown> = {}) {
        calls.push(command);
        switch (command) {
          case 'live.get_tracks':
            return { tracks: [
              { track_id: 1, name: 'Kick', type: 'midi', devices: [], clips: [{ name: 'kick', slot: 0, is_midi_clip: true }] },
              { track_id: 2, name: 'Pad', type: 'midi', devices: [], clips: [] },
              { track_id: 3, name: 'Group', type: 'audio', devices: [], clips: [] },
            ] };
          case 'live.get_time_signature': return { numerator: 4, denominator: 4 };
          case 'live.get_tempo': return { bpm: 124 };
          case 'live.get_arrangement_notes': {
            if (!batched) throw new Error('UNKNOWN_COMMAND: No such command: live.get_arrangement_notes');
            const clips = arrangement[args.track_id as number];
            if (!clips) throw new Error('UNSUPPORTED: no Arrangement clips on a group track');
            return { clips: clips.map((c, i) => ({ ...c, arrangement_index: i, ...notesOf(args.track_id) })) };
          }
          case 'live.get_arrangement_clips': {
            const clips = arrangement[args.track_id as number];
            if (!clips) throw new Error('UNSUPPORTED: no Arrangement clips on a group track');
            return { clips };
          }
          case 'live.get_notes':
            return notesOf(args.track_id);
          default:
            throw new Error(`unexpected ${command}`);
        }
      },
    };
    return { client, calls };
  }

  for (const batched of [true, false]) {
    it(`reads every Arrangement clip into arrangement time, read-only (${batched ? 'one request per track' : 'per clip, on an older bridge'})`, async () => {
      const { client, calls } = stubLive({ batched });
      const { timeline, tempo, skipped } = await gatherTimeline(client);
      expect(tempo).toBe(124);
      expect(timeline.bars).toBe(64);
      expect(timeline.tracks.find((t) => t.name === 'Kick')!.notes).toHaveLength(256);
      expect(timeline.tracks.find((t) => t.name === 'Pad')!.notes[0]!.start).toBe(64);
      expect(skipped).toEqual([expect.stringMatching(/^Group \(UNSUPPORTED/)]);
      // The Session clip "kick" shares its name with the Arrangement clips, so it is read to compare.
      const noteReads = calls.filter((c) => c === 'live.get_notes').length;
      expect(noteReads).toBe(batched ? 1 : 64 + 1 + 1);
      expect(calls.every((c) => c.startsWith('live.get_'))).toBe(true);
    });
  }

  it('analyses a warped vocal once per distinct clip and places its notes', async () => {
    // A3 for two seconds: beats 0-4 at 120 BPM. The clip is placed twice.
    const rate = 22050;
    const file = new Float32Array(rate * 4).map((_, i) => (i < rate * 2 ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate) : 0));
    let decodes = 0;
    const vox = (start: number, i: number) => ({
      arrangement_index: i, name: 'vox', start, end: start + 8, is_midi_clip: false, start_marker: 0, loop_start: 0, loop_end: 8,
      looping: false, file_path: 'vox.wav', warping: true, pitch_coarse: 0, pitch_fine: 0,
      warp_markers: [{ beat_time: 0, sample_time: 0 }, { beat_time: 8, sample_time: 4 }],
    });
    const client = {
      async post(command: string) {
        switch (command) {
          case 'live.get_tracks': return { tracks: [{ track_id: 4, name: 'Vocal', type: 'audio', devices: [], clips: [] }] };
          case 'live.get_time_signature': return { numerator: 4, denominator: 4 };
          case 'live.get_tempo': return { bpm: 120 };
          case 'live.get_arrangement_notes': return { clips: [vox(64, 0), vox(96, 1)] };
          default: throw new Error(`unexpected ${command}`);
        }
      },
    };
    const { timeline } = await gatherTimeline(client, { decode: async () => { decodes += 1; return file; } });
    const notes = timeline.tracks[0]!.notes;
    expect(decodes).toBe(1);
    expect(notes.map((x) => [x.pitch, x.start, x.audio])).toEqual([[57, 64, true], [57, 96, true]]);
    const none = await gatherTimeline(client, { audio: false, decode: async () => { decodes += 1; return file; } });
    expect(none.timeline.tracks[0]!.notes).toEqual([]);
    expect(decodes).toBe(1);
  });

  it('returns a report whose markdown names the tracks it could not read', async () => {
    const { client } = stubLive();
    const { report, markdown } = await auditTrack(client, { date: '2026-10-07', title: 'Stub' });
    expect(report.tempo).toBe(124);
    expect(markdown).toMatch(/64 bars at 124 BPM/);
    expect(markdown).toMatch(/Tracks not read: Group/);
  });
});

