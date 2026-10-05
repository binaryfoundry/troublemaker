/**
 * u-he Diva (.h2p) -> AnalogFoundry 101.
 *
 * .h2p is plain text: `#cm=SECTION` headers, then `Key=Value` lines, then a
 * binary blob that is not read. Diva models analogue circuits much as AF101
 * does, so its oscillators, ladder filter and envelopes map closely - but its
 * knob units are not documented in the file. Every unit assumption is coded
 * (D1...) and listed in the report; the oscillator-model reading below was
 * inferred from which fields vary per model across the 60 pack presets.
 */
import { DST, ENV_CUTOFF_OCTAVES, LFO_WAVE, MOD_SCALE, SRC, WAVE, clampParam, placeMatrix, type Af101Patch, type MatrixSlot } from './af101.js';
import { categoryOf, emptyReport, type ChainDevice, type Conversion } from './types.js';

export const DIVA_ASSUMPTIONS: Record<string, string> = {
  D1: "Envelope times are 0-100 knobs read as t = 12 s x (knob/100)^4 (25 = 47 ms, 50 = 0.75 s, 75 = 3.8 s). The curve is not in the file: it was fitted to the same producer's Serum presets, which store seconds (median releases: leads 0.28 s, plucks 0.08 s, pads 0.33 s), against these presets' knob medians. A log curve over the knob range gave 16-36 ms releases - clicks.",
  D2: 'Filter cutoff is a note number (60 = 262 Hz, 113.5 = 5.8 kHz), as u-he synths scale it.',
  D3: 'A modulation depth on cutoff is in semitones; on pitch, in semitones.',
  D4: 'ENV1 drives the amplifier and ENV2 the filter: across the pack ENV2 is routed to cutoff with sustain 0 in 28 of 29 leads and plucks, and pads keep sustain on ENV1.',
  D5: 'Oscillator models: 0 Triple VCO (Vol/Tune/Shape per oscillator; Shape 5 = saw, above toward pulse, below toward triangle), 1 and 3 Dual VCO (wave switches, OscMix crossfading 0 = osc 1 to 100 = osc 2), 2 DCO (Saw/Pulse switches, Vol3 = sub, Noise), 4 Digital (wave types unknown: saw).',
  D6: 'OSC Drift 0-100 % is read as 0-10 cents of slow pitch wander.',
  D7: 'VCC Mode 0 is polyphonic, 1 mono, 2 legato.',
  D8: 'LFO rates are not read reliably from the file: synced LFOs are approximated at one cycle a beat at 124 BPM.',
  D9: 'Effects become the nearest Live 12 Standard devices: Chorus -> Chorus-Ensemble, Delay -> Delay (dotted 8th), Plate -> Reverb, wet = wet / (dry + wet).',
};

export type DivaPreset = Record<string, Record<string, string>>;

