/**
 * Role classification from sample paths.
 *
 * The rules match words in the folder and file names. They must match *words*,
 * not substrings: the "TPS x CamelPhat" pack named every one of its 346 files
 * "CamelPhat - <role> NN.wav", and an unanchored /hats?\b/ matched the "Phat"
 * in the artist name, so risers, drones and impacts were all indexed as hats.
 */

import { describe, expect, it } from 'vitest';
import { classifySample, keyFromName } from '../../qc/src/samples.js';

const CP = 'TPS x CamelPhat - Producer Pack/TPS x CamelPhat - Sample Pack';

describe('classifySample', () => {
  it('does not read a role out of the middle of a word', () => {
    // "CamelPhat" ends in "hat"; "Bridges" contains "ride".
    expect(classifySample(`${CP}/FX/Riser/TPS x CamelPhat - Riser 06.wav`).role).toBe('fx');
    expect(classifySample(`${CP}/FX/Impacts/TPS x CamelPhat - Impact 01.wav`).role).toBe('fx');
    expect(classifySample(`${CP}/FX/Synth Drones/TPS x CamelPhat - Synth Drone 03 C.wav`).role).toBe(
      'atmosphere',
    );
    expect(classifySample('MIDI/BS - Bridges.wav').role).not.toBe('hats');
  });

  it('still classifies the pack roles it should', () => {
    expect(classifySample(`${CP}/Drums/Kicks/TPS x CamelPhat - Kick 11.wav`).role).toBe('kick');
    expect(classifySample(`${CP}/Drums/Claps/TPS x CamelPhat - Clap 11.wav`).role).toBe('clap');
    expect(classifySample(`${CP}/Drums/Closed Hats/TPS x CamelPhat - Closed Hat 04.wav`).role).toBe(
      'hats',
    );
    expect(classifySample(`${CP}/Drums/Open Hats/TPS x CamelPhat - Open Hat 02.wav`).role).toBe(
      'hats',
    );
    expect(classifySample(`${CP}/Drums/Shakers/TPS x CamelPhat - Shaker 03.wav`).role).toBe('perc');
    expect(classifySample(`${CP}/Drums/Toms/TPS x CamelPhat - Tom 05.wav`).role).toBe('perc');
    expect(classifySample(`${CP}/Drums/Snares/TPS x CamelPhat - Snare 02.wav`).role).toBe('snare');
    expect(classifySample(`${CP}/Fills/TPS x CamelPhat - Fill 04.wav`).role).toBe('perc');
  });

  it('marks loops as loops', () => {
    const top = classifySample(`${CP}/Drumloops/Top Loops/TPS x CamelPhat - Top Loop 03.wav`);
    expect(top.role).toBe('loop');
    expect(top.loop).toBe(true);
  });

  it('keeps classifying the underscore-separated pack', () => {
    expect(classifySample('EDM Tips Creative Toolkit/Drums/Claps/ETCT1_Claps_1.wav').role).toBe(
      'clap',
    );
    expect(
      classifySample('EDM Tips Creative Toolkit/Drums/Hi-Hats/ETCT1_Hi-Hats_Closed_Hat_3.wav').role,
    ).toBe('hats');
    expect(classifySample('EDM Tips Creative Toolkit/Drums/Kicks/ETCT1_Kick_Techno_1.wav').role).toBe(
      'kick',
    );
  });

  it('reads the key out of the pack naming', () => {
    expect(keyFromName('TPS x CamelPhat - Bass Loop 03 Amin (124 BPM).wav')).toBe('Am');
    expect(keyFromName('TPS x CamelPhat - Signature Lead Shot 01 C.wav')).toBe('C');
  });
});
