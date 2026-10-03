import { describe, expect, it } from 'vitest';

import {
  CHORD_FLOOR,
  lcm,
  noteMs,
  progression,
  voicedChord,
  voiceLead,
} from '../../agent/src/music-theory.js';
import {
  euclidean,
  fill,
  impact,
  polymeterClip,
  polyrhythm,
  retriggerRamp,
  risingNotes,
  toNotes,
} from '../../agent/src/patterns.js';
import { silenceGap } from '../../agent/src/transforms.js';
import {
  arrangementCommands,
  checkArrangement,
  planArrangement,
  styleNames,
} from '../../agent/src/arrangement.js';
import { validateArgs } from '../src/validation.js';
import type { Note } from '../src/protocol.js';

describe('tempo-synced timing', () => {
  it('matches the COMPOSITION.md table', () => {
    expect(noteMs(120, 4)).toBe(500);
    expect(noteMs(124, 16)).toBe(120.97);
    expect(noteMs(128, 8)).toBe(234.38);
    expect(noteMs(120, 8, { dotted: true })).toBe(375);
    expect(noteMs(120, 8, { triplet: true })).toBe(166.67);
  });

  it('computes polymeter realignment', () => {
    expect(lcm(3, 4)).toBe(12);
    expect(lcm(5, 7)).toBe(35);
    expect(lcm(4, 5)).toBe(20);
  });
});

describe('voicings and progressions', () => {
  it('builds seventh and ninth chords from the scale', () => {
    // C major degree 1 seventh: C E G B.
    expect(voicedChord('C', 'major', 1, 'seventh').map((p) => p % 12)).toEqual([0, 4, 7, 11]);
    // Ninth drops the fifth: C E B D.
    expect(voicedChord('C', 'major', 1, 'ninth').map((p) => p % 12)).toEqual([0, 4, 11, 2]);
  });

  it('suspends within the scale', () => {
    expect(voicedChord('C', 'major', 1, 'sus2').map((p) => p % 12)).toEqual([0, 2, 7]);
    expect(voicedChord('C', 'major', 1, 'sus4').map((p) => p % 12)).toEqual([0, 5, 7]);
  });

  it('keeps every chord voice out of the sub register', () => {
    for (const chord of progression('F', 'minor', [1, 6, 3, 7], { octave: 1 })) {
      expect(Math.min(...chord)).toBeGreaterThanOrEqual(CHORD_FLOOR);
    }
  });

  it('voice-leads with less movement than parallel chords', () => {
    const degrees = [1, 6, 3, 7];
    const parallel = progression('F', 'minor', degrees, { voicing: 'seventh', voiceLed: false });
    const led = progression('F', 'minor', degrees, { voicing: 'seventh' });
    const motion = (chords: number[][]) =>
      chords.slice(1).reduce((sum, c, i) => sum + c.reduce((s, p, j) => s + Math.abs(p - chords[i]![j]!), 0), 0);
    expect(motion(led)).toBeLessThan(motion(parallel));
  });

  it('keeps pitch classes when re-voicing', () => {
    const chords = [voicedChord('D', 'dorian', 1, 'seventh'), voicedChord('D', 'dorian', 4, 'seventh')];
    const led = voiceLead(chords);
    led.forEach((c, i) => {
      expect(new Set(c.map((p) => p % 12))).toEqual(new Set(chords[i]!.map((p) => p % 12)));
    });
  });
});

