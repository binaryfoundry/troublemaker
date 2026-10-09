/**
 * Serum 2 (.SerumPreset) -> AnalogFoundry 101.
 *
 * File format (docs/lessons.md): "XferJson\0", a u64 header length and a JSON
 * header, then a u32 size, a u32 format and a zstd frame holding CBOR with every
 * parameter, the mod matrix, the FX racks and a demo clip.
 *
 * Mod-matrix source codes (S11): mod wheel 1, envelopes 1-4 are 2-5, LFOs 1-10 are
 * 6-15, velocity 16, macros 1-8 are 25-32. Unconfirmed codes are dropped and
 * reported, never guessed into a route.
 */
import { decompress } from 'fzstd';
import { decode } from 'cbor-x';

import { DST, ENV_CUTOFF_OCTAVES, FILTER_MODE, LFO_DIVISION_BEATS, LFO_WAVE, MOD_SCALE, SRC, WAVE, clampParam, lfoMode, nearestDivision, placeMatrix, type Af101Patch, type MatrixSlot } from './af101.js';
import { categoryOf, emptyReport, type ChainDevice, type Conversion } from './types.js';

export const SERUM_ASSUMPTIONS: Record<string, string> = {
  S1: 'Filter cutoff is normalised 0-1 on a log scale from 8 Hz to 22.05 kHz (Serum\'s range). A lead\'s cutoff plus its CUTOFF macro lands near 1 kHz on this curve, which is plausible but not verified against Serum.',
  S2: 'Values Serum stores as "default" take Serum\'s factory defaults: envelope A 0.5 ms, D 1 s, S 1.0, R 15 ms; oscillator A on at volume 0.75; B, C, noise and sub off unless enabled.',
  S3: 'Unison detune 0-1 is taken as 0-100 cents spread (AF101 caps at 50). Unison stereo 0-100 % becomes AF101\'s stereo spread 0-1 (both pan the stack across the field).',
  S4: 'A mod amount is a percentage of the destination\'s range: on cutoff, of the 11.4-octave normalised range; on fine tune, of +/-100 cents; on volume, of 0-1.',
  S5: 'Wavetables are chosen by name: analog saw tables (Juno, Model D, Mini, Moog, "Analog/") become AF101\'s saw; "Default Shapes" is read by table position (sine, triangle, saw, square). Basic Mini at position 1 measured as a saw (SY - Patterns against its loop, Synth Loop 09: 3.1 dB band error as a saw, 4.6 as a triangle). The table itself is not loaded - Serum\'s factory tables are not on this machine.',
  S6: 'Macros are baked at their saved value. A macro that is itself modulated (e.g. the mod wheel -> CUTOFF macro) passes that modulation through to the macro\'s destinations.',
  S7: 'An LFO rate is stored as 100 * knob^4: Hz when free, and when synced a knob position that Serum snaps to a division (229 steps; 1 bar 1.627, 1/2 3.374, 1/32 26.03, 4 bars 0.211, read from Serum 2 presets saved at those rates, serum2vital DebugPresets/13). An unstored rate is the knob\'s middle, 6.25: 1/4 synced, 6.25 Hz free. AF101 syncs from 1/32 to 4 bars; a division outside that is clamped and reported. An LFO with no stored mode retriggers: Serum stores "Free" and "Envelope" when chosen, so the default is Trig.',
  S11: 'Mod sources: 1 is the mod wheel (a Serum 2 preset saved with one route per source, serum2vital DebugPresets/12), so envelopes 1-4 are 2-5. Confirmed in this pack: every pitch-envelope route (3 or 4 -> pitch) lands on a 7-28 ms zero-sustain envelope under this numbering, and on an untouched default one under the old "1-4". The mod wheel maps to AF101\'s mod wheel, which rests at 0, as Serum\'s does.',
  S12: 'An octave unison stack (kOctave1-3, kOctaveFifth1-3) puts part of the stack an octave up. Measured on SY - Patterns (kOctave2) against Synth Loop 09, Serum\'s render of its demo clip: no stack 3.1 dB band error, an octave-up copy of the oscillator at the same level 1.8, at half level 2.6, an octave down 6.0. The other stack sizes are assumed to behave alike; centre stacks (kCenter12/24) are dropped.',
  S13: "A route is unipolar unless it stores kParamBipolar (82 of the pack's 696 do): a unipolar LFO moves its destination from the base up by the amount. AF101's LFOs swing +/-1, so such a route becomes half the amount in the matrix and, on cutoff or resonance, a base raised by the other half; elsewhere it plays centred on the base. A bipolar route keeps the full amount: whether Serum's bipolar span is +/-amount or +/-amount/2 is not confirmed.",
  S14: "An LFO's drawn shape is read from its points: a triangle (51 of the pack's 75 routed LFOs) plays as AF101's triangle, a ramp as its saw, a curved diamond as its sine; anything else, and Serum's unstored default shape, as a sine. Which way Serum's y axis points is not known, so a ramp's direction and a retriggered LFO's starting phase may be inverted. The shape could not be checked against the loops: the notes' own envelopes swamp an LFO's movement in the brightness.",
  S15: "A filter that stores no type is MG Low 12, Serum 2's default, and MG Low 12/18 play on AF101's ladder taken after 2/3 of its 4 poles (filter_poles). Measured against the pack loops: SY - Desire (no type) 13.8 dB band error at 24 dB and 1.6 at 12; Magician 10.3 -> 6.9, Page (MgL12) 5.1 -> 3.6, Lines (MgL18) 4.6 -> 1.5; Dimension and Patterns (MgL18) moved under 0.4 dB the other way.",
  S10: 'Serum stores no voice count for a polyphonic preset; it plays on AF101\'s full 8 voices.',
  S9: 'Routing slots 0-4 are oscillators A, B, C, noise and sub. An FX bus (racks 2 and 3) is a parallel send: it is converted only when an oscillator AF101 plays feeds it, at an inline wet of x/(1+x), x = send level x bus volume.',
  S8: "Effects become the nearest Live 12 Standard devices with their wet levels; times and sizes are approximate, and a macro on an effect's wet is applied to every effect of that kind (Serum's FX module numbering is not confirmed).",
};

