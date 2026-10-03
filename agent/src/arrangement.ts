/**
 * Arrangement planning and checking (COMPOSITION.md).
 *
 * A plan is a list of sections in bars, each with an energy level and the
 * roles that play in it. The checker applies the DJ-friendly rules: sections
 * on 8-bar boundaries, something changes at least every 16 bars, nothing
 * static for 32, the fullest state reserved for genuine peaks. The builder
 * turns a plan into commands that lay Session loops onto the Arrangement,
 * which is the scenes-to-timeline workflow the document recommends.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { partsForEnergy } from './composition.js';

export interface PlannedSection {
  name: string;
  startBar: number;
  bars: number;
  energy: number;
  roles: string[];
}

interface StyleSection {
  name: string;
  bars: number;
  energy: number;
  /** Explicit roles: played as written, not split into halves. */
  roles?: string[];
  note?: string;
}

interface StyleFile {
  styles: Record<string, { tempo: [number, number]; sections: StyleSection[] }>;
  arrangement_rules: { change_every_bars: number; max_static_bars: number };
}

let cachedStyles: StyleFile | null = null;

const STYLES_PATH = fileURLToPath(new URL('../knowledge/styles.json', import.meta.url));

export function loadStyles(path = STYLES_PATH): StyleFile {
  if (!cachedStyles) cachedStyles = JSON.parse(readFileSync(path, 'utf8')) as StyleFile;
  return cachedStyles;
}

export function styleNames(): string[] {
  return Object.keys(loadStyles().styles);
}

export type SectionFunction = 'intro' | 'build' | 'peak' | 'break' | 'outro' | 'other';

/** What a section is for, from its name as the style templates spell it. */
export function sectionFunction(name: string): SectionFunction {
  const n = name.toLowerCase();
  if (/intro/.test(n)) return 'intro';
  if (/outro/.test(n)) return 'outro';
  if (/break|reset|breakdown/.test(n)) return 'break';
  if (/build|groove|development|rise|low end|tease/.test(n)) return 'build';
  if (/peak|main|drop|variation/.test(n)) return 'peak';
  return 'other';
}

const ALL_ROLES = ['kick', 'hats', 'perc', 'bass', 'clap', 'chords', 'lead', 'atmosphere'];

/**
 * Roles for the first and second half of each kind of section
 * (COMPOSITION.md): a DJ intro and outro are beat-led so another record can
 * be mixed against them; a build layers parts in; the break drops the kick
 * and bass and lets the harmony and motif carry the tension; the peak plays
 * everything. Splitting in halves gives a change every 16 bars.
 */
const LAYERS: Record<Exclude<SectionFunction, 'other'>, [string[], string[]]> = {
  intro: [['kick', 'hats'], ['kick', 'hats', 'atmosphere']],
  build: [['kick', 'hats', 'bass', 'atmosphere'], ['kick', 'hats', 'perc', 'bass', 'atmosphere', 'clap', 'chords']],
  peak: [ALL_ROLES, ALL_ROLES],
  break: [['atmosphere', 'chords'], ['atmosphere', 'chords', 'lead']],
  outro: [['kick', 'hats', 'perc', 'bass', 'atmosphere'], ['kick', 'hats']],
};

/**
 * A plan from a style template. `roles` lists the parts the track actually
 * has. Sections of 16 bars or more are split into two halves with their own
 * layers; sections whose name says nothing about their job fall back to the
 * parts their energy calls for.
 */