describe('advanced rhythm', () => {
  it('spreads Euclidean hits evenly and starts on a hit', () => {
    expect(euclidean(3, 8)).toEqual([true, false, false, true, false, false, true, false]);
    expect(euclidean(4, 16).filter(Boolean)).toHaveLength(4);
    expect(euclidean(5, 16)[0]).toBe(true);
    expect(euclidean(3, 8, 1)).toEqual([false, true, false, false, true, false, false, true]);
  });

  it('rejects impossible Euclidean shapes', () => {
    expect(() => euclidean(9, 8)).toThrow(RangeError);
  });

  it('places a 3:2 polyrhythm on one shared cycle', () => {
    const pattern = polyrhythm({ a: 3, b: 2, pitchA: 37, pitchB: 36, cycleBeats: 4 });
    const at = (pitch: number) => pattern.events.filter((e) => e.pitch === pitch).map((e) => e.beat);
    expect(at(37)).toEqual([0, 1.333333, 2.666667]);
    expect(at(36)).toEqual([0, 2]);
  });

  it('writes a polymetric clip with its own loop length and realignment', () => {
    const clip = polymeterClip({ steps: 5, pitch: 42 });
    expect(clip.length_beats).toBe(1.25);
    expect(clip.realignsAfterBars).toBe(5);
    expect(clip.events.every((e) => e.beat < 1.25)).toBe(true);
  });

  it('decelerates a retrigger: intervals grow by a constant ratio, pitch stays put', () => {
    const ramp = retriggerRamp({ pitch: 72, startHz: 30, endHz: 3, durationBeats: 4, bpm: 124 });
    const beats = ramp.events.map((e) => e.beat);
    const gaps = beats.slice(1).map((b, i) => b - beats[i]!);
    expect(gaps.at(-1)!).toBeGreaterThan(gaps[0]! * 5);
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]! - 1e-6);
    expect(new Set(ramp.events.map((e) => e.pitch))).toEqual(new Set([72]));
  });

  it('accelerates a ratchet when the rates are reversed', () => {
    const ramp = retriggerRamp({ pitch: 72, startHz: 3, endHz: 30, durationBeats: 4, bpm: 124 });
    const beats = ramp.events.map((e) => e.beat);
    expect(beats[1]! - beats[0]!).toBeGreaterThan(beats.at(-1)! - beats.at(-2)!);
  });

  it('can make a deliberate pitch-dropping hybrid', () => {
    const ramp = retriggerRamp({ pitch: 72, startHz: 20, endHz: 4, durationBeats: 2, bpm: 124, pitchDrop: 12 });
    expect(ramp.events.at(-1)!.pitch).toBeLessThan(72);
  });

  it('builds a fill that tightens and gets louder into the boundary', () => {
    const f = fill({ pitches: [38, 45], beats: 2, endBeat: 16 });
    expect(f.events[0]!.beat).toBe(14);
    expect(f.events.at(-1)!.beat).toBeLessThan(16);
    expect(f.events.at(-1)!.velocity).toBeGreaterThan(f.events[0]!.velocity);
    const gaps = f.events.slice(1).map((e, i) => e.beat - f.events[i]!.beat);
    expect(gaps.at(-1)!).toBeLessThan(gaps[0]!);
  });

  it('climbs a tonal riser through the scale, crowding towards the end', () => {
    const r = risingNotes({ root: 'F', scale: 'minor', startPitch: 65, semitones: 12, beats: 8 });
    const pitches = r.events.map((e) => e.pitch);
    expect(pitches).toEqual([...pitches].sort((a, b) => a - b));
    expect(r.events[1]!.beat - r.events[0]!.beat).toBeGreaterThan(r.events.at(-1)!.beat - r.events.at(-2)!.beat);
  });

  it('produces notes the bridge accepts', () => {
    for (const pattern of [
      retriggerRamp({ pitch: 60, startHz: 30, endHz: 3, durationBeats: 4, bpm: 124 }),
      fill({ pitches: [38], endBeat: 4 }),
      risingNotes({ root: 'F', startPitch: 60, beats: 8 }),
      impact({ pitch: 36, atBeat: 0 }),
      polymeterClip({ steps: 7, pitch: 42 }),
    ]) {
      expect(() => validateArgs('live.add_notes', { track_id: 1, clip_slot: 0, notes: toNotes(pattern) })).not.toThrow();
    }
  });
});

describe('silence gap', () => {
  it('clears the window before a drop and trims notes ringing into it', () => {
    const notes: Note[] = [
      { note_id: 1, pitch: 36, start: 15, duration: 0.5, velocity: 100 },
      { note_id: 2, pitch: 36, start: 15.75, duration: 0.25, velocity: 100 },
      { note_id: 3, pitch: 48, start: 14, duration: 2, velocity: 100 },
    ];
    const plan = silenceGap(notes, 15.5, 16);
    expect(plan.removals).toEqual([2]);
    expect(plan.updates).toEqual([{ note_id: 3, duration: 1.5 }]);
  });
});

