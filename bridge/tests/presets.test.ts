import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { AF101_PARAMS, DST, FILTER_MODE, LFO_DIVISION_BEATS, LFO_WAVE, SRC, WAVE, lfoMode, MOD_SLOT_MAX, modRouteExists, nearestDivision, packModSlot, placeMatrix, toPresetText, unpackModSlot } from '../../agent/src/presets/af101.js';
import { convertDiva, parseDiva } from '../../agent/src/presets/diva.js';
import { convertSerum, decodeSerum, lfoWaveOf, serumSyncBeats, waveFromFrames } from '../../agent/src/presets/serum.js';

describe('AF101 parameter catalogue', () => {
  it('matches parameterTable() in Preset.h, id for id and range for range', () => {
    const header = readFileSync('analogfoundry/src/model/Preset.h', 'utf8');
    const rows = [...header.matchAll(/\{"([a-z0-9_]+)", "[^"]+", "[^"]*", (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/g)].map((m) => ({
      id: m[1], min: +m[2]!, max: +m[3]!, def: +m[4]!,
    }));
    expect(rows.length).toBe(64); // Live lists a plugin's parameters only up to 64
    expect(AF101_PARAMS).toEqual(rows);
  });

  it('writes the preset format and clamps out-of-range values', () => {
    const text = toPresetText({ cutoff: 99999, saw: 0.5, unison: 12 }, ['a comment']);
    expect(text).toBe('# a comment\nanalogfoundry101 1\nsaw 0.5\ncutoff 20000\nunison 7\n');
  });

  it('fills the matrix strongest first and reports what did not fit', () => {
    const patch: Record<string, number> = {};
    const slots = Array.from({ length: 10 }, (_, i) => ({ src: SRC.lfo1, dst: DST.fine, amt: (i + 1) / 20, why: `s${i}` }));
    const { placed, overflow } = placeMatrix(patch, slots);
    expect(placed).toHaveLength(8);
    expect(placed[0]?.why).toBe('s9');
    expect(overflow.map((s) => s.why)).toEqual(['s1', 's0']);
    expect(unpackModSlot(patch.mod1 ?? 0)).toEqual({ src: SRC.lfo1, dst: DST.fine, amt: 0.5 });
  });

  it('packs a matrix slot into one value and back', () => {
    for (const [s, d, a] of [[0, 0, 0], [9, 16, -1], [5, 1, 0.7138], [3, 16, -0.0083]] as const) {
      const back = unpackModSlot(packModSlot(s, d, a));
      expect(back.src).toBe(s);
      expect(back.dst).toBe(d);
      expect(back.amt).toBeCloseTo(a, 4);
    }
    expect(packModSlot(0, 0, 0)).toBe(10000);
  });
});

const DIVA = `/*@Meta
*/
#ms=none
#ms=ModWhl
#ms=PitchW
#ms=CtrlA
#ms=CtrlB
#ms=Gate
#ms=Velocity
#ms=Pressure
#ms=KeyFollow
#ms=KeyFollow2
#ms=Alternate
#ms=Random
#ms=StackVoice
#ms=VoiceMap
#ms=Env1
#ms=Env2
#ms=LFO1
#ms=LFO2
#cm=VCC
Mode=1
Porta=0.00
#cm=ENV1
Atk=0.00
Dec=50.00
Sus=80.00
Rel=25.00
Vel=40.00
#cm=ENV2
Atk=0.00
Dec=25.00
Sus=0.00
Rel=10.00
#cm=LFO1
Wave=1
#cm=LFO2
Wave=1
#cm=OSC
Model=1
Tune1=0.00
Tune2=12.00
OscMix=100.00
Saw2=1
PWM2=1
PW=50.00
Noise=0.00
TM1Src=16
TM1Dpt=0.50
#cm=VCF1
Freq=69.00
Res=20.00
KeyScl=50.00
FMSrc=15
FMDpt=12.00
FM2Src=6
FM2Dpt=24.00
#cm=VCA1
PanDpt=0.00
#cm=FX1
Module='Chorus1'
#cm=Chrs1
Rate=50.00
Depth=50.00
Wet=40.00
#cm=FX2
Module='Plate2'
#cm=Plate2
Pre=10.00
Decay=50.00
Dry=75.00
Wet=25.00
$$$$1920
binary blob that is not read`;

describe('Diva -> AF101', () => {
  const c = convertDiva(parseDiva(DIVA), 'LD - Test');

  it('reads the Dual VCO crossfade: OscMix 100 is oscillator 2 alone, saw + pulse, an octave up', () => {
    expect(c.patch.saw).toBe(1);
    expect(c.patch.pulse).toBeCloseTo(0.7);
    expect(c.patch.tune).toBe(12);
    expect(c.patch.osc2_level).toBeUndefined();
  });

  it('maps ENV1 to the amp and ENV2 to the filter on the fitted time curve (D1)', () => {
    expect(c.patch.decay).toBeCloseTo(12 * 0.5 ** 4, 6); // 0.75 s
    expect(c.patch.sustain).toBeCloseTo(0.8);
    expect(c.patch.fenv_separate).toBe(1);
    expect(c.patch.fenv_decay).toBeCloseTo(12 * 0.25 ** 4, 6);
    expect(c.patch.vel_amp).toBeCloseTo(0.4);
  });

  it('reads the cutoff as a note number an octave below MIDI and the envelope depth in semitones (D2)', () => {
    expect(c.patch.cutoff).toBeCloseTo(220, 6); // Freq 69, measured against the pack loops
    expect(c.patch.resonance).toBeCloseTo(0.2);
    expect(c.patch.track).toBeCloseTo(0.5);
    expect(c.patch.env_cutoff).toBeCloseTo(1 / 6, 6); // 12 st = 1 octave of AF101's 6
  });

  it('routes velocity to cutoff and LFO 1 to pitch through the matrix', () => {
    // amounts are packed to 1/10000 (packModSlot)
    expect(c.matrix.find((s) => s.src === SRC.velocity && s.dst === DST.cutoff)?.amt).toBeCloseTo(24 / 12 / 5, 4);
    expect(c.matrix.find((s) => s.src === SRC.lfo1 && s.dst === DST.pitch)?.amt).toBeCloseTo(0.5 / 24, 4);
    expect(c.polyphonic).toBe(false);
  });

  it('turns the FX slots into Live devices with their wet levels', () => {
    expect(c.chain.map((d) => d.device)).toEqual(['Chorus-Ensemble', 'Reverb']);
    expect(c.chain[1]?.settings['Dry/Wet']).toBe(25);
    expect(c.report.assumptions).toContain('D1');
  });
});

function serumBody(overrides: Record<string, unknown> = {}) {
  return {
    Oscillator0: { plainParams: 'default', WTOsc0: { relativePathToWT: 'S2 Tables/Analog/AT Juno 106.wav', plainParams: 'default' } },
    Oscillator1: { plainParams: { kParamEnable: 1, kParamOctave: 1, kParamVolume: 0.375 }, WTOsc1: { relativePathToWT: '/Analog/Basic Mini.wav', plainParams: 'default' } },
    VoiceFilter0: { plainParams: { kParamEnable: 1, kParamFreq: 0.5, kParamReso: 10, kParamDrive: 20, kParamType: 'MgL24' } },
    Env0: { plainParams: { kParamAttack: 0.005, kParamSustain: 0.8, kParamRelease: 0.3 } },
    Env1: { plainParams: { kParamAttack: 0.001, kParamDecay: 0.2, kParamSustain: 0 } },
    Macro0: { name: 'CUTOFF', plainParams: { kParamValue: 50 } },
    Global0: { plainParams: { kParamMonoToggle: 1, kParamPortamentoTime: 0.02 } },
    ModSlot0: { source: [25, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq', plainParams: { kParamAmount: 40 } },
    ModSlot1: { source: [16, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq', plainParams: { kParamAmount: 31 } },
    ModSlot2: { source: [3, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq', plainParams: { kParamAmount: 21 } },
    ModSlot3: { source: [99, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq', plainParams: { kParamAmount: 10 } },
    FXRack0: { FX: [{ FXChorus: { plainParams: { kParamWet: 40 } } }] },
    FXRack1: { FX: [{ FXDelay: { plainParams: { kParamWet: 100 } } }] },
    ...overrides,
  };
}

describe('Serum -> AF101', () => {
  const OCT = Math.log2(22050 / 8);

  it('maps oscillator A to osc 1 and B to osc 2, relative pitch and level', () => {
    const c = convertSerum(serumBody(), 'LD - Test');
    expect(c.patch.saw).toBe(1);
    expect(c.patch.osc2_level).toBeCloseTo(0.5); // 0.375 against A's default 0.75
    expect(c.patch.osc2_oct).toBe(1);
    expect(c.patch.osc2_wave).toBe(WAVE.saw); // Basic Mini at position 1 measured as a saw (S5)
  });

  it('bakes the CUTOFF macro into the cutoff and keeps the envelope and velocity routes (S1, S6)', () => {
    const c = convertSerum(serumBody(), 'LD - Test');
    expect(c.patch.cutoff).toBeCloseTo(8 * Math.pow(22050 / 8, 0.5) * Math.pow(2, 0.4 * 0.5 * OCT), 3);
    expect(c.patch.env_cutoff).toBeCloseTo((0.21 * OCT) / 6, 6);
    expect(c.matrix).toContainEqual(expect.objectContaining({ src: SRC.velocity, dst: DST.cutoff }));
    expect(c.matrix.find((s) => s.src === SRC.velocity)?.amt).toBeCloseTo((0.31 * OCT) / 5, 4);
  });

  it('drops an unconfirmed source rather than guessing a route', () => {
    const c = convertSerum(serumBody(), 'LD - Test');
    expect(c.report.dropped.some((d) => /source 99/.test(d))).toBe(true);
    expect(c.matrix).toHaveLength(1);
  });

  it('converts the insert FX and drops a bus nothing AF101 plays is sent to (S9)', () => {
    const c = convertSerum(serumBody(), 'LD - Test');
    expect(c.chain.map((d) => d.device)).toEqual(['Chorus-Ensemble']);
    expect(c.report.dropped.some((d) => /FX bus 1/.test(d))).toBe(true);
  });

  it("plays a high-pass or band-pass on AF101's own filter modes, not EQ Eight", () => {
    const hz = 8 * Math.pow(22050 / 8, 0.3) * Math.pow(2, 0.4 * 0.5 * OCT);
    const hp = convertSerum(serumBody({ VoiceFilter0: { plainParams: { kParamEnable: 1, kParamFreq: 0.3, kParamType: 'H18' } } }), 'SY - Test');
    expect(hp.patch.filter_mode).toBe(FILTER_MODE.highpass);
    expect(hp.patch.cutoff).toBeCloseTo(hz, -1);
    expect(hp.chain.some((d) => d.device === 'EQ Eight')).toBe(false);
    const bp = convertSerum(serumBody({ VoiceFilter0: { plainParams: { kParamEnable: 1, kParamFreq: 0.3, kParamType: 'B12' } } }), 'SY - Test');
    expect(bp.patch.filter_mode).toBe(FILTER_MODE.bandpass);
  });

  it('reads Serum 2 source 1 as the mod wheel and envelopes 1-4 as sources 2-5 (S11)', () => {
    const route = (src: number, aux = 0) => ({
      source: [src, aux], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq', plainParams: { kParamAmount: 20 },
    });
    const c = convertSerum(serumBody({ ModSlot0: route(1), ModSlot1: route(2), ModSlot2: route(3), ModSlot3: route(16, 1) }), 'LD - Test');
    expect(c.matrix).toContainEqual(expect.objectContaining({ src: SRC.modWheel, dst: DST.cutoff }));
    // Envelope 1 (source 2) is the amp envelope; its route reads a linear copy on env 3 (S17).
    expect(c.matrix).toContainEqual(expect.objectContaining({ src: SRC.env3, dst: DST.cutoff }));
    expect(c.patch.env3_sustain).toBeCloseTo(0.8);
    // Envelope 2 (source 3) is the body's Env1, the short one, and becomes the filter envelope.
    expect(c.patch.fenv_decay).toBeCloseTo(0.2);
    expect(c.patch.fenv_sustain).toBe(0);
    expect(c.patch.env_cutoff).toBeGreaterThan(0);
    // A route scaled by the mod wheel is silent while the wheel rests at 0.
    expect(c.matrix.some((s) => s.src === SRC.velocity)).toBe(false);
    expect(c.report.dropped.some((d) => /mod wheel, which rests at 0/.test(d))).toBe(true);
  });

  it('reads a synced LFO rate as the division Serum snaps it to (S7)', () => {
    // Serum 2 presets saved at known rates (serum2vital DebugPresets/13).
    expect(serumSyncBeats(0.2108496543592536)).toBe(16); // 4 bars
    expect(serumSyncBeats(1.6269264358721542)).toBe(4); // 1 bar
    expect(serumSyncBeats(3.3735944697480575)).toBe(2); // 1/2
    expect(serumSyncBeats(6.25)).toBe(1); // the default, 1/4
    expect(serumSyncBeats(26.030822973954468)).toBe(0.125); // 1/32
    const lfoRoute = {
      source: [6, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq',
      plainParams: { kParamAmount: 20, kParamBipolar: 1 },
    };
    const synced = convertSerum(serumBody({ ModSlot3: lfoRoute, LFO0: { plainParams: { kParamMode: 'Free', kParamRate: 26.030822973954468 } } }), 'LD - Test');
    expect(synced.patch.lfo1_wave).toBe(lfoMode(LFO_WAVE.sine, false, nearestDivision(0.125)));
    // No stored mode is Trig, which retriggers; no stored rate is 1/4.
    const trig = convertSerum(serumBody({ ModSlot3: lfoRoute, LFO0: { plainParams: {} } }), 'LD - Test');
    expect(trig.patch.lfo1_wave).toBe(lfoMode(LFO_WAVE.sine, true, nearestDivision(1)));
    // 1/64 is faster than AF101 syncs: clamped to 1/32 and reported.
    const fast = convertSerum(serumBody({ ModSlot3: lfoRoute, LFO0: { plainParams: { kParamMode: 'Free', kParamRate: 38.11172097735195 } } }), 'LD - Test');
    expect(fast.patch.lfo1_wave).toBe(lfoMode(LFO_WAVE.sine, false, nearestDivision(0.125)));
    expect(fast.report.approximated.some((a) => /synced at 1\/64/.test(a))).toBe(true);
  });

  it("plays MG Low 12 and 18 on the ladder's 2- and 3-pole taps; no stored type is MG Low 12 (S15)", () => {
    const withType = (t?: string) =>
      convertSerum(serumBody({ VoiceFilter0: { plainParams: { kParamEnable: 1, kParamFreq: 0.5, ...(t ? { kParamType: t } : {}) } } }), 'SY - Test');
    expect(withType('MgL24').patch.filter_poles).toBeUndefined();
    expect(withType('LadderMg').patch.filter_poles).toBeUndefined();
    expect(withType('MgL18').patch.filter_poles).toBe(3);
    expect(withType('MgL12').patch.filter_poles).toBe(2);
    expect(withType().patch.filter_poles).toBe(2);
    expect(withType('H18').patch.filter_poles).toBeUndefined();
  });

  it("squares the amp envelope's sustain and stretches its decay and release (S17)", () => {
    // BS - Coast: a stored 0.671 reads -6.9 dB in Serum 2's ENV 1.
    const c = convertSerum(serumBody({ Env0: { plainParams: { kParamSustain: 0.6711554527282715, kParamRelease: 0.3 } } }), 'BS - Test');
    expect(20 * Math.log10(c.patch.sustain!)).toBeCloseTo(-6.9, 1);
    expect(c.patch.release).toBeCloseTo(0.54, 6);
    expect(c.patch.decay).toBeCloseTo(1.8, 6); // Serum's default 1 s
    expect(c.report.assumptions).toContain('S17');
  });

  it("gives Env 1's routes a linear copy of it, not the squared amp (S17)", () => {
    const envRoute = { source: [2, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq', plainParams: { kParamAmount: 33 } };
    // Env 2 already holds the filter envelope, so the copy goes to env 3.
    const c = convertSerum(serumBody({ ModSlot4: envRoute }), 'SY - Test');
    expect(c.patch.sustain).toBeCloseTo(0.64, 6);
    expect(c.patch.env3_sustain).toBeCloseTo(0.8, 6);
    expect(c.patch.env3_release).toBeCloseTo(0.3, 6);
    expect(c.matrix.some((s) => s.src === SRC.env3 && s.dst === DST.cutoff)).toBe(true);
    expect(c.matrix.some((s) => s.src === SRC.ampEnv)).toBe(false);
  });

  it("fits a table's tilt: a saw whose harmonics fall 2 dB per octave faster is a tilted saw (S20)", () => {
    const juno = Float32Array.from({ length: 2048 }, (_, i) => {
      let v = 0;
      for (let h = 1; h <= 200; h++) v += Math.sin((2 * Math.PI * h * i) / 2048) / h / Math.pow(2, (2 / 6.0206) * Math.log2(h));
      return v;
    });
    const on = waveFromFrames([juno], 1, true);
    expect(on.wave).toBe(WAVE.saw);
    expect(on.tilt).toBeCloseTo(-2, 0);
    expect(on.error).toBeLessThan(0.5);
    // Not applied by default: the plain saw, with the tilt named in the report.
    const off = waveFromFrames([juno], 1);
    expect(off.wave).toBe(WAVE.saw);
    expect(off.tilt).toBe(0);
    expect(off.how).toMatch(/tilted -2\.00 dB\/oct would be .* \(S20, not applied\)/);
    // A plain saw needs no tilt.
    const saw = Float32Array.from({ length: 2048 }, (_, i) => 1 - (2 * i) / 2048);
    expect(waveFromFrames([saw], 1, true).tilt).toBe(0);
  });

  it("lands an oscillator's pan on AF101's pan for its slot, fixed or from an LFO (S19)", () => {
    const panRoute = (osc: number, amount: number) => ({
      source: [6, 0], destModuleTypeString: 'Oscillator', destModuleID: osc, destModuleParamName: 'kParamPan',
      plainParams: { kParamAmount: amount, kParamBipolar: 1 },
    });
    // PL - Scale: Osc A at -27, Osc B at +29 (B plays in AF101's osc 2).
    const fixed = convertSerum(serumBody({
      Oscillator0: { plainParams: { kParamPan: -27.196410298347473 }, WTOsc0: { relativePathToWT: 'S2 Tables/Analog/AT Juno 106.wav', plainParams: 'default' } },
      Oscillator1: { plainParams: { kParamEnable: 1, kParamOctave: 1, kParamVolume: 0.375, kParamPan: 28.728067874908447 }, WTOsc1: { relativePathToWT: '/Analog/Basic Mini.wav', plainParams: 'default' } },
    }), 'PL - Test');
    expect(fixed.matrix.find((s) => s.src === SRC.constant && s.dst === DST.osc1Pan)!.amt).toBeCloseTo(-0.272, 3);
    expect(fixed.matrix.find((s) => s.src === SRC.constant && s.dst === DST.osc2Pan)!.amt).toBeCloseTo(0.287, 3);
    expect(fixed.report.assumptions).toContain('S19');
    // A bipolar LFO route's 100 % swings from the centre to each side.
    const moving = convertSerum(serumBody({ ModSlot3: panRoute(0, 100), LFO0: { plainParams: { kParamMode: 'Free' } } }), 'SY - Test');
    expect(moving.matrix.find((s) => s.src === SRC.lfo1 && s.dst === DST.osc1Pan)!.amt).toBeCloseTo(1, 4);
    // Velocity has no route to an oscillator's pan: dropped and said so.
    const velocity = convertSerum(serumBody({ ModSlot3: { ...panRoute(0, 50), source: [16, 0] } }), 'SY - Test');
    expect(velocity.matrix.some((s) => s.dst === DST.osc1Pan)).toBe(false);
    expect(velocity.report.dropped.some((d) => /no route for that pair/.test(d))).toBe(true);
  });

  it('packs the 0.7 pans in the routes 0.4 ignored, leaving every 0.4 value as it was', () => {
    expect(packModSlot(SRC.lfo1, DST.cutoff, 0.35)).toBe((3 * 17 + 1) * 20001 + 13500);
    for (const [src, dst] of [[SRC.lfo1, DST.osc1Pan], [SRC.lfo2, DST.noisePan], [SRC.constant, DST.osc3Pan], [SRC.constant, DST.pan], [SRC.velocity, DST.pan], [SRC.env3, DST.pan]] as const) {
      expect(modRouteExists(src, dst)).toBe(true);
      expect(unpackModSlot(packModSlot(src, dst, -0.4))).toEqual({ src, dst, amt: -0.4 });
      expect(packModSlot(src, dst, 1)).toBeLessThanOrEqual(MOD_SLOT_MAX);
    }
    expect(modRouteExists(SRC.velocity, DST.osc1Pan)).toBe(false);
    expect(modRouteExists(SRC.constant, DST.cutoff)).toBe(false);
    expect(packModSlot(SRC.velocity, DST.osc1Pan, 0.5)).toBe(10000);
    expect(unpackModSlot(10000)).toEqual({ src: SRC.none, dst: DST.none, amt: 0 });
  });

  it("weights a fine-tune route by its oscillator's share of the level (S18)", () => {
    const fine = (osc: number) => ({
      source: [6, 0], destModuleTypeString: 'Oscillator', destModuleID: osc, destModuleParamName: 'kParamFine',
      plainParams: { kParamAmount: 30, kParamBipolar: 1 },
    });
    // Osc A at the default 0.75 and Osc B at 0.375: B is a third of the level.
    const c = convertSerum(serumBody({ ModSlot3: fine(1), LFO0: { plainParams: { kParamMode: 'Free' } } }), 'LD - Test');
    expect(c.matrix.find((s) => s.src === SRC.lfo1 && s.dst === DST.fine)!.amt).toBeCloseTo(0.1, 4);
    expect(c.report.assumptions).toContain('S18');
  });

  it('plays noise a macro raises at 0.3 of the macro share (S16)', () => {
    const c = convertSerum(serumBody({
      Oscillator3: { plainParams: { kParamEnable: 1, kParamVolume: 0 }, NoiseOsc3: { plainParams: 'default' } },
      Macro1: { name: 'WHITE NOISE', plainParams: { kParamValue: 50 } },
      ModSlot3: { source: [26, 0], destModuleTypeString: 'Oscillator', destModuleID: 3, destModuleParamName: 'kParamVolume', plainParams: { kParamAmount: 60 } },
    }), 'LD - Test');
    // macro share 0.6 x 0.5 = 0.3; Serum plays 0.3 of it, against oscillator A's 0.75
    expect(c.patch.noise).toBeCloseTo((0.3 * 0.3) / 0.75, 4);
    expect(c.report.assumptions).toContain('S16');
  });

  it('reads the frame a wavetable plays and picks the nearest AF101 wave (S5)', () => {
    const cycle = (f: (t: number) => number) => Float32Array.from({ length: 2048 }, (_, i) => f(i / 2048));
    const saw = cycle((t) => 1 - 2 * t), square = cycle((t) => (t < 0.5 ? 1 : -1)), sine = cycle((t) => Math.sin(2 * Math.PI * t));
    const pulse30 = cycle((t) => (t < 0.3 ? 1 : -1));
    // a 4-frame table: saw, square, sine, 30 % pulse; position 1-256 steps through the frames
    const table = [saw, square, sine, pulse30];
    expect(waveFromFrames(table, 1).wave).toBe(WAVE.saw);
    expect(waveFromFrames(table, 70).wave).toBe(WAVE.pulse);
    expect(waveFromFrames(table, 70).pw).toBe(0.5);
    expect(waveFromFrames(table, 140).wave).toBe(WAVE.sine);
    const p = waveFromFrames(table, 256);
    expect([p.wave, p.pw]).toEqual([WAVE.pulse, 0.3]);
    expect(waveFromFrames(table, 1).error).toBeLessThan(0.5);
    // an embedded table is read from the preset itself, with no reader
    const c = convertSerum(serumBody({
      Oscillator0: { plainParams: 'default', WTOsc0: { relativePathToWT: '/User/Mine.wav', embeddedWTData: Array.from(square), plainParams: 'default' } },
    }), 'LD - Test');
    expect(c.patch.pulse).toBe(1);
    expect(c.patch.saw).toBe(0);
  });

  it("reads an LFO's drawn shape into AF101's nearest wave (S14)", () => {
    const shape = (xVals: number[], yVals: number[], curveVals: number[]) => ({ curveData: { numPoints: xVals.length - 1, xVals, yVals, curveVals } });
    expect(lfoWaveOf(shape([0, 0.5, 1], [1, 0, 1], [0.5, 0.5, 0.5])).wave).toBe(LFO_WAVE.triangle);
    expect(lfoWaveOf(shape([0, 0, 1], [1, 0, 1], [0.5, 0.5, 0.5])).wave).toBe(LFO_WAVE.saw);
    expect(lfoWaveOf(shape([0, 0.25, 0.5, 0.75, 1, 1], [0.5, 0, 0.5, 1, 0.5, 0], [0.3, 0.7, 0.3, 0.7, 0.5, 0.5])).wave).toBe(LFO_WAVE.sine);
    expect(lfoWaveOf({ plainParams: 'default' }).how).toMatch(/default shape/);
  });

  it('plays a unipolar LFO route as half the amount around a raised base (S13)', () => {
    const route = (bipolar: boolean) => ({
      source: [6, 0], destModuleTypeString: 'VoiceFilter', destModuleID: 0, destModuleParamName: 'kParamFreq',
      plainParams: { kParamAmount: 20, ...(bipolar ? { kParamBipolar: 1 } : {}) },
    });
    const lfo = { plainParams: { kParamMode: 'Free' } };
    const uni = convertSerum(serumBody({ ModSlot3: route(false), LFO0: lfo }), 'LD - Test');
    const bi = convertSerum(serumBody({ ModSlot3: route(true), LFO0: lfo }), 'LD - Test');
    const depth = (c: typeof uni) => c.matrix.find((s) => s.src === SRC.lfo1)!.amt;
    expect(depth(bi)).toBeCloseTo((0.2 * OCT) / 5, 4);
    expect(depth(uni)).toBeCloseTo((0.1 * OCT) / 5, 4);
    expect(uni.patch.cutoff! / bi.patch.cutoff!).toBeCloseTo(Math.pow(2, 0.1 * OCT), 3);
  });

  it('plays an octave unison stack as an oscillator an octave up (S12)', () => {
    const c = convertSerum(serumBody({
      Oscillator0: { plainParams: { kParamUnison: 6, kParamUnisonStack: 'kOctave2' }, WTOsc0: { relativePathToWT: '/Analog/Jno.wav', plainParams: 'default' } },
    }), 'SY - Test');
    expect(c.patch.unison).toBe(6);
    expect(c.patch.osc3_oct).toBe(1);
    expect(c.patch.osc3_wave).toBe(WAVE.saw);
    expect(c.patch.osc3_level).toBe(1);
    expect(c.report.approximated.some((a) => /kOctave2 -> osc 3 an octave up/.test(a))).toBe(true);
  });

  it('plays a polyphonic preset on 8 voices, and a mono one on 1', () => {
    const c = convertSerum(serumBody({ Global0: { plainParams: {} } }), 'SY - Pad');
    expect(c.polyphonic).toBe(true);
    expect(c.patch.voices).toBe(8);
    const m = convertSerum(serumBody({ Global0: { plainParams: { kParamMonoToggle: 1 } } }), 'LD - Mono');
    expect(m.patch.voices).toBeUndefined();
  });
});

describe('AF101 LFO modes', () => {
  it('pack wave, retrigger and division as Voice101.h does', () => {
    expect(lfoMode(LFO_WAVE.square, false, 0)).toBe(3);
    expect(lfoMode(LFO_WAVE.sine, true, 9)).toBe(95);
    expect(lfoMode(LFO_WAVE.sampleHold, true, 13)).toBe(139);
    expect(LFO_DIVISION_BEATS[nearestDivision(0.75)]).toBe(0.75);
    expect(LFO_DIVISION_BEATS[nearestDivision(1.1)]).toBe(1);
    expect(nearestDivision(0)).toBe(0);
  });
});

const PACK = 'D:/samples/TPS x CamelPhat - Producer Pack/TPS x CamelPhat - Producer Pack/TPS x CamelPhat - Serum 2 Presets';
describe.skipIf(!existsSync(PACK))('Serum 2 file decoding (needs the pack on this machine)', () => {
  it('decodes every preset in the pack and converts it', () => {
    const files = readdirSync(PACK).filter((f) => f.endsWith('.SerumPreset'));
    expect(files.length).toBe(60);
    for (const f of files) {
      const body = decodeSerum(readFileSync(`${PACK}/${f}`));
      expect(body.Oscillator0).toBeDefined();
      expect(() => convertSerum(body, f)).not.toThrow();
    }
  });

  it('puts every pitch-envelope route on a short, zero-sustain envelope (S11)', () => {
    // Under the old numbering (envelopes 1-4) all 14 read an untouched default envelope.
    let routes = 0;
    for (const f of readdirSync(PACK).filter((x) => x.endsWith('.SerumPreset'))) {
      const body = decodeSerum(readFileSync(`${PACK}/${f}`));
      for (const m of Object.keys(body).filter((k) => /^ModSlot\d+$/.test(k)).map((k) => body[k])) {
        if (m?.destModuleParamName !== 'kParamCoarsePit' || m.source[0] < 2 || m.source[0] > 5) continue;
        const env = body[`Env${m.source[0] - 2}`].plainParams;
        expect(env.kParamDecay).toBeLessThan(0.05);
        expect(env.kParamSustain).toBe(0);
        routes++;
      }
    }
    expect(routes).toBe(14);
  });

  it('writes patches AF101 loads as written: known ids, in range, matrix slots that survive Live', () => {
    const byId = new Map(AF101_PARAMS.map((p) => [p.id, p]));
    const max = byId.get('mod1')!.max;
    for (const f of readdirSync(PACK).filter((x) => x.endsWith('.SerumPreset'))) {
      const c = convertSerum(decodeSerum(readFileSync(`${PACK}/${f}`)), f);
      for (const [id, v] of Object.entries(c.patch)) {
        const p = byId.get(id);
        expect(p, `${f}: ${id}`).toBeDefined();
        expect(v, `${f}: ${id}`).toBeGreaterThanOrEqual(p!.min);
        expect(v, `${f}: ${id}`).toBeLessThanOrEqual(p!.max);
      }
      for (const s of c.matrix) {
        // Live hands a plugin its values as 32-bit normalised floats.
        const v = packModSlot(s.src, s.dst, s.amt);
        expect(Math.round(Math.fround(v / max) * max), `${f}: ${s.why}`).toBe(v);
      }
    }
  });
});