export function decodeSerum(bytes: Uint8Array): any {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 8).toString('latin1') !== 'XferJson') throw new Error('not a Serum 2 preset (no XferJson header)');
  const headerLength = Number(b.readBigUInt64LE(9));
  const p = 17 + headerLength;
  const z = b.subarray(p + 8);
  return decode(Buffer.from(decompress(new Uint8Array(z.buffer, z.byteOffset, z.byteLength))));
}

const params = (o: any): Record<string, any> => (o && o.plainParams && o.plainParams !== 'default' ? o.plainParams : {});
const num = (v: any, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const OCT_RANGE = Math.log2(22050 / 8); // 11.43 octaves
/** Serum 2 mod sources (S11). */
const MOD_WHEEL = 1;
const ENV_SRC_FIRST = 2; // envelope n (1-4) is source n + 1
const ENV_SRC_LAST = 5;
const VELOCITY = 16;
/** The body module an envelope source reads (Env0 is envelope 1, the amp envelope). */
const envModule = (src: number) => `Env${src - ENV_SRC_FIRST}`;
const hzOf = (norm: number) => 8 * Math.pow(22050 / 8, Math.min(1, Math.max(0, norm)));
/** Serum's LFO rate knob when synced: the last of its 229 steps for each division, in beats (S7). */
const SERUM_SYNC_RUNS: Array<[number, number]> = [
  [13, 128], [29, 64], [46, 32], [62, 16], [78, 8], [94, 4], [111, 2], [127, 1],
  [143, 1 / 2], [160, 1 / 4], [176, 1 / 8], [192, 1 / 16], [208, 1 / 32], [225, 1 / 64],
];
/** An unstored LFO rate: the knob's middle (S7). */
const SERUM_DEFAULT_RATE = 6.25;

/** The division, in beats, that a stored synced rate snaps to; 1/128 beat for Serum's "fast". */
export function serumSyncBeats(rate: number): number {
  const step = Math.round(Math.pow(Math.min(1, Math.max(0, rate / 100)), 0.25) * 228);
  return SERUM_SYNC_RUNS.find(([last]) => step <= last)?.[1] ?? 1 / 128;
}

/** Beats as a note division, e.g. "1/16" or "4 bars". */
const divisionName = (beats: number) => (beats >= 4 ? `${beats / 4} bar${beats > 4 ? 's' : ''}` : `1/${4 / beats}`);

interface Osc {
  index: number;
  wave: number;
  volume: number;
  semis: number; // octave*12 + coarse
  fine: number; // cents
  unison: number;
  /** Unison stereo 0-1. */
  stereo: number;
  detune: number;
  table: string;
  /** Serum's unison stack (kOctave1 ...), when the oscillator has unison. */
  stack?: string;
}

function waveFromTable(table: string, pos: number): { wave: number; how: string } {
  const t = table.toLowerCase();
  if (/default shapes/.test(t)) {
    const frame = Math.min(3, Math.max(0, Math.floor(pos / 64)));
    return { wave: [WAVE.sine, WAVE.triangle, WAVE.saw, WAVE.pulse][frame] ?? WAVE.saw, how: `Default Shapes at position ${pos.toFixed(0)}` };
  }
  if (/square|pulse/.test(t)) return { wave: WAVE.pulse, how: table };
  if (/sine/.test(t)) return { wave: WAVE.sine, how: table };
  if (/tri/.test(t)) return { wave: WAVE.triangle, how: table };
  if (/saw|jno|juno|mini|moog|model d|analog|prophet|basic/.test(t)) return { wave: WAVE.saw, how: table };
  return { wave: WAVE.saw, how: table ? `${table} (unknown table - saw assumed)` : 'no table (saw assumed)' };
}

/**
 * The AF101 wave nearest an LFO's drawn shape (S14). The points are read as stored;
 * which way Serum's y axis points is not known, so a ramp's direction and a shape's
 * starting phase are not either.
 */
export function lfoWaveOf(lfo: any): { wave: number; how: string } {
  const c = lfo?.curveData;
  if (!c || !Array.isArray(c.yVals) || !Array.isArray(c.xVals)) return { wave: LFO_WAVE.sine, how: "Serum's default shape (not stored), played as a sine" };
  const n = Math.max(2, Math.round(num(c.numPoints, 2)) + 1);
  const xs: number[] = c.xVals.slice(0, n);
  const ys: number[] = c.yVals.slice(0, n);
  const curves: number[] = (c.curveVals ?? []).slice(0, n);
  const straight = curves.every((v) => Math.abs(v - 0.5) < 0.02);
  if (n === 3 && Math.abs(ys[0]! - ys[2]!) < 0.02 && Math.abs(ys[0]! - ys[1]!) > 0.9) {
    if (xs[1]! < 0.02) return { wave: LFO_WAVE.saw, how: 'a ramp, played as a saw (its direction is not known)' };
    return { wave: LFO_WAVE.triangle, how: `a triangle${Math.abs(xs[1]! - 0.5) > 0.05 ? ` peaking at ${xs[1]!.toFixed(2)} of the cycle, played symmetric` : ''}${straight ? '' : ', its curves straightened'}` };
  }
  if (n === 6 && !straight && ys.slice(0, 5).every((y, i) => Math.abs(y - [0.5, 0, 0.5, 1, 0.5][i]!) < 0.05)) return { wave: LFO_WAVE.sine, how: 'a curved diamond, played as a sine' };
  return { wave: LFO_WAVE.sine, how: `a drawn ${n - 1}-segment shape, played as a sine` };
}

function envOf(e: any) {
  const p = params(e);
  return { attack: num(p.kParamAttack, 0.0005), decay: num(p.kParamDecay, 1.0), sustain: num(p.kParamSustain, 1.0), release: num(p.kParamRelease, 0.015) };
}

/**
 * The preset's demo clip as `render_note --events` lines ("beat length note velocity"),
 * shifted by whole octaves when the patch asks for a transposed clip. Undefined when
 * the preset has no notes.
 */
export function serumDemoClip(body: any, transposeOctaves = 0): { beats: number; events: string } | undefined {
  const clip = body?.MidiClip0?.clip;
  if (!Array.isArray(clip?.notes) || !clip.notes.length) return undefined;
  const events = clip.notes
    .map((n: any) => `${n.timeStamp} ${n.length} ${n.noteNum + 12 * transposeOctaves} ${num(n.attributes?.[0], 1)}`)
    .join('\n');
  return { beats: num(clip.regionEndBeats, 16), events: events + '\n' };
}

export function convertSerum(body: any, name: string): Conversion {
  const report = emptyReport();
  const patch: Af101Patch = {};
  const slots: MatrixSlot[] = [];
  const chain: ChainDevice[] = [];
  report.assumptions.push('S2');

  // --- Macros (baked; S6)
  const macro: number[] = [];
  for (let i = 0; i < 8; i++) macro[i] = num(params(body[`Macro${i}`]).kParamValue, 0) / 100;

  // --- Mod routes, read once
  type Route = { src: number; aux: number; dest: string; amount: number; bipolar: boolean };
  const routes: Route[] = Object.keys(body)
    .filter((k) => /^ModSlot\d+$/.test(k))
    .map((k) => body[k])
    .filter((m) => m && Array.isArray(m.source) && m.destModuleParamName)
    .map((m) => ({
      src: m.source[0],
      aux: m.source[1] ?? 0,
      dest: `${m.destModuleTypeString}${m.destModuleID}.${m.destModuleParamName}`,
      amount: num(params(m).kParamAmount, 0) / 100,
      bipolar: params(m).kParamBipolar === 1,
    }))
    .filter((r) => r.amount !== 0);

  // A macro modulated by another source passes it on (S6).
  const macroDrivers = (mi: number) => routes.filter((r) => r.dest === `Macro${mi}.kParamValue`);
  // The mod wheel as a route's scaler sits where the preset left it (0 unless stored).
  const wheelAtRest = num(params(body.Global0).kParamModWheel, 0) / 100;
  const auxScale = (aux: number) =>
    aux >= 25 && aux <= 32 ? macro[aux - 25] : aux === 0 ? 1 : aux === MOD_WHEEL ? wheelAtRest : NaN;
  /** The static part a destination gets from macros at their saved values (S6). */
  const staticOffset = (dest: string): number =>
    routes
      .filter((r) => r.dest === dest && r.src >= 25 && r.src <= 32)
      .reduce((t, r) => t + r.amount * (macro[r.src - 25] ?? 0) * (auxScale(r.aux) ?? 0), 0);

  // --- Oscillators
  const oscs: Osc[] = [];
  for (let i = 0; i < 3; i++) {
    const o = body[`Oscillator${i}`];
    if (!o) continue;
    const p = params(o);
    const enabled = i === 0 ? p.kParamEnable !== 0 : p.kParamEnable === 1;
    if (!enabled) continue;
    const wt = o[`WTOsc${i}`];
    const pos = num(params(wt).kParamTablePos, 0);
    const { wave, how } = waveFromTable(wt?.relativePathToWT ?? '', pos);
    const offset = staticOffset(`Oscillator${i}.kParamVolume`);
    const vol = Math.min(1, Math.max(0, num(p.kParamVolume, 0.75) + offset));
    if (offset) report.mapped.push(`Osc ${'ABC'[i]} volume ${num(p.kParamVolume, 0.75).toFixed(2)} ${offset >= 0 ? '+' : ''}${offset.toFixed(2)} from macros`);
    oscs.push({
      index: i, wave, volume: vol,
      semis: Math.round(num(p.kParamOctave, 0)) * 12 + Math.round(num(p.kParamCoarsePit, 0)),
      fine: num(p.kParamFine, 0), unison: Math.round(num(p.kParamUnison, 1)), detune: num(p.kParamDetune, 0.25), stereo: Math.min(1, Math.max(0, num(p.kParamUnisonStereo, 100) / 100)), table: how,
      ...(typeof p.kParamUnisonStack === 'string' && Math.round(num(p.kParamUnison, 1)) > 1 ? { stack: p.kParamUnisonStack } : {}),
    });
    if (p.kParamType && p.kParamType !== 'kOsc_WT') report.dropped.push(`Osc ${'ABC'[i]} is a ${p.kParamType} oscillator; treated as ${['saw', 'pulse', 'triangle', 'sine'][wave]}`);
    if (params(wt).kParamWarpMenu) report.dropped.push(`Osc ${'ABC'[i]} warp ${params(wt).kParamWarpMenu}`);
  }
  const audible = oscs.filter((o) => o.volume > 0);
  if (!audible.length) report.dropped.push('no audible wavetable oscillator');
  // Oscillator 1 of AF101 plays saw and pulse; a sine or triangle goes to osc 2/3.
  const main = audible.find((o) => o.wave === WAVE.saw || o.wave === WAVE.pulse) ?? audible[0];
  const rest = audible.filter((o) => o !== main);
  const loudest = Math.max(1e-9, ...audible.map((o) => o.volume));
  report.assumptions.push('S5');
  if (main) {
    const base = main.semis + main.fine / 100;
    const tune = Math.max(-12, Math.min(12, base));
    const transpose = Math.round((base - tune) / 12);
    patch.tune = tune;
    if (main.wave === WAVE.pulse) {
      patch.saw = 0;
      patch.pulse = main.volume / loudest;
    } else if (main.wave === WAVE.saw) {
      patch.saw = main.volume / loudest;
    } else {
      patch.saw = 0; // a sine/triangle only patch: it plays from osc 2 below
      rest.unshift(main);
    }
    report.mapped.push(`Osc ${'ABC'[main.index]} -> osc 1 (${main.table}), level ${(main.volume / loudest).toFixed(2)}, tune ${tune.toFixed(2)} st`);
    if (transpose) report.approximated.push(`base pitch ${base} st is beyond +/-12: transpose the clip ${transpose} octave(s)`);
    (patch as any).__transpose = transpose;
    const voices = Math.max(1, main.unison);
    if (voices > 1) {
      patch.unison = Math.min(7, voices);
      patch.unison_detune = Math.min(50, main.detune * 100);
      patch.stereo = main.stereo;
      report.approximated.push(`unison ${voices} voices${voices > 7 ? ' (AF101 caps at 7)' : ''}, detune ${main.detune.toFixed(3)} -> ${patch.unison_detune.toFixed(1)} ct, stereo ${main.stereo.toFixed(2)}`);
      report.assumptions.push('S3');
    }
  }
  const slotsFor = rest.slice(0, 2);
  for (const o of rest.slice(2)) report.dropped.push(`Osc ${'ABC'[o.index]} (AF101 has three oscillators and osc 1 is saw/pulse only)`);
  const baseSemis = main ? main.semis + main.fine / 100 : 0;
  slotsFor.forEach((o, k) => {
    const n = k + 2;
    const relSemis = main === o ? 0 : o.semis + o.fine / 100 - baseSemis;
    const oct = Math.max(-3, Math.min(3, Math.trunc(relSemis / 12)));
    const semi = Math.max(-12, Math.min(12, Math.trunc(relSemis - oct * 12)));
    const fine = Math.max(-100, Math.min(100, (relSemis - oct * 12 - semi) * 100));
    patch[`osc${n}_level`] = o.volume / loudest;
    patch[`osc${n}_wave`] = o.wave;
    patch[`osc${n}_oct`] = oct;
    patch[`osc${n}_semi`] = semi;
    patch[`osc${n}_fine`] = fine;
    report.mapped.push(`Osc ${'ABC'[o.index]} -> osc ${n} (${o.table}), level ${(o.volume / loudest).toFixed(2)}, ${oct} oct ${semi} st ${fine.toFixed(0)} ct`);
    if (o.unison > 1 && o.unison !== main?.unison) report.approximated.push(`Osc ${'ABC'[o.index]} unison ${o.unison}: AF101 shares one unison stack`);
  });
  // Serum's octave unison stacks put part of the stack an octave up; AF101's unison
  // is detuned only, so the octave becomes an oscillator of its own (S12).
  for (const o of audible.filter((x) => x.stack)) {
    const free = slotsFor.length + 2;
    if (o !== main || !/^kOctave/.test(o.stack!) || free > 3) {
      report.dropped.push(`Osc ${'ABC'[o.index]} unison stack ${o.stack}${o === main && /^kOctave/.test(o.stack!) ? ' (no free AF101 oscillator)' : ''}`);
      continue;
    }
    const playsFrom = slotsFor.indexOf(o); // a triangle or sine main plays from osc 2 or 3
    const n = free;
    patch[`osc${n}_level`] = o.volume / loudest;
    patch[`osc${n}_wave`] = o.wave;
    patch[`osc${n}_oct`] = playsFrom >= 0 ? (patch[`osc${playsFrom + 2}_oct`] ?? 0) + 1 : 1;
    patch[`osc${n}_semi`] = playsFrom >= 0 ? (patch[`osc${playsFrom + 2}_semi`] ?? 0) : 0;
    patch[`osc${n}_fine`] = playsFrom >= 0 ? (patch[`osc${playsFrom + 2}_fine`] ?? 0) : 0;
    report.approximated.push(`Osc ${'ABC'[o.index]} unison stack ${o.stack} -> osc ${n} an octave up at the same level${/Fifth/.test(o.stack!) ? ' (the fifth is dropped)' : ''}`);
    report.assumptions.push('S12');
  }
  const noise = body.Oscillator3;
  const noiseVol = noise ? Math.min(1, num(params(noise).kParamVolume, 0.75) + staticOffset('Oscillator3.kParamVolume')) : 0;
  if (noise && params(noise).kParamEnable === 1 && noiseVol > 0) {
    patch.noise = Math.min(1, noiseVol / loudest);
    report.approximated.push(`noise (${params(noise.NoiseOsc3).kParamNoiseType ?? 'sample'}) -> white noise ${patch.noise.toFixed(2)}`);
  }
  const sub = body.Oscillator4;
  const subVol = sub ? Math.min(1, num(params(sub).kParamVolume, 0.75) + staticOffset('Oscillator4.kParamVolume')) : 0;
  if (sub && params(sub).kParamEnable === 1 && subVol > 0) {
    patch.sub = Math.min(1, subVol / loudest);
    const shape = params(sub.SubOsc4).kParamShape ?? 'sine';
    report[/square/i.test(shape) ? 'mapped' : 'approximated'].push(`sub (${shape}) -> AF101 square sub, an octave down, ${patch.sub.toFixed(2)}`);
  }

  // --- Filter (S1)
  const f = params(body.VoiceFilter0);
  let cutoffNorm = 1;
  // AF101 has a low-pass ladder, a 24 dB high-pass and a band-pass (filter_mode).
  // Other types play as the low-pass, and say so.
  let filterKind: 'low' | 'high' | 'band' = 'low';
  if (f.kParamEnable === 1 || Object.keys(f).length) {
    cutoffNorm = num(f.kParamFreq, 0.5);
    const type = String(f.kParamType ?? 'MgL12'); // Serum 2's default (S15)
    filterKind = /^H/i.test(type) ? 'high' : /^B/i.test(type) ? 'band' : 'low';
    if (filterKind === 'low' && !/L(adder|\d)|Mg|LP|Low/i.test(type)) report.approximated.push(`filter type ${type} -> AF101's low-pass ladder`);
    // The low-pass slope: MG Low 12/18/24 (and Low 6) take the ladder after 2/3/4 poles.
    const slope = filterKind === 'low' ? Number(type.match(/L(6|12|18|24)$/)?.[1] ?? 24) : 24;
    if (slope < 24) {
      patch.filter_poles = Math.max(2, slope / 6);
      report.mapped.push(`filter ${type}${f.kParamType ? '' : ' (Serum\'s default)'} -> AF101 low-pass at ${patch.filter_poles * 6} dB per octave${slope === 6 ? ' (6 dB has no AF101 tap; 12 is the nearest)' : ''}`);
      report.assumptions.push('S15');
    }
    patch.resonance = num(f.kParamReso, 0) / 100;
    patch.input_drive = Math.min(1, num(f.kParamDrive, 0) / 100);
    report.assumptions.push('S1');
  }
  if (params(body.VoiceFilter1).kParamEnable === 1) report.dropped.push('second filter');

  // --- Envelopes
  const amp = envOf(body.Env0);
  Object.assign(patch, { attack: amp.attack, decay: amp.decay, sustain: amp.sustain, release: amp.release });
  report.mapped.push(`amp env A ${amp.attack.toFixed(3)} D ${amp.decay.toFixed(3)} S ${amp.sustain.toFixed(2)} R ${amp.release.toFixed(3)} s`);

  // --- Globals
  const g = params(body.Global0);
  const mono = g.kParamMonoToggle === 1;
  if (num(g.kParamPortamentoTime, 0) > 0) {
    patch.glide = num(g.kParamPortamentoTime, 0);
    patch.legato_glide = g.kParamPortaAlways === 1 ? 0 : 1;
    report.mapped.push(`portamento ${patch.glide.toFixed(3)} s${patch.legato_glide ? ', legato only' : ''}`);
  } else if (g.kParamLegato === 1) report.approximated.push('legato (AF101 is legato on overlaps already)');
  if (g.kParamBendRangeUp !== undefined) patch.bend_range = Math.abs(num(g.kParamBendRangeUp, 2));

  // --- LFOs: the first two that a route uses become LFO 1 and 2
  const usedLfos = [...new Set(routes.filter((r) => r.src >= 6 && r.src <= 15).map((r) => r.src - 6))];
  const lfoSlot = new Map<number, number>();
  usedLfos.slice(0, 2).forEach((li, k) => {
    lfoSlot.set(li, k);
    const p = params(body[`LFO${li}`]);
    const free = p.kParamBeatSync === 0;
    const rate = num(p.kParamRate, SERUM_DEFAULT_RATE);
    const retrigger = p.kParamMode === undefined; // Trig, Serum's default (S7)
    let division = 0;
    let how: string;
    if (free) {
      if (k === 0) patch.lfo_rate = Math.min(50, Math.max(0.01, rate));
      else patch.lfo2_rate = Math.min(50, Math.max(0.01, rate));
      how = `at ${rate.toFixed(2)} Hz`;
    } else {
      const beats = serumSyncBeats(rate);
      division = nearestDivision(beats);
      const played = LFO_DIVISION_BEATS[division]!;
      how = `synced at ${divisionName(beats)}`;
      if (Math.abs(Math.log(played / beats)) > 0.01) {
        how += ` (AF101 plays ${divisionName(played)})`;
        report.approximated.push(`LFO ${li + 1} synced at ${divisionName(beats)}: AF101 syncs from 1/32 to 4 bars, so ${divisionName(played)}`);
      }
    }
    const shape = lfoWaveOf(body[`LFO${li}`]);
    patch[k === 0 ? 'lfo1_wave' : 'lfo2_wave'] = lfoMode(shape.wave, retrigger, division);
    report.assumptions.push('S7');
    if (p.kParamMode === 'Envelope') report.approximated.push(`LFO ${li + 1} is in envelope mode: played as a free LFO`);
    if (p.kParamType && p.kParamType !== 'Normal') report.dropped.push(`LFO ${li + 1} type ${p.kParamType}`);
    report.approximated.push(`LFO ${li + 1} -> AF101 LFO ${k + 1} ${how}${retrigger ? ', retriggered' : ''}, ${shape.how} (S14)`);
    report.assumptions.push('S14');
  });
  for (const li of usedLfos.slice(2)) report.dropped.push(`LFO ${li + 1} (AF101 has two)`);

  // --- Sources -> AF101 matrix sources (S11). Envelope 1 is the amp envelope; the
  // first other envelope on the cutoff becomes AF101's filter envelope.
  report.assumptions.push('S11');
  const envUsed = [...new Set(routes.filter((r) => r.src > ENV_SRC_FIRST && r.src <= ENV_SRC_LAST).map((r) => r.src))];
  const filterEnvSrc = envUsed.find((s) => routes.some((r) => r.src === s && r.dest === 'VoiceFilter0.kParamFreq')) ?? envUsed[0];
  if (filterEnvSrc) {
    const e = envOf(body[envModule(filterEnvSrc)]);
    Object.assign(patch, { fenv_separate: 1, fenv_attack: e.attack, fenv_decay: e.decay, fenv_sustain: e.sustain, fenv_release: e.release });
    report.mapped.push(`Env ${filterEnvSrc - 1} -> AF101 filter envelope (A ${e.attack.toFixed(3)} D ${e.decay.toFixed(3)} S ${e.sustain.toFixed(2)} R ${e.release.toFixed(3)})`);
  }
  // The next envelope a route uses becomes AF101's third (a matrix source).
  const others = envUsed.filter((s) => s !== filterEnvSrc);
  const env3Src = others[0];
  if (env3Src) {
    const e = envOf(body[envModule(env3Src)]);
    Object.assign(patch, { env3_attack: e.attack, env3_decay: e.decay, env3_sustain: e.sustain, env3_release: e.release });
    report.mapped.push(`Env ${env3Src - 1} -> AF101 env 3 (A ${e.attack.toFixed(3)} D ${e.decay.toFixed(3)} S ${e.sustain.toFixed(2)} R ${e.release.toFixed(3)})`);
  }
  for (const s of others.slice(1)) report.dropped.push(`Env ${s - 1} (AF101 has an amp, a filter and a third envelope)`);
  const sourceOf = (src: number): number | undefined => {
    if (src === MOD_WHEEL) return SRC.modWheel;
    if (src === ENV_SRC_FIRST) return SRC.ampEnv;
    if (src === filterEnvSrc) return SRC.filterEnv;
    if (src === env3Src) return SRC.env3;
    if (src >= 6 && src <= 15 && lfoSlot.has(src - 6)) return lfoSlot.get(src - 6) === 0 ? SRC.lfo1 : SRC.lfo2;
    if (src === VELOCITY) return SRC.velocity;
    return undefined;
  };

  // --- Destinations
  let staticCutoffOct = 0;
  const wet: Record<string, number> = {}; // static wet offsets from macros, by FX kind (S8)
  const addRoute = (src: number, aux: number, dest: string, amount: number, why: string, bipolar = false) => {
    const scale = auxScale(aux) ?? NaN;
    if (!Number.isFinite(scale)) {
      report.dropped.push(
        aux === VELOCITY
          ? `${why}: scaled by velocity (an AF101 matrix slot has one source)`
          : `${why}: scaled by source ${aux}, which is not confirmed`,
      );
      return;
    }
    const a = amount * scale;
    if (a === 0) {
      report.dropped.push(`${why}: scaled by ${aux === MOD_WHEEL ? 'the mod wheel, which rests' : `macro ${aux - 24}, saved`} at 0`);
      return;
    }
    if (src >= 25 && src <= 32) {
      // a macro: its baked value is static; its own drivers pass through (S6)
      const mi = src - 25;
      const m = macro[mi] ?? 0;
      applyStatic(dest, a * m, `${why} (macro ${mi + 1} at ${(m * 100).toFixed(0)} %)`);
      for (const d of macroDrivers(mi)) addRoute(d.src, d.aux, dest, a * d.amount, `${why} via macro ${mi + 1}`, d.bipolar);
      report.assumptions.push('S6');
      return;
    }
    const s = sourceOf(src);
    if (s === undefined) {
      report.dropped.push(`${why}: source ${src} is not confirmed or has no AF101 equivalent`);
      return;
    }
    // A Serum LFO route is unipolar unless it says bipolar: the destination rises from
    // its base by up to the amount. AF101's LFOs swing +/-1, so half the amount swings
    // around a base raised by the other half (S13).
    let depth = a;
    if ((s === SRC.lfo1 || s === SRC.lfo2) && !bipolar) {
      depth = a / 2;
      if (dest === 'VoiceFilter0.kParamFreq' || dest === 'VoiceFilter0.kParamReso') applyStatic(dest, a / 2, `${why}: unipolar LFO, its centre`);
      else if (dynamicDest(dest, a)) report.approximated.push(`${why}: a unipolar LFO, played centred on the base`);
      report.assumptions.push('S13');
    }
    const d = dynamicDest(dest, depth);
    if (!d) {
      report.dropped.push(`${why}: destination ${dest}`);
      return;
    }
    slots.push({ src: s, dst: d.dst, amt: d.amt, why });
    report.assumptions.push('S4');
  };
  const dynamicDest = (dest: string, a: number): { dst: number; amt: number } | undefined => {
    if (dest === 'VoiceFilter0.kParamFreq') return { dst: DST.cutoff, amt: (a * OCT_RANGE) / MOD_SCALE.cutoffOctaves };
    if (dest === 'VoiceFilter0.kParamReso') return { dst: DST.resonance, amt: a };
    if (/^Oscillator[0-2]\.kParamFine$/.test(dest)) {
      if (audible.length > 1) report.approximated.push(`fine-tune modulation of Osc ${'ABC'[Number(dest[10])]} applies to every AF101 oscillator`);
      return { dst: DST.fine, amt: a };
    }
    if (/^Oscillator[0-4]\.kParamVolume$/.test(dest)) {
      const i = Number(dest[10]);
      if (main && i === main.index) return { dst: DST.osc1Level, amt: a };
      const k = slotsFor.findIndex((o) => o.index === i);
      if (k >= 0) return { dst: k === 0 ? DST.osc2Level : DST.osc3Level, amt: a };
      if (i === 3) return { dst: DST.noiseLevel, amt: a };
      if (i === 4) return { dst: DST.subLevel, amt: a };
      return undefined;
    }
    if (/^LFO\d\.kParamRate$/.test(dest)) {
      const k = lfoSlot.get(Number(dest[3]));
      return k === undefined ? undefined : { dst: k === 0 ? DST.lfo1Rate : DST.lfo2Rate, amt: a };
    }
    return undefined;
  };
  const applyStatic = (dest: string, v: number, why: string) => {
    if (dest === 'VoiceFilter0.kParamFreq') {
      staticCutoffOct += v * OCT_RANGE;
      report.mapped.push(`${why}: cutoff ${v >= 0 ? '+' : ''}${(v * OCT_RANGE).toFixed(2)} oct`);
      return;
    }
    const fx = dest.match(/^(FX\w+?)(\d+)\.kParamWet$/);
    if (fx?.[1]) {
      wet[fx[1]] = (wet[fx[1]] ?? 0) + v * 100;
      report.mapped.push(`${why}: ${fx[1]} wet ${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)} %`);
      return;
    }
    if (/^Oscillator[0-4]\.kParamVolume$/.test(dest)) return; // applied to the levels above
    if (/^RoutingSlot\d\.kParamFXBus\dLevel$/.test(dest)) return; // applied to the FX buses below
    if (dest === 'VoiceFilter0.kParamReso') {
      patch.resonance = Math.min(1, Math.max(0, (patch.resonance ?? 0) + v));
      report.mapped.push(`${why}: resonance ${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)} %`);
      return;
    }
    report.dropped.push(`${why}: ${dest}`);
  };
  for (const r of routes) {
    if (r.dest.startsWith('Macro')) continue; // handled as macro drivers
    addRoute(r.src, r.aux, r.dest, r.amount, `route ${r.src}${r.aux ? '*' + r.aux : ''} -> ${r.dest} ${(r.amount * 100).toFixed(0)} %${r.bipolar ? ' bipolar' : ''}`, r.bipolar);
  }

  // The filter envelope's own depth goes to env_cutoff; the rest stays in the matrix.
  const envCut = slots.filter((s) => s.src === SRC.filterEnv && s.dst === DST.cutoff);
  if (envCut.length) {
    const octs = envCut.reduce((t, s) => t + s.amt * MOD_SCALE.cutoffOctaves, 0);
    if (octs > 0) {
      patch.env_cutoff = Math.min(1, octs / ENV_CUTOFF_OCTAVES);
      for (const s of envCut) slots.splice(slots.indexOf(s), 1);
    }
  }
  const filterHz = clampParam('cutoff', hzOf(cutoffNorm) * Math.pow(2, staticCutoffOct));
  if (filterKind === 'low') {
    patch.cutoff = filterHz;
    report.mapped.push(`cutoff ${cutoffNorm.toFixed(3)} (+${staticCutoffOct.toFixed(2)} oct from macros) -> ${patch.cutoff.toFixed(0)} Hz`);
  } else {
    patch.cutoff = filterHz;
    patch.filter_mode = filterKind === 'high' ? FILTER_MODE.highpass : FILTER_MODE.bandpass;
    report.approximated.push(`${filterKind}-pass filter at ${filterHz.toFixed(0)} Hz -> AF101 ${filterKind === 'high' ? '24 dB high-pass' : 'band-pass'} (its cutoff modulation kept)`);
  }
  const { placed, overflow } = placeMatrix(patch, slots);
  for (const s of overflow) report.dropped.push(`${s.why} (matrix full)`);

  // --- Effects (S8)
  const played = new Set<number>(audible.map((o) => o.index));
  if (patch.noise) played.add(3);
  if (patch.sub) played.add(4);
  for (const [rackIndex, rack] of ['FXRack0', 'FXRack1', 'FXRack2'].entries()) {
    const r = body[rack];
    if (!r || !Array.isArray(r.FX) || !r.FX.length) continue;
    let busWet = 1; // rack 0 is the main insert chain
    if (rackIndex > 0) {
      // A parallel bus (S9): how much of what AF101 plays is sent to it?
      let send = 0;
      for (const i of played) {
        const level = num(params(body[`RoutingSlot${i}`])[`kParamFXBus${rackIndex}Level`], 0) + staticOffset(`RoutingSlot${i}.kParamFXBus${rackIndex}Level`);
        send = Math.max(send, level);
      }
      const x = send * num(params(body.Global0)[`kParamFXBus${rackIndex}Vol`], 1);
      report.assumptions.push('S9');
      if (x <= 0) {
        report.dropped.push(`FX bus ${rackIndex} (${r.FX.length} effects): fed only by parts AF101 does not play`);
        continue;
      }
      busWet = x / (1 + x);
    }
    for (const fx of r.FX) {
      const [kind, inner] = Object.entries(fx).find(([k]) => k.startsWith('FX')) ?? [];
      if (!kind) continue;
      const p = params(inner);
      const w = Math.min(100, Math.max(0, num(p.kParamWet, 50) + (wet[kind] ?? 0))) * busWet;
      if (w <= 0) continue;
      const from = `Serum ${kind.slice(2)} (${rack})`;
      if (kind === 'FXChorus') chain.push({ device: 'Chorus-Ensemble', settings: { Mode: 'Chorus', 'Dry/Wet': +w.toFixed(0), Feedback: +num(p.kParamFeedback, 0).toFixed(0) }, from });
      else if (kind === 'FXDelay') chain.push({ device: 'Delay', settings: { 'L Sync': 'On', 'L 16th': 3, Feedback: +num(p.kParamFeedback, 40).toFixed(0), 'Filter Freq': +num(p.kParamFreq, 2000).toFixed(0), 'Dry/Wet': +w.toFixed(0) }, from });
      else if (kind === 'FXReverb') chain.push({ device: 'Reverb', settings: { 'Decay Time': Math.round((0.5 + num(p.kParamSize, 50) / 100 * 6) * 1000), Predelay: +num(p.kParamDelay, 10).toFixed(1), 'Dry/Wet': +w.toFixed(0) }, from });
      else if (kind === 'FXDistortion') chain.push({ device: 'Saturator', settings: { Drive: +(num(p.kParamDrive, 25) * 0.24).toFixed(1), 'Dry/Wet': +w.toFixed(0) }, from });
      else if (kind === 'FXUtils') chain.push({ device: 'Utility', settings: { Width: 100 + num(p.kParamWidth, 0) }, from });
      else {
        report.dropped.push(`${from} (no Live Standard equivalent mapped)`);
        continue;
      }
      report.approximated.push(`${from} -> ${chain[chain.length - 1]?.device}, wet ${w.toFixed(0)} %`);
      report.assumptions.push('S8');
    }
  }

  const transposeOctaves = (patch as any).__transpose ?? 0;
  delete (patch as any).__transpose;
  if (!mono) {
    patch.voices = 8;
    report.approximated.push('Serum plays this preset polyphonically: AF101 on 8 voices');
    report.assumptions.push('S10');
  }
  return {
    name, source: 'serum', category: categoryOf(name), patch, matrix: placed, chain,
    polyphonic: !mono, transposeOctaves, report,
  };
}
