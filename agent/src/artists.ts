/**
 * Artist-inspired production grammars (JON_HOPKINS.md, TINLICKER.md).
 *
 * The documents are mostly judgement; what is computable lives here: each
 * artist's own arrangement tests applied to a plan, the realignment of
 * orbiting loops and modulation cycles, and Tinlicker's bass that arrives on
 * each chord root after a stepwise pickup. Pure functions over numbers.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type ArrangementFinding, type PlannedSection, checkArrangement, loadStyles, sectionFunction } from './arrangement.js';
import type { Pattern, PatternEvent } from './patterns.js';

export type Artist = 'jon_hopkins' | 'tinlicker';

interface ArtistFile {
  artists: Record<Artist, Record<string, any> & { style: string; prompt: string; source: string }>;
}

let cached: ArtistFile | null = null;
const PATH = fileURLToPath(new URL('../knowledge/artists.json', import.meta.url));

export function artistKnowledge(): ArtistFile {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as ArtistFile;
  return cached;
}

export function artistNames(): Artist[] {
  return Object.keys(artistKnowledge().artists) as Artist[];
}

export function artistProfile(name: string): ArtistFile['artists'][Artist] {
  const profile = artistKnowledge().artists[name as Artist];
  if (!profile) throw new RangeError(`Unknown artist '${name}'. Known: ${artistNames().join(', ')}.`);
  return profile;
}

/** The artist whose style template this is, if any. */
export function artistForStyle(style: string): Artist | undefined {
  return artistNames().find((a) => artistKnowledge().artists[a].style === style);
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

export interface Realignment {
  /** Steps until every loop and the bar start together again. */
  realignSteps: number;
  realignBars: number;
  /** Each loop against the bar alone. */
  perLoop: Array<{ steps: number; realignBars: number }>;
  text: string;
}

/**
 * JON_HOPKINS.md "percussion as orbiting systems": loops of different lengths
 * against the main pulse only fully realign after a long period.
 */
export function orbitRealignment(loopSteps: number[], barSteps = 16): Realignment {
  if (!loopSteps.length || loopSteps.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new RangeError('loopSteps must be positive whole step counts.');
  }
  const realignSteps = loopSteps.reduce(lcm, barSteps);
  const perLoop = loopSteps.map((steps) => ({ steps, realignBars: lcm(steps, barSteps) / barSteps }));
  const realignBars = realignSteps / barSteps;
  return {
    realignSteps,
    realignBars,
    perLoop,
    text:
      `Loops of ${loopSteps.join(', ')} steps against a ${barSteps}-step bar realign together after ${realignBars} bars; ` +
      perLoop.map((l) => `${l.steps} with the bar every ${l.realignBars}`).join(', ') + '.',
  };
}

/** Automation cycles of different lengths (JON_HOPKINS.md 12.3): when do they all restart together? */
export function modulationRealignment(cycleBars: Record<string, number>): { realignBars: number; text: string } {
  const values = Object.values(cycleBars);
  if (!values.length || values.some((n) => !Number.isInteger(n) || n < 1)) throw new RangeError('cycle lengths must be whole bars.');
  const realignBars = values.reduce(lcm, 1);
  return {
    realignBars,
    text: `${Object.entries(cycleBars).map(([k, v]) => `${k} ${v}`).join(', ')}-bar cycles restart together only every ${realignBars} bars.`,
  };
}

// ---------------------------------------------------------------------------
// Plan audits: each artist's own tests
// ---------------------------------------------------------------------------

export interface ArtistFinding extends ArrangementFinding {
  artist: Artist;
  test: string;
}

const roleSet = (s: PlannedSection) => new Set(s.roles);

/** TINLICKER.md: the 16-bar test, the breakdown and drop tests, groove-first intro, groove-kept outro. */
function auditTinlicker(sections: PlannedSection[]): ArtistFinding[] {
  const out: ArtistFinding[] = [];
  const add = (severity: ArtistFinding['severity'], bar: number, test: string, message: string) => out.push({ severity, bar, message, artist: 'tinlicker', test });
  // 16-bar test: no stretch longer than 16 bars in which nothing enters, leaves or changes.
  sections.forEach((s, i) => {
    for (let bar = s.startBar + 16; bar < s.startBar + s.bars; bar += 16) {
      add('info', bar, 'sixteen_bar', `'${s.name}' runs past 16 bars at bar ${bar} with no planned change; automate one dimension there (filter, density, octave, wetness).`);
    }
    const prev = sections[i - 1];
    if (prev && prev.energy === s.energy && prev.roles.join() === s.roles.join()) {
      add('review', s.startBar, 'sixteen_bar', `Nothing enters, leaves or changes at bar ${s.startBar} ('${prev.name}' -> '${s.name}').`);
    }
  });
  sections.forEach((s, i) => {
    const fn = sectionFunction(s.name);
    if (fn === 'intro' && i === 0 && !s.roles.includes('kick')) add('review', s.startBar, 'groove_first', `'${s.name}' should start with the groove: kick first, DJ-friendly.`);
    if (fn === 'outro' && i === sections.length - 1) {
      if (!s.roles.includes('kick')) add('review', s.startBar, 'outro', `'${s.name}' should retain the groove while it simplifies.`);
      if (s.roles.includes('lead')) add('info', s.startBar, 'outro', `'${s.name}' still carries the lead; the outro removes the melodic focus.`);
    }
    if (fn !== 'break') return;
    if (s.roles.includes('kick') || s.roles.includes('bass')) add('review', s.startBar, 'breakdown', `'${s.name}' keeps the ${s.roles.includes('kick') ? 'kick' : 'sub'}; the breakdown removes kick and sub so the drop answers it.`);
    const melodic = s.roles.filter((r) => ['chords', 'lead', 'counter', 'vocal'].includes(r));
    if (melodic.length > 3) add('info', s.startBar, 'breakdown', `'${s.name}' leans on ${melodic.length} melodic parts; it should still work with pad, one motif and one texture.`);
    // Drop test: the first payoff after the break.
    const dropIndex = sections.findIndex((n, j) => j > i && sectionFunction(n.name) === 'peak');
    if (dropIndex < 0) return;
    const drop = sections[dropIndex]!;
    const lead = sections[dropIndex - 1]!;
    if (lead.roles.includes('kick')) add('review', drop.startBar, 'drop', `Nothing low is removed before '${drop.name}': '${lead.name}' still has the kick.`);
    if (!drop.roles.includes('kick') || !drop.roles.includes('bass')) add('review', drop.startBar, 'drop', `'${drop.name}' must bring kick and bass back decisively.`);
    const run = sections.slice(dropIndex).filter((n, k, all) => k === 0 || (sectionFunction(n.name) === 'peak' && sectionFunction(all[k - 1]!.name) === 'peak'));
    const later = new Set(run.slice(1).flatMap((n) => n.roles));
    if (run.length > 1 && [...later].every((r) => roleSet(drop).has(r))) {
      add('review', drop.startBar, 'drop', `'${drop.name}' starts with every layer the payoff will have; hold one or two back until bar 5 or 9.`);
    }
  });
  return out;
}

/** JON_HOPKINS.md: negative space, a bass that leaves, comfort before discomfort, internal evolution. */
function auditHopkins(sections: PlannedSection[]): ArtistFinding[] {
  const out: ArtistFinding[] = [];
  const add = (severity: ArtistFinding['severity'], bar: number, test: string, message: string) => out.push({ severity, bar, message, artist: 'jon_hopkins', test });
  const peakEnergy = Math.max(...sections.map((s) => s.energy));
  const firstPeak = sections.findIndex((s) => s.energy >= 0.8 * peakEnergy);

  // "It sounds flat": no silence or negative space after the first pressure.
  if (firstPeak >= 0 && !sections.slice(firstPeak + 1, -1).some((s) => s.energy <= 0.4)) {
    add('info', sections[firstPeak]!.startBar, 'negative_space', 'After the first pressure there is no rupture or negative space before the end; release after pressure needs absence.');
  }
  // "Bass must be a musical event": it may disappear for long periods.
  const firstBass = sections.findIndex((s) => s.roles.includes('bass'));
  if (firstBass >= 0 && sections.slice(firstBass, -1).every((s) => s.roles.includes('bass'))) {
    add('info', sections[firstBass]!.startBar, 'bass_leaves', 'The bass never leaves once it enters; let it disappear for a stretch and return transformed.');
  }
  // Comfort before discomfort: no leap straight from calm into the fullest pressure.
  sections.forEach((s, i) => {
    if (i === 0 || s.energy < 0.8 * peakEnergy) return;
    const prev = sections[i - 1]!;
    if (s.energy - prev.energy > 0.5 && sectionFunction(prev.name) !== 'break') {
      add('info', s.startBar, 'comfort_before_discomfort', `'${s.name}' leaps from ${prev.energy} to ${s.energy}; an extreme section lands harder after stability, not from nothing.`);
    }
  });
  // Long tracks need internal evolution: inspect every 8-32 bars.
  for (const s of sections) {
    if (s.bars > 32) add('info', s.startBar, 'internal_evolution', `'${s.name}' runs ${s.bars} bars; evolve at least one of rhythm, density, spectrum, depth, width, distortion or harmony within every 32.`);
  }
  return out;
}

/** An artist's own tests applied to an arrangement plan. */
export function auditArtistPlan(sections: PlannedSection[], artist: Artist): ArtistFinding[] {
  if (!sections.length) return [];
  return artist === 'tinlicker' ? auditTinlicker(sections) : auditHopkins(sections);
}

/** The generic arrangement rules (DJ rule as the style declares) plus the style's artist tests, if it has an artist. */
export function checkStylePlan(style: string, sections: PlannedSection[]): ArrangementFinding[] {
  const template = loadStyles().styles[style];
  const findings: ArrangementFinding[] = checkArrangement(sections, { djFriendly: template?.dj_friendly });
  const artist = artistForStyle(style);
  return artist ? [...findings, ...auditArtistPlan(sections, artist)] : findings;
}

// ---------------------------------------------------------------------------
// Tinlicker bass motion
// ---------------------------------------------------------------------------

export interface PickupBassOptions {
  /** Pitch classes of the key's scale (default G natural minor). */
  scale?: number[];
  beatsPerChord?: number;
  /** Chords per phrase: the last chord of each phrase jumps an octave on its third offbeat. */
  phrase?: number;
  velocity?: number;
}

/**
 * TINLICKER.md bass motion as harmony: offbeat eighths on each chord root (the
 * kick keeps the beats), and on the last offbeat before a chord change an
 * anticipatory passing note a scale step from the next root, so the bass
 * arrives on it by step. One octave jump at phrase boundaries.
 */
export function pickupBass(roots: number[], options: PickupBassOptions = {}): Pattern {
  if (!roots.length) throw new RangeError('pickupBass needs at least one chord root.');
  const scale = new Set((options.scale ?? [7, 9, 10, 0, 2, 3, 5]).map((p) => ((p % 12) + 12) % 12));
  const beats = options.beatsPerChord ?? 4;
  const phrase = options.phrase ?? 4;
  const velocity = options.velocity ?? 100;
  const inScale = (p: number) => scale.has(((p % 12) + 12) % 12);
  const events: PatternEvent[] = [];
  roots.forEach((root, i) => {
    const next = roots[(i + 1) % roots.length]!;
    const start = i * beats;
    const offbeats = Array.from({ length: beats }, (_, b) => b + 0.5);
    offbeats.forEach((off, k) => {
      const last = k === offbeats.length - 1;
      let pitch = root;
      if (last && next !== root) {
        // Approach the next root by the nearest scale step, from the side the line is moving from;
        // when the roots are a step apart that note is the current root, so come from the other side.
        const from = next > root ? -1 : 1;
        const candidates = [next + from, next + 2 * from, next - from, next - 2 * from];
        pitch = candidates.find((p) => inScale(p) && p !== root) ?? next;
      } else if ((i + 1) % phrase === 0 && k === offbeats.length - 2) {
        pitch = root + 12;
      }
      events.push({ beat: start + off, pitch, duration: 0.4, velocity: last ? velocity - 8 : velocity });
    });
  });
  return { length_beats: roots.length * beats, events };
}