export function planArrangement(style: string, options: { roles?: string[] } = {}): PlannedSection[] {
  const template = loadStyles().styles[style];
  if (!template) {
    throw new RangeError(`Unknown style '${style}'. Known: ${styleNames().join(', ')}.`);
  }
  const available = options.roles;
  const keep = (wanted: string[]) => (available ? wanted.filter((r) => available.includes(r)) : [...wanted]);
  const planned: PlannedSection[] = [];
  let bar = 1;
  for (const section of template.sections) {
    const fn = sectionFunction(section.name);
    if (section.roles) {
      planned.push({ name: section.name, startBar: bar, bars: section.bars, energy: section.energy, roles: keep(section.roles) });
    } else if (fn === 'other') {
      planned.push({ name: section.name, startBar: bar, bars: section.bars, energy: section.energy, roles: keep(partsForEnergy(section.energy)) });
    } else if (section.bars >= 16 && section.bars % 16 === 0) {
      const half = section.bars / 2;
      const [first, second] = LAYERS[fn];
      planned.push({ name: section.name, startBar: bar, bars: half, energy: section.energy, roles: keep(first) });
      planned.push({ name: `${section.name} b`, startBar: bar + half, bars: half, energy: section.energy, roles: keep(second) });
    } else {
      planned.push({ name: section.name, startBar: bar, bars: section.bars, energy: section.energy, roles: keep(LAYERS[fn][1]) });
    }
    bar += section.bars;
  }
  return planned;
}

export interface ArrangementFinding {
  severity: 'info' | 'warn' | 'review';
  bar: number;
  message: string;
}

/** Apply the arrangement rules to a plan. */
export function checkArrangement(sections: PlannedSection[]): ArrangementFinding[] {
  const rules = loadStyles().arrangement_rules;
  const findings: ArrangementFinding[] = [];
  if (sections.length === 0) return [{ severity: 'review', bar: 1, message: 'The arrangement is empty.' }];

  for (const section of sections) {
    if ((section.startBar - 1) % 8 !== 0) {
      findings.push({
        severity: 'warn',
        bar: section.startBar,
        message: `'${section.name}' starts on bar ${section.startBar}, off the 8-bar grid DJs phrase against.`,
      });
    }
    if (section.bars > rules.max_static_bars && section.bars % rules.change_every_bars === 0) {
      findings.push({
        severity: 'info',
        bar: section.startBar,
        message:
          `'${section.name}' runs ${section.bars} bars. Plan an evolution every ${rules.change_every_bars} bars ` +
          '(filter, density, a subtraction) so it does not plateau.',
      });
    }
  }

  // Consecutive sections that change nothing are one long static block.
  let staticRun = sections[0]!.bars;
  for (let i = 1; i < sections.length; i += 1) {
    const a = sections[i - 1]!;
    const b = sections[i]!;
    const same = a.energy === b.energy && a.roles.join() === b.roles.join();
    staticRun = same ? staticRun + b.bars : b.bars;
    if (same && staticRun > rules.max_static_bars) {
      findings.push({
        severity: 'warn',
        bar: b.startBar,
        message: `No change in roles or energy for ${staticRun} bars by '${b.name}'. Create evolution.`,
      });
    }
    const added = b.roles.filter((r) => !a.roles.includes(r)).length;
    const removed = a.roles.filter((r) => !b.roles.includes(r)).length;
    if (added + removed >= 4 && Math.abs(b.energy - a.energy) < 0.2) {
      findings.push({
        severity: 'info',
        bar: b.startBar,
        message: `'${b.name}' swaps ${added + removed} parts at similar energy; check it is not changing too much at once.`,
      });
    }
  }

  // DJs mix in and out over the beat; a kickless intro or outro gives them nothing.
  const hasKick = sections.some((s) => s.roles.includes('kick'));
  for (const s of sections) {
    const fn = sectionFunction(s.name);
    if (hasKick && (fn === 'intro' || fn === 'outro') && !s.roles.includes('kick')) {
      findings.push({
        severity: 'review',
        bar: s.startBar,
        message: `'${s.name}' has no kick. A DJ ${fn} needs the beat to mix against.`,
      });
    }
  }

  // MELODIC-TECHNO.md: the breakdown and the drop must differ in more than the kick.
  sections.forEach((s, i) => {
    if (sectionFunction(s.name) !== 'break' || s.roles.includes('kick')) return;
    const drop = sections.slice(i + 1).find((n) => sectionFunction(n.name) === 'peak');
    if (!drop) return;
    const added = drop.roles.filter((r) => !s.roles.includes(r) && r !== 'kick');
    const removed = s.roles.filter((r) => !drop.roles.includes(r));
    if (!added.length && !removed.length) {
      findings.push({ severity: 'review', bar: s.startBar, message: `'${s.name}' differs from '${drop.name}' only by the kick; change harmony, motif exposure, space or density too.` });
    }
  });

  // Reserve something for the final peak: more energy or a part held back until then.
  const peakSections = sections.filter((s) => sectionFunction(s.name) === 'peak');
  if (peakSections.length >= 2) {
    const last = peakSections.at(-1)!;
    const earlier = peakSections.slice(0, -1);
    const heard = new Set(earlier.flatMap((s) => s.roles));
    if (last.energy <= Math.max(...earlier.map((s) => s.energy)) && last.roles.every((r) => heard.has(r))) {
      findings.push({ severity: 'info', bar: last.startBar, message: `'${last.name}' brings nothing new; reserve a part, octave, brightness or ride for the final peak.` });
    }
  }

  const peak = Math.max(...sections.map((s) => s.energy));
  const first = sections[0]!;
  const last = sections.at(-1)!;
  if (first.energy >= peak || last.energy >= peak) {
    findings.push({
      severity: 'review',
      bar: first.energy >= peak ? first.startBar : last.startBar,
      message: 'The intro or outro is as full as the peak. Reserve the fullest state for the real peaks; DJs need room to mix.',
    });
  }
  const peaks = sections.filter((s) => s.energy === peak);
  if (peaks.length === 1 && sections.indexOf(peaks[0]!) < sections.length / 2) {
    findings.push({
      severity: 'info',
      bar: peaks[0]!.startBar,
      message: 'The only peak comes in the first half; a later, bigger second peak usually lands harder.',
    });
  }
  return findings;
}