export function parseDiva(text: string): DivaPreset {
  const out: DivaPreset = {};
  const sources: string[] = [];
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('$$$$')) break; // the binary blob
    const ms = line.match(/^#ms=(.*)$/);
    if (ms?.[1] !== undefined) {
      sources.push(ms[1]);
      continue;
    }
    const cm = line.match(/^#cm=(\w+)/);
    if (cm?.[1]) {
      section = cm[1];
      out[section] = out[section] ?? {};
      continue;
    }
    const kv = line.match(/^(\w+)=(.*)$/);
    if (kv?.[1] && section) (out[section] as Record<string, string>)[kv[1]] = (kv[2] ?? '').replace(/'/g, '');
  }
  out.__sources = Object.fromEntries(sources.map((s, i) => [String(i), s]));
  return out;
}

const n = (v: string | undefined, d = 0): number => {
  const x = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(x) ? x : d;
};
const seconds = (knob: number) => Math.max(0.0005, 12 * Math.pow(Math.min(100, Math.max(0, knob)) / 100, 4));
const noteHz = (x: number) => 440 * Math.pow(2, (x - 69) / 12);
const BEAT_HZ = 124 / 60;

export function convertDiva(d: DivaPreset, name: string): Conversion {
  const report = emptyReport();
  const patch: Af101Patch = {};
  const slots: MatrixSlot[] = [];
  const chain: ChainDevice[] = [];
  const S = (k: string) => d[k] ?? {};
  const src = d.__sources ?? {};
  const O = S('OSC');
  const model = Math.round(n(O.Model));
  report.assumptions.push('D5');

  // --- Oscillators: collect (wave, level, semis), then the loudest saw/pulse is osc 1
  type Part = { label: string; wave: number; level: number; semis: number; pulseToo?: boolean };
  const parts: Part[] = [];
  let noise = n(O.Noise) / 100;
  let sub = 0;
  if (model === 0) {
    for (const i of [1, 2, 3]) {
      const level = n(O[`Vol${i}`]) / 100;
      if (level <= 0) continue;
      const shape = n(O[`Shape${i}`], 5);
      const wave = shape > 6 ? WAVE.pulse : shape < 3 ? WAVE.triangle : WAVE.saw;
      parts.push({ label: `VCO ${i}`, wave, level, semis: n(O[`Tune${i}`]) });
      if (Math.abs(shape - 5) > 0.5 && Math.abs(shape - 7) > 0.5) report.approximated.push(`VCO ${i} shape ${shape} -> ${['saw', 'pulse', 'triangle', 'sine'][wave]}`);
    }
  } else if (model === 1 || model === 3) {
    const mix = n(O.OscMix, 50) / 100;
    const w1: string[] = ['Saw1', 'PWM1', 'Tri1', 'Noise1'].filter((k) => O[k] === '1');
    const w2: string[] = ['Saw2', 'PW2', 'PWM2', 'Tri2', 'Sin2'].filter((k) => O[k] === '1');
    const waveOf = (ws: string[]) => (ws.some((w) => /Saw/.test(w)) ? WAVE.saw : ws.some((w) => /PW/.test(w)) ? WAVE.pulse : ws.some((w) => /Tri/.test(w)) ? WAVE.triangle : WAVE.sine);
    if (w1.includes('Noise1')) {
      noise = Math.max(noise, 1 - mix);
      report.mapped.push(`osc 1 is noise, at ${(1 - mix).toFixed(2)} of the mix`);
    } else if (w1.length && 1 - mix > 0) parts.push({ label: 'VCO 1', wave: waveOf(w1), level: 1 - mix, semis: n(O.Tune1), pulseToo: w1.some((w) => /PW/.test(w)) && w1.some((w) => /Saw/.test(w)) });
    if (w2.length && mix > 0) parts.push({ label: 'VCO 2', wave: waveOf(w2), level: mix, semis: n(O.Tune2), pulseToo: w2.some((w) => /PW/.test(w)) && w2.some((w) => /Saw/.test(w)) });
  } else if (model === 2) {
    const saw = O.SawShp !== '0';
    const pulse = n(O.PWShp) > 0;
    if (saw || pulse) parts.push({ label: 'DCO', wave: saw ? WAVE.saw : WAVE.pulse, level: 1, semis: n(O.Tune1), pulseToo: saw && pulse });
    sub = n(O.Vol3) / 100;
  } else {
    const mix = n(O.OscMix, 50) / 100;
    if (1 - mix > 0) parts.push({ label: 'digital 1', wave: WAVE.saw, level: 1 - mix, semis: n(O.Tune1) });
    if (mix > 0) parts.push({ label: 'digital 2', wave: WAVE.saw, level: mix, semis: n(O.Tune2) });
    report.approximated.push(`digital oscillators (types ${O.DgtlTp1}/${O.DgtlTp2}) -> saw`);
  }
  const loudest = Math.max(1e-9, ...parts.map((p) => p.level));
  const main = parts.filter((p) => p.wave === WAVE.saw || p.wave === WAVE.pulse).sort((a, b) => b.level - a.level)[0] ?? parts[0];
  const others = parts.filter((p) => p !== main);
  let transposeOctaves = 0;
  if (main) {
    const tune = Math.max(-12, Math.min(12, main.semis));
    transposeOctaves = Math.round((main.semis - tune) / 12);
    patch.tune = tune;
    const lvl = main.level / loudest;
    if (main.wave === WAVE.pulse) Object.assign(patch, { saw: 0, pulse: lvl });
    else if (main.wave === WAVE.saw) Object.assign(patch, { saw: lvl, pulse: main.pulseToo ? lvl * 0.7 : 0 });
    else {
      patch.saw = 0;
      others.unshift(main);
    }
    report.mapped.push(`${main.label} -> osc 1 (${main.pulseToo ? 'saw + pulse' : ['saw', 'pulse', 'triangle', 'sine'][main.wave]}), level ${lvl.toFixed(2)}, tune ${tune} st`);
    if (transposeOctaves) report.approximated.push(`base pitch ${main.semis} st is beyond +/-12: transpose the clip ${transposeOctaves} octave(s)`);
  }
  others.slice(0, 2).forEach((p, k) => {
    const rel = main && main !== p ? p.semis - main.semis : 0;
    const oct = Math.max(-3, Math.min(3, Math.trunc(rel / 12)));
    const semi = Math.max(-12, Math.min(12, Math.trunc(rel - oct * 12)));
    const fine = (rel - oct * 12 - semi) * 100;
    const id = `osc${k + 2}`;
    Object.assign(patch, { [`${id}_level`]: p.level / loudest, [`${id}_wave`]: p.wave, [`${id}_oct`]: oct, [`${id}_semi`]: semi, [`${id}_fine`]: fine });
    report.mapped.push(`${p.label} -> ${id.replace('osc', 'osc ')} (${['saw', 'pulse', 'triangle', 'sine'][p.wave]}), level ${(p.level / loudest).toFixed(2)}, ${oct} oct ${semi} st ${fine.toFixed(0)} ct`);
  });
  for (const p of others.slice(2)) report.dropped.push(`${p.label} (AF101 has three oscillators)`);
  if (noise > 0) {
    patch.noise = Math.min(1, noise / loudest);
    report.mapped.push(`noise ${patch.noise.toFixed(2)}`);
  }
  if (sub > 0) {
    patch.sub = Math.min(1, sub / loudest);
    report.mapped.push(`DCO sub ${patch.sub.toFixed(2)}`);
  }
  patch.pw = Math.min(0.98, Math.max(0.02, n(O.PW, 50) / 100));
  const drift = n(O.Drift);
  if (drift > 0) {
    patch.drift = Math.min(30, drift / 10);
    report.approximated.push(`drift ${drift} % -> ${patch.drift.toFixed(1)} cents`);
    report.assumptions.push('D6');
  }

  // --- Envelopes (D1, D4)
  const env = (k: string) => {
    const e = S(k);
    return { attack: seconds(n(e.Atk)), decay: seconds(n(e.Dec, 50)), sustain: n(e.Sus, 100) / 100, release: seconds(n(e.Rel, 20)), vel: n(e.Vel) / 100 };
  };
  const amp = env('ENV1');
  const fe = env('ENV2');
  Object.assign(patch, { attack: amp.attack, decay: amp.decay, sustain: amp.sustain, release: amp.release });
  Object.assign(patch, { fenv_separate: 1, fenv_attack: fe.attack, fenv_decay: fe.decay, fenv_sustain: fe.sustain, fenv_release: fe.release });
  report.approximated.push(`ENV1 -> amp: A ${amp.attack.toFixed(3)} D ${amp.decay.toFixed(3)} S ${amp.sustain.toFixed(2)} R ${amp.release.toFixed(3)} s`);
  report.approximated.push(`ENV2 -> filter envelope: A ${fe.attack.toFixed(3)} D ${fe.decay.toFixed(3)} S ${fe.sustain.toFixed(2)} R ${fe.release.toFixed(3)} s`);
  report.assumptions.push('D1', 'D4');
  if (amp.vel > 0) {
    patch.vel_amp = Math.min(1, amp.vel);
    report.mapped.push(`ENV1 velocity ${(amp.vel * 100).toFixed(0)} % -> velocity to amp`);
  }

  // --- Filter (D2, D3)
  const F = S('VCF1');
  patch.cutoff = clampParam('cutoff', noteHz(n(F.Freq, 100)));
  patch.resonance = Math.min(1, n(F.Res) / 100);
  patch.track = Math.min(1, n(F.KeyScl) / 100);
  report.approximated.push(`cutoff ${F.Freq} -> ${patch.cutoff.toFixed(0)} Hz, resonance ${patch.resonance.toFixed(2)}, key tracking ${patch.track.toFixed(2)}`);
  report.assumptions.push('D2', 'D3');
  if (n(F.Model) > 1) report.approximated.push(`filter model ${F.Model} -> AF101's ladder`);

  // --- LFOs (D8)
  for (const [k, id] of [['LFO1', 'lfo_rate'], ['LFO2', 'lfo2_rate']] as const) {
    const L = S(k);
    const wave = n(L.Wave, 1);
    const lfoWave = [LFO_WAVE.sine, LFO_WAVE.triangle, LFO_WAVE.saw, LFO_WAVE.square, LFO_WAVE.sampleHold][Math.max(0, Math.min(4, Math.round(wave) - 1))] ?? LFO_WAVE.sine;
    patch[id] = BEAT_HZ;
    patch[k === 'LFO1' ? 'lfo1_wave' : 'lfo2_wave'] = lfoWave;
    if (L.Trig === '1') patch[k === 'LFO1' ? 'lfo1_retrig' : 'lfo2_retrig'] = 1;
  }
  report.assumptions.push('D8');

  // --- Modulation: Diva's per-target source/depth pairs -> the matrix
  const srcOf = (code: string | undefined): number | undefined => {
    const label = src[String(Math.round(n(code)))];
    return ({ Env1: SRC.ampEnv, Env2: SRC.filterEnv, LFO1: SRC.lfo1, LFO2: SRC.lfo2, Velocity: SRC.velocity, KeyFollow: SRC.key, ModWhl: SRC.modWheel, Pressure: SRC.aftertouch, Random: SRC.noteRandom } as Record<string, number>)[label ?? ''];
  };
  const route = (srcCode: string | undefined, depth: number, dest: number, scale: number, what: string) => {
    if (!depth) return;
    const s = srcOf(srcCode);
    const label = src[String(Math.round(n(srcCode)))] ?? srcCode;
    if (s === undefined) {
      if (label && label !== 'none') report.dropped.push(`${what}: source ${label}`);
      return;
    }
    slots.push({ src: s, dst: dest, amt: depth * scale, why: `${what}: ${label} ${depth}` });
  };
  // Cutoff: depth in semitones (D3)
  route(F.FMSrc, n(F.FMDpt), DST.cutoff, 1 / 12 / MOD_SCALE.cutoffOctaves, 'cutoff mod 1');
  route(F.FM2Src, n(F.FM2Dpt), DST.cutoff, 1 / 12 / MOD_SCALE.cutoffOctaves, 'cutoff mod 2');
  route(F.ResSrc, n(F.ResDpt), DST.resonance, 1 / 100, 'resonance mod');
  // Pitch: tune mods in semitones
  route(O.TM1Src, n(O.TM1Dpt), DST.pitch, 1 / MOD_SCALE.pitchSemitones, 'pitch mod 1');
  route(O.TM2Src, n(O.TM2Dpt), DST.pitch, 1 / MOD_SCALE.pitchSemitones, 'pitch mod 2');
  route(O.PWMSrc, n(O.PWMDpt), DST.pulseWidth, 1 / 100, 'pulse-width mod');
  if (n(S('VCA1').PanDpt)) report.dropped.push(`pan modulation (${src[String(Math.round(n(S('VCA1').PanSrc)))]}): AF101 is mono`);
  if (n(O.Sh1Dpt)) report.dropped.push('oscillator shape modulation');

  // The filter envelope's depth goes to env_cutoff; the rest stays in the matrix.
  for (const s of slots.filter((x) => x.src === SRC.filterEnv && x.dst === DST.cutoff && x.amt > 0)) {
    patch.env_cutoff = Math.min(1, (patch.env_cutoff ?? 0) + (s.amt * MOD_SCALE.cutoffOctaves) / ENV_CUTOFF_OCTAVES);
    report.mapped.push(`${s.why} semitones -> env_cutoff ${patch.env_cutoff.toFixed(3)}`);
    slots.splice(slots.indexOf(s), 1);
  }
  const { placed, overflow } = placeMatrix(patch, slots);
  for (const s of overflow) report.dropped.push(`${s.why} (matrix full)`);

  // --- Voice control (D7)
  const V = S('VCC');
  const mode = Math.round(n(V.Mode));
  const polyphonic = mode === 0;
  if (mode === 2) patch.legato_glide = 1;
  if (n(V.Porta) > 0) {
    patch.glide = seconds(n(V.Porta)) / 2;
    report.approximated.push(`portamento ${V.Porta} -> ${patch.glide.toFixed(3)} s`);
  }
  report.assumptions.push('D7');
  if (polyphonic) report.approximated.push(`Diva plays this polyphonically (${V.Voices} voices); AF101 is monophonic`);

  // --- Effects (D9)
  for (const slot of ['FX1', 'FX2']) {
    const mod = S(slot).Module ?? '';
    const num = mod.replace(/\D/g, '');
    const kind = mod.replace(/\d/g, '');
    const P = S(kind === 'Chorus' ? `Chrs${num}` : kind === 'Plate' ? `Plate${num}` : kind === 'Delay' ? `Delay${num}` : `${kind}${num}`);
    const from = `Diva ${mod}`;
    if (kind === 'Chorus') {
      const wet = n(P.Wet, 50);
      if (wet > 0) chain.push({ device: 'Chorus-Ensemble', settings: { Mode: 'Chorus', Rate: +(0.1 + n(P.Rate, 50) / 100 * 2).toFixed(2), Amount: +n(P.Depth, 50).toFixed(0), 'Dry/Wet': +wet.toFixed(0) }, from });
    } else if (kind === 'Plate') {
      const wet = n(P.Wet), dry = n(P.Dry, 100);
      if (wet > 0) chain.push({ device: 'Reverb', settings: { 'Decay Time': Math.round((0.5 + n(P.Decay, 50) / 100 * 5) * 1000), Predelay: +n(P.Pre).toFixed(1), 'Dry/Wet': +((wet / (wet + dry)) * 100).toFixed(0) }, from });
    } else if (kind === 'Delay') {
      const wet = n(P.SVol) + n(P.CVol), dry = n(P.Dry, 100);
      if (wet > 0) chain.push({ device: 'Delay', settings: { 'L Sync': 'On', 'L 16th': 3, Feedback: +n(P.FeedB, 25).toFixed(0), 'Dry/Wet': +((wet / (wet + dry)) * 100).toFixed(0) }, from });
    } else if (mod) {
      report.dropped.push(`${from} (no Live Standard equivalent mapped)`);
      continue;
    } else continue;
    const last = chain[chain.length - 1];
    if (last && last.from === from) report.approximated.push(`${from} -> ${last.device}`);
  }
  report.assumptions.push('D9');
  const hp = n(S('HPF').Freq);
  if (hp > 0) {
    chain.unshift({ device: 'EQ Eight', settings: { '1 Filter Type A': 'High Pass 12dB', '1 Frequency A': +noteHz(hp).toFixed(0), '1 Filter On A': 'On' }, from: 'Diva HPF' });
    report.approximated.push(`HPF ${hp} -> EQ Eight high-pass at ${noteHz(hp).toFixed(0)} Hz`);
  }

  return { name, source: 'diva', category: categoryOf(name), patch, matrix: placed, chain, polyphonic, transposeOctaves, report };
}
