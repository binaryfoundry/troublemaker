/**
 * AnalogFoundry 101's parameters, as the converters write them.
 *
 * Mirrors `parameterTable()` in analogfoundry/src/model/Preset.h - the single
 * source of truth for the synth. `bridge/tests/presets.test.ts` parses that
 * header and fails if this list drifts from it.
 */

export interface Af101Param {
  id: string;
  min: number;
  max: number;
  def: number;
}

/** The largest packed matrix slot: (kSrcCount - 1) * 17 + 16 routes, amount +1. */
export const MOD_SLOT_MAX = 3740186;

const P = (id: string, min: number, max: number, def: number): Af101Param => ({ id, min, max, def });

export const AF101_PARAMS: Af101Param[] = [
  P('saw', 0, 1, 1), P('pulse', 0, 1, 0), P('sub', 0, 1, 0), P('noise', 0, 1, 0), P('pw', 0.02, 0.98, 0.5),
  P('tune', -12, 12, 0), P('cutoff', 10, 20000, 2000), P('resonance', 0, 1, 0), P('env_cutoff', 0, 1, 0),
  P('lfo_cutoff', 0, 1, 0), P('track', 0, 1, 0), P('attack', 0, 10, 0.002), P('decay', 0, 10, 0.3),
  P('sustain', 0, 1, 0), P('release', 0, 10, 0.1), P('lfo_rate', 0.01, 50, 5), P('lfo_pitch', 0, 12, 0),
  P('lfo_pw', 0, 1, 0), P('glide', 0, 5, 0), P('stage_drive', 0, 1, 0), P('input_drive', 0, 1, 0),
  P('level', 0, 1, 0.8), P('unison', 1, 7, 1), P('unison_detune', 0, 50, 0), P('vel_amp', 0, 1, 0),
  P('vel_cutoff', 0, 1, 0), P('fenv_separate', 0, 1, 0), P('fenv_attack', 0, 10, 0.002), P('fenv_decay', 0, 10, 0.3),
  P('fenv_sustain', 0, 1, 0), P('fenv_release', 0, 10, 0.1), P('vib_fade', 0, 5, 0), P('drift', 0, 30, 0),
  P('legato_glide', 0, 1, 0),
  P('osc2_level', 0, 1, 0), P('osc2_wave', 0, 3, 0), P('osc2_oct', -3, 3, 0), P('osc2_semi', -12, 12, 0), P('osc2_fine', -100, 100, 0),
  P('osc3_level', 0, 1, 0), P('osc3_wave', 0, 3, 0), P('osc3_oct', -3, 3, 0), P('osc3_semi', -12, 12, 0), P('osc3_fine', -100, 100, 0),
  // LFO modes pack wave, retrigger and tempo sync (lfoMode).
  P('lfo1_wave', 0, 139, 0), P('lfo2_rate', 0.01, 50, 2), P('lfo2_wave', 0, 139, 0), P('bend_range', 0, 24, 2),
  // One parameter per matrix slot (packModSlot): Live lists only 64 plugin parameters.
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => P(`mod${n}`, 0, MOD_SLOT_MAX, 10000)),
  // 0.5: stereo, polyphony, a third envelope (a matrix source) and filter modes.
  P('stereo', 0, 1, 0), P('voices', 1, 8, 1), P('env3_attack', 0, 10, 0.002), P('env3_decay', 0, 10, 0.3),
  P('env3_sustain', 0, 1, 0), P('env3_release', 0, 10, 0.1), P('filter_mode', 0, 2, 0),
  // 0.6: the low-pass slope, 2/3/4 poles = 12/18/24 dB per octave.
  P('filter_poles', 2, 4, 4),
];

/** filter_mode values. */
export const FILTER_MODE = { lowpass: 0, highpass: 1, bandpass: 2 } as const;

/** Tempo-sync divisions in beats, index = the division in an LFO mode (0 = free). */
export const LFO_DIVISION_BEATS = [0, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 2, 4, 8, 16] as const;

/** An LFO mode value, exactly as Voice101.h encodeLfoMode: wave + 5 * retrigger + 10 * division. */
export function lfoMode(wave: number, retrigger: boolean, division = 0): number {
  return wave + 5 * (retrigger ? 1 : 0) + 10 * division;
}

/** The sync division nearest a length in beats (in log time), or 0 for none. */
export function nearestDivision(beats: number): number {
  if (!(beats > 0)) return 0;
  let best = 1;
  for (let i = 1; i < LFO_DIVISION_BEATS.length; i++) {
    if (Math.abs(Math.log(beats / LFO_DIVISION_BEATS[i]!)) < Math.abs(Math.log(beats / LFO_DIVISION_BEATS[best]!))) best = i;
  }
  return best;
}

/** Oscillator waves (osc2_wave, osc3_wave). */
export const WAVE = { saw: 0, pulse: 1, triangle: 2, sine: 3 } as const;
/** LFO waves. */
export const LFO_WAVE = { sine: 0, triangle: 1, saw: 2, square: 3, sampleHold: 4 } as const;