describe('arrangement', () => {
  it('has templates for the styles in COMPOSITION.md', () => {
    expect(styleNames()).toEqual(expect.arrayContaining(['house', 'deep_house', 'techno', 'melodic_techno']));
  });

  it('plans consecutive sections on the 8-bar grid', () => {
    const plan = planArrangement('house');
    expect(plan[0]!.startBar).toBe(1);
    for (let i = 1; i < plan.length; i += 1) {
      expect(plan[i]!.startBar).toBe(plan[i - 1]!.startBar + plan[i - 1]!.bars);
    }
    expect(checkArrangement(plan).some((f) => f.severity === 'review')).toBe(false);
  });

  it('gives each section its job when a style names no roles: beat-led intro and outro, kickless break, full peak', () => {
    const plan = planArrangement('techno');
    const at = (bar: number) => plan.find((s) => bar >= s.startBar && bar < s.startBar + s.bars)!;
    expect(at(1).roles).toEqual(['kick', 'hats']);
    expect(at(17).roles).toContain('atmosphere');
    expect(at(97).roles).not.toContain('kick');
    expect(at(97).roles).not.toContain('bass');
    expect(at(105).roles).toContain('lead');
    expect(at(113).roles).toHaveLength(8);
    expect(at(185).roles).toEqual(['kick', 'hats']);
    for (const s of plan) expect(s.bars).toBeLessThanOrEqual(24);
    expect(checkArrangement(plan).some((f) => f.severity === 'review')).toBe(false);
  });

  it('plays the MELODIC-TECHNO.md 192-bar plan as written', () => {
    const plan = planArrangement('melodic_techno');
    expect(plan.map((s) => s.name)).toEqual([
      'Intro', 'Groove', 'Low End', 'Motif Tease', 'Build', 'Break', 'Drop A', 'Drop A Variation', 'Reset', 'Peak Build', 'Final Peak', 'Outro',
    ]);
    expect(plan.every((s) => s.bars === 16)).toBe(true);
    const by = (name: string) => plan.find((s) => s.name === name)!;
    expect(by('Intro').roles).toEqual(['kick', 'perc', 'atmosphere']);
    expect(by('Break').roles).not.toContain('kick');
    expect(by('Reset').roles).not.toContain('lead');
    expect(by('Peak Build').roles).not.toContain('lead');
    expect(by('Final Peak').roles).toContain('lead');
    expect(checkArrangement(plan).filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('flags a break that differs from the drop only by the kick, and a final peak with nothing new', () => {
    const findings = checkArrangement([
      { name: 'Intro', startBar: 1, bars: 16, energy: 0.3, roles: ['kick', 'hats'] },
      { name: 'Peak A', startBar: 17, bars: 16, energy: 0.9, roles: ['kick', 'hats', 'bass', 'lead'] },
      { name: 'Break', startBar: 33, bars: 16, energy: 0.5, roles: ['hats', 'bass', 'lead'] },
      { name: 'Peak B', startBar: 49, bars: 16, energy: 0.9, roles: ['kick', 'hats', 'bass', 'lead'] },
      { name: 'Outro', startBar: 65, bars: 16, energy: 0.3, roles: ['kick', 'hats'] },
    ]).map((f) => f.message).join(' ');
    expect(findings).toMatch(/only by the kick/);
    expect(findings).toMatch(/brings nothing new/);
  });

  it('flags a DJ intro without a kick', () => {
    const findings = checkArrangement([
      { name: 'Intro', startBar: 1, bars: 16, energy: 0.3, roles: ['hats'] },
      { name: 'Peak', startBar: 17, bars: 16, energy: 1, roles: ['hats', 'kick'] },
    ]);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/no kick/);
  });

  it('only plays roles the track has', () => {
    const plan = planArrangement('melodic_techno', { roles: ['kick', 'bass', 'chords', 'hats'] });
    for (const s of plan) expect(s.roles.every((r) => ['kick', 'bass', 'chords', 'hats'].includes(r))).toBe(true);
  });

  it('flags a static stretch, an off-grid section and a full intro', () => {
    const findings = checkArrangement([
      { name: 'Intro', startBar: 1, bars: 16, energy: 1, roles: ['kick', 'bass'] },
      { name: 'A', startBar: 17, bars: 16, energy: 1, roles: ['kick', 'bass'] },
      { name: 'B', startBar: 33, bars: 12, energy: 1, roles: ['kick', 'bass'] },
      { name: 'C', startBar: 45, bars: 16, energy: 0.5, roles: ['kick'] },
    ]);
    const messages = findings.map((f) => f.message).join(' ');
    expect(messages).toMatch(/No change in roles or energy for 44 bars/);
    expect(messages).toMatch(/off the 8-bar grid/);
    expect(messages).toMatch(/intro or outro is as full as the peak/);
  });

  it('repeats each role loop across the sections it plays in', () => {
    const plan = [
      { name: 'Intro', startBar: 1, bars: 8, energy: 0.3, roles: ['hats'] },
      { name: 'Main', startBar: 9, bars: 8, energy: 0.9, roles: ['hats', 'kick'] },
    ];
    const commands = arrangementCommands(plan, {
      hats: { track_id: 4, clip_slot: 0, length_beats: 16 },
      kick: { track_id: 1, clip_slot: 0, length_beats: 16 },
    });
    const beats = (track: number) => commands.filter((c) => c.args.track_id === track).map((c) => c.args.beat);
    expect(beats(4)).toEqual([0, 16, 32, 48]);
    expect(beats(1)).toEqual([32, 48]);
  });
});
