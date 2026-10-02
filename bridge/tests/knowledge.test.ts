import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', 'agent', 'knowledge');
const effects = JSON.parse(readFileSync(join(root, 'effects.json'), 'utf8')) as {
  energy_functions: Record<string, string>;
  effects: Array<Record<string, any>>;
};
const styles = JSON.parse(readFileSync(join(root, 'styles.json'), 'utf8')) as {
  styles: Record<string, any>;
};

/** Read from the real Live 12.4 Standard devices; Suite-only ones excluded. */
const STANDARD_DEVICES = new Set([
  'Auto Filter', 'Auto Pan-Tremolo', 'Beat Repeat', 'Delay', 'Reverb', 'Gate', 'Compressor',
  'Redux', 'Chorus-Ensemble', 'Phaser-Flanger', 'Shifter', 'Grain Delay', 'Resonators', 'Corpus',
  'Vocoder', 'Drum Buss', 'Saturator', 'Limiter', 'Utility', 'EQ Eight', 'Glue Compressor',
]);
const SUITE_ONLY = ['Echo', 'Hybrid Reverb', 'Spectral Time', 'Roar'];
const GENERATORS = new Set([
  'retriggerRamp', 'fill', 'risingNotes', 'impact', 'silenceGap', 'polymeterClip',
]);

describe('effects codex', () => {
  const ids = effects.effects.map((e) => e.id);

  it('has unique ids and covers the effect families from both documents', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    for (const required of ['tape_stop', 'retrigger_deceleration', 'exponential_ratchet', 'sidechain_pump', 'reverse_reverb']) {
      expect(ids).toContain(required);
    }
  });

  it('only uses declared energy functions', () => {
    for (const effect of effects.effects) {
      for (const energy of effect.energy) {
        expect(effects.energy_functions, `${effect.id}: ${energy}`).toHaveProperty(energy);
      }
    }
  });

  it('cross-references effects that exist', () => {
    for (const effect of effects.effects) {
      for (const other of effect.distinguish_from ?? []) {
        expect(ids, `${effect.id} -> ${other.id}`).toContain(other.id);
      }
    }
  });

  it('builds recipes only from devices this machine has', () => {
    for (const effect of effects.effects) {
      for (const device of effect.build.devices ?? []) {
        expect(STANDARD_DEVICES.has(device.name), `${effect.id} uses ${device.name}`).toBe(true);
        expect(SUITE_ONLY).not.toContain(device.name);
      }
    }
  });

  it('gives every recipe a known method, placement and generator', () => {
    for (const effect of effects.effects) {
      const { build } = effect;
      expect(['devices', 'midi', 'unsupported']).toContain(build.method);
      if (build.method === 'devices') expect(['insert', 'return']).toContain(build.placement);
      if (build.method === 'midi') expect(GENERATORS.has(build.generator), effect.id).toBe(true);
      if (build.method === 'unsupported') expect(build.note, effect.id).toBeTruthy();
      if (build.placement === 'return') expect(build.return_name, effect.id).toBeTruthy();
    }
  });

  it('writes automation points as fractions of the span, in order', () => {
    for (const effect of effects.effects) {
      for (const lane of effect.build.automation ?? []) {
        const ats = lane.points.map((p: { at: number }) => p.at);
        expect(ats[0], effect.id).toBe(0);
        expect(ats.at(-1), effect.id).toBe(1);
        expect([...ats].sort((a, b) => a - b), effect.id).toEqual(ats);
      }
    }
  });

  it('tags references with documented or auditory evidence', () => {
    for (const effect of effects.effects) {
      for (const ref of effect.references) expect(['D', 'A']).toContain(ref.evidence);
    }
  });
});

describe('style defaults', () => {
  it('lays sections on 8-bar multiples with sane tempos and energies', () => {
    for (const [name, style] of Object.entries(styles.styles)) {
      expect(style.tempo[0], name).toBeLessThan(style.tempo[1]);
      for (const section of style.sections) {
        expect(section.bars % 8, `${name}/${section.name}`).toBe(0);
        expect(section.energy).toBeGreaterThanOrEqual(0);
        expect(section.energy).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reserves the fullest energy for a real peak, not the intro', () => {
    for (const [name, style] of Object.entries(styles.styles)) {
      const peak = Math.max(...style.sections.map((s: { energy: number }) => s.energy));
      expect(style.sections[0].energy, name).toBeLessThan(peak);
      expect(style.sections.at(-1).energy, name).toBeLessThan(peak);
    }
  });
});