export interface RoleSource {
  track_id: number;
  /** Session slot holding the loop to repeat for this role. */
  clip_slot: number;
  /** Loop length in beats. */
  length_beats: number;
}

/**
 * Commands that lay each role's Session loop across every section it plays
 * in. The loop repeats to fill the section; a loop that does not divide the
 * section evenly is trimmed by the next section's start in Live.
 */
export function arrangementCommands(
  sections: PlannedSection[],
  sources: Record<string, RoleSource>,
  beatsPerBar = 4,
): Array<{ command: string; args: Record<string, unknown> }> {
  const commands: Array<{ command: string; args: Record<string, unknown> }> = [];
  for (const section of sections) {
    const start = (section.startBar - 1) * beatsPerBar;
    const end = start + section.bars * beatsPerBar;
    for (const role of section.roles) {
      const source = sources[role];
      if (!source || source.length_beats <= 0) continue;
      for (let beat = start; beat < end - 1e-9; beat += source.length_beats) {
        commands.push({
          command: 'live.place_clip_in_arrangement',
          args: { track_id: source.track_id, clip_slot: source.clip_slot, beat },
        });
      }
    }
  }
  return commands;
}

export function formatPlan(sections: PlannedSection[], findings: ArrangementFinding[] = []): string {
  const lines = ['  bars       section        energy  roles'];
  for (const s of sections) {
    const range = `${s.startBar}-${s.startBar + s.bars - 1}`.padEnd(10);
    const bar = '#'.repeat(Math.round(s.energy * 10)).padEnd(10);
    lines.push(`  ${range} ${s.name.padEnd(14)} ${bar} ${s.roles.join(', ') || '(none)'}`);
  }
  const total = sections.reduce((n, s) => n + s.bars, 0);
  lines.push(`  ${total} bars total`);
  if (findings.length) {
    lines.push('', 'Checks:');
    for (const f of findings) lines.push(`  [${f.severity.toUpperCase()}] bar ${f.bar}: ${f.message}`);
  }
  return lines.join('\n');
}