/** Matrix sources (Voice101.h ModSource). */
export const SRC = {
  none: 0, ampEnv: 1, filterEnv: 2, lfo1: 3, lfo2: 4, velocity: 5, key: 6, modWheel: 7, aftertouch: 8, noteRandom: 9,
  env3: 10,
  /** 0.7: always 1, for a fixed offset such as a pan position. Only the pans take it. */
  constant: 11,
} as const;
/** Matrix destinations (Voice101.h ModDest) and what amount 1 means for each. */
export const DST = {
  none: 0, cutoff: 1, pitch: 2, osc1Pitch: 3, osc2Pitch: 4, osc3Pitch: 5, pulseWidth: 6, resonance: 7, amp: 8,
  osc1Level: 9, osc2Level: 10, osc3Level: 11, noiseLevel: 12, subLevel: 13, lfo1Rate: 14, lfo2Rate: 15, fine: 16,
  /** 0.7: pans, -1 left to 1 right from the centre (amount 1 = one side). Oscillator and noise pans take LFO 1, LFO 2 or the constant; the voice pan any source. */
  osc1Pan: 17, osc2Pan: 18, osc3Pan: 19, noisePan: 20, pan: 21,
} as const;
/** Amount 1 with a source at 1 moves cutoff 5 octaves, pitch 24 st, fine 100 ct, LFO rate 4 octaves. */
export const MOD_SCALE = { cutoffOctaves: 5, pitchSemitones: 24, fineCents: 100, lfoRateOctaves: 4 } as const;
/** env_cutoff 1 opens the filter this many octaves; vel_cutoff 1 lowers velocity 0 this many. */
export const ENV_CUTOFF_OCTAVES = 6;

export type Af101Patch = Record<string, number>;

export interface MatrixSlot {
  src: number;
  dst: number;
  amt: number;
  /** Where it came from, for the report. */
  why: string;
}

const byId = new Map(AF101_PARAMS.map((p) => [p.id, p]));

export function clampParam(id: string, value: number): number {
  const p = byId.get(id);
  if (!p) throw new Error(`AF101 has no parameter '${id}'`);
  if (!Number.isFinite(value)) return p.def;
  return Math.min(p.max, Math.max(p.min, value));
}

/**
 * The routes 0.4 ignored carry 0.7's pans (Voice101.h kExtraRoutes): source 0 with
 * destination d is EXTRA_ROUTES[d]; destination 0 with a source is that source -> pan.
 */
const EXTRA_ROUTES: Array<[number, number]> = [
  [SRC.none, DST.none],
  [SRC.lfo1, DST.osc1Pan], [SRC.lfo1, DST.osc2Pan], [SRC.lfo1, DST.osc3Pan], [SRC.lfo1, DST.noisePan],
  [SRC.lfo2, DST.osc1Pan], [SRC.lfo2, DST.osc2Pan], [SRC.lfo2, DST.osc3Pan], [SRC.lfo2, DST.noisePan],
  [SRC.constant, DST.osc1Pan], [SRC.constant, DST.osc2Pan], [SRC.constant, DST.osc3Pan], [SRC.constant, DST.noisePan],
  [SRC.constant, DST.pan],
];
/** The route code for a pair, or -1 when a slot cannot hold it (Voice101.h modRoute). */
function modRoute(src: number, dst: number): number {
  if (src <= SRC.none || dst <= DST.none) return src === SRC.none && dst === DST.none ? 0 : -1;
  if (src <= SRC.env3 && dst <= DST.fine) return src * 17 + dst;
  if (src <= SRC.env3 && dst === DST.pan) return src * 17;
  return EXTRA_ROUTES.findIndex(([s, d], i) => i > 0 && s === src && d === dst);
}
export const modRouteExists = (src: number, dst: number): boolean => modRoute(src, dst) >= 0;

/** One matrix slot as one parameter value, exactly as Voice101.h packModSlot does. A pair with no route packs empty. */
export function packModSlot(src: number, dst: number, amt: number): number {
  const a = Math.max(-1, Math.min(1, amt));
  const route = modRoute(src, dst);
  if (route < 0) return 10000;
  return route * 20001 + Math.round((a + 1) * 10000);
}
export function unpackModSlot(v: number): { src: number; dst: number; amt: number } {
  const x = Math.round(Math.max(0, Math.min(MOD_SLOT_MAX, v)));
  const route = Math.floor(x / 20001);
  let src = Math.floor(route / 17), dst = route % 17;
  if (src === SRC.none) [src, dst] = EXTRA_ROUTES[dst] ?? [SRC.none, DST.none];
  else if (dst === DST.none) dst = DST.pan;
  return { src, dst, amt: (x % 20001) / 10000 - 1 };
}

/** Fill the 8 matrix slots, strongest first. Returns what was placed, what did not fit, and pairs no slot can hold. */
export function placeMatrix(patch: Af101Patch, slots: MatrixSlot[]): { placed: MatrixSlot[]; overflow: MatrixSlot[]; unroutable: MatrixSlot[] } {
  const kept = slots.filter((s) => s.amt !== 0 && modRouteExists(s.src, s.dst)).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
  const unroutable = slots.filter((s) => s.amt !== 0 && !modRouteExists(s.src, s.dst));
  const placed = kept.slice(0, 8).map((s, i) => {
    patch[`mod${i + 1}`] = packModSlot(s.src, s.dst, s.amt);
    return { ...s, amt: unpackModSlot(patch[`mod${i + 1}`] ?? 0).amt };
  });
  return { placed, overflow: kept.slice(8), unroutable };
}

/** The AF101 preset text format: `name value` per line; omitted names keep their default. */
export function toPresetText(patch: Af101Patch, comment: string[] = []): string {
  const lines = comment.map((c) => `# ${c}`);
  lines.push('analogfoundry101 1');
  for (const p of AF101_PARAMS) {
    if (!(p.id in patch)) continue;
    const v = clampParam(p.id, patch[p.id] ?? p.def);
    lines.push(`${p.id} ${+v.toPrecision(6)}`);
  }
  return lines.join('\n') + '\n';
}
