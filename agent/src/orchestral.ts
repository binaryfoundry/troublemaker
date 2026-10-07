/**
 * ORCHESTRAL.md as code: practical sounding ranges (section 21) and the
 * active-layer budget (section 7).
 *
 * The ranges are stored as the document gives them, in scientific pitch
 * (C4 = 60), and converted here. ORCHESTRAL.md does not name its octave
 * convention; read in Live's names (C3 = 60) its ranges would sit an octave
 * too high, so findings name each note both ways.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { midiToNoteName, noteNameToMidi, type OctaveConvention } from './music-theory.js';

export interface InstrumentRange {
  family: 'strings' | 'woodwinds' | 'brass';
  low: string;
  high: string;
}

export interface OrchestralKnowledge {
  source: string;
  convention: OctaveConvention;
  convention_note: string;
  extensions_note: string;
  instruments: Record<string, InstrumentRange>;
  layer_budget: {
    section: number;
    primary: number;
    secondary_max: number;
    harmonic_support: number;
    foundation: number;
    optional_rhythm_or_texture: number;
    note: string;
  };
}

const PATH = fileURLToPath(new URL('../knowledge/orchestral.json', import.meta.url));
let cached: OrchestralKnowledge | null = null;

export function orchestralKnowledge(): OrchestralKnowledge {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as OrchestralKnowledge;
  return cached;
}

/** The instrument's sounding range as MIDI numbers. */
export function instrumentRange(instrument: string): { low: number; high: number } {
  const k = orchestralKnowledge();
  const range = k.instruments[instrument];
  if (!range) {
    throw new Error(`Unknown instrument "${instrument}". Known: ${Object.keys(k.instruments).join(', ')}.`);
  }
  return { low: noteNameToMidi(range.low, k.convention), high: noteNameToMidi(range.high, k.convention) };
}

export interface RangeFinding {
  severity: 'warn';
  pitch: number;
  message: string;
}

const both = (pitch: number) =>
  `MIDI ${pitch} (${midiToNoteName(pitch, 'live')} in Live, ${midiToNoteName(pitch, 'scientific')} scientific)`;

/**
 * Section 21: notes outside the instrument's practical range. One finding per
 * distinct pitch, so a part that sits an octave too high says so once per note
 * rather than once per hit.
 */
export function checkInstrumentRange(instrument: string, pitches: number[]): RangeFinding[] {
  const { low, high } = instrumentRange(instrument);
  const findings: RangeFinding[] = [];
  for (const pitch of [...new Set(pitches)].sort((a, b) => a - b)) {
    if (pitch < low) {
      findings.push({ severity: 'warn', pitch, message: `${instrument}: ${both(pitch)} is below its range, which starts at ${both(low)}.` });
    } else if (pitch > high) {
      findings.push({ severity: 'warn', pitch, message: `${instrument}: ${both(pitch)} is above its range, which ends at ${both(high)}.` });
    }
  }
  return findings;
}
