/**
 * What a converter produces from one Serum or Diva preset: an AnalogFoundry 101
 * patch, the Live devices to put after it, and an honest account of what did
 * not survive the trip.
 */
import type { Af101Patch, MatrixSlot } from './af101.js';

/** One Live device after AF101, with settings as *display* values in Live 12's own parameter names. */
export interface ChainDevice {
  device: 'Chorus-Ensemble' | 'Delay' | 'Reverb' | 'Saturator' | 'Utility' | 'EQ Eight' | 'Auto Pan-Tremolo';
  settings: Record<string, number | string>;
  from: string;
}

export interface ConversionReport {
  /** Carried over with the source's own numbers. */
  mapped: string[];
  /** Carried over through an assumed curve or a nearest equivalent. */
  approximated: string[];
  /** Not carried over: AF101 or Live Standard has nothing for it. */
  dropped: string[];
  /** The unit and curve assumptions the mapping depends on, by code. */
  assumptions: string[];
}

export interface Conversion {
  name: string;
  source: 'serum' | 'diva';
  /** LD, PL, SY, BS ... from the preset's file-name prefix. */
  category: string;
  patch: Af101Patch;
  matrix: MatrixSlot[];
  chain: ChainDevice[];
  /** The source plays chords; AF101 is monophonic (AGENTS.md *Synthesis*). */
  polyphonic: boolean;
  /** Octaves the clip must be transposed by when the source's base pitch is beyond AF101's +/-12 st tune. */
  transposeOctaves: number;
  report: ConversionReport;
}

export function emptyReport(): ConversionReport {
  return { mapped: [], approximated: [], dropped: [], assumptions: [] };
}

export function categoryOf(name: string): string {
  const m = name.match(/^([A-Z]{2,3}) - /);
  return m?.[1] ?? '';
}

/** A Markdown report a person can read beside the patch. */
export function reportMarkdown(c: Conversion, assumptionText: Record<string, string>): string {
  const lines = [`# ${c.name} -> AnalogFoundry 101`, '', `Source: ${c.source === 'serum' ? 'Serum 2' : 'Diva'} (${c.category || 'uncategorised'})`, ''];
  if (c.polyphonic) lines.push('**Polyphonic source.** AF101 is monophonic: use this patch for single-note parts only, or a Live device for chords.', '');
  if (c.transposeOctaves) lines.push(`**Transpose the clip ${c.transposeOctaves > 0 ? 'up' : 'down'} ${Math.abs(c.transposeOctaves)} octave(s):** the source sits beyond AF101's +/-12 st tune.`, '');
  const section = (title: string, items: string[]) => {
    lines.push(`## ${title}`, '');
    if (!items.length) lines.push('- (none)');
    for (const i of items) lines.push(`- ${i}`);
    lines.push('');
  };
  section('Mapped', c.report.mapped);
  section('Approximated', c.report.approximated);
  section('Dropped', c.report.dropped);
  lines.push('## Matrix', '');
  if (!c.matrix.length) lines.push('- (empty)');
  for (const s of c.matrix) lines.push(`- src ${s.src} -> dst ${s.dst} x ${+s.amt.toFixed(4)}: ${s.why}`);
  lines.push('', '## Live chain after AF101', '');
  if (!c.chain.length) lines.push('- (none)');
  for (const d of c.chain) lines.push(`- **${d.device}** (${d.from}): ${Object.entries(d.settings).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push('', '## Assumptions', '');
  for (const a of [...new Set(c.report.assumptions)]) lines.push(`- **${a}**: ${assumptionText[a] ?? a}`);
  return lines.join('\n') + '\n';
}
