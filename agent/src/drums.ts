/**
 * Drum-machine programming (DRUMS.md): 808/909 genre grids, velocity tiers,
 * A/A'/B/F variation, genre fills, role-based swing and humanisation, and a
 * checker for the parts of the validation list that can be measured.
 *
 * Patterns are built on a 16-step grid per bar from the templates in
 * agent/knowledge/drum-patterns.json. Everything is seeded: the same request
 * gives the same pattern, so undo-and-retry converges.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clampVelocity, makeRandom, round6 } from './music-theory.js';
import type { Pattern, PatternEvent } from './patterns.js';

export type Voice = 'BD' | 'RS' | 'SD' | 'CP' | 'CH' | 'LT' | 'OH' | 'MT' | 'CY' | 'HT' | 'RD' | 'CB';
export type Energy = 'low' | 'medium' | 'high' | 'peak' | 'break';
export type Variant = 'A' | "A'" | 'B' | 'F';
/** One bar: a 16-character row per voice. */
export type Grid = Partial<Record<Voice, string>>;

interface Template {
  machine: '808' | '909';
  tempo: [number, number];
  swing: string;
  backbeat: Voice;
  four_on_floor: boolean;
  half_time?: boolean;
  ghost_kick_offset_ms?: [number, number];
  bars: Grid[];
}

interface DrumKnowledge {
  note_map: Record<Voice, number>;
  roles: Record<Voice, 'structural' | 'pulse' | 'detail'>;
  probability: { pulse: [number, number]; detail: [number, number]; ghost: [number, number]; fill: [number, number] };
  templates: Record<string, Template>;
  energy_layers: Record<Energy, Voice[]>;
  phrase: Variant[];
  variation_share: Record<"A'" | 'B', [number, number]>;
}

const PATH = fileURLToPath(new URL('../knowledge/drum-patterns.json', import.meta.url));
let cached: DrumKnowledge | null = null;

export function drumKnowledge(): DrumKnowledge {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as DrumKnowledge;
  return cached;
}

export function drumGenres(): string[] {
  return Object.keys(drumKnowledge().templates);
}

export function drumTemplate(genre: string): Template {
  const t = drumKnowledge().templates[genre];
  if (!t) throw new RangeError(`Unknown drum genre '${genre}'. Known: ${drumGenres().join(', ')}.`);
  return t;
}

const STEP = 0.25;
const STEPS = 16;
const VELOCITY: Record<string, [number, number]> = {
  X: [110, 124],
  x: [86, 104],
  o: [86, 100],
  g: [42, 70],
  R: [70, 96],
};

function rows(grid: Grid): Array<[Voice, string]> {
  return Object.entries(grid) as Array<[Voice, string]>;
}

function setStep(row: string | undefined, step: number, symbol: string): string {
  const base = row ?? '.'.repeat(STEPS);
  return base.slice(0, step) + symbol + base.slice(step + 1);
}

function isStructural(genre: string, voice: Voice, step: number, symbol: string): boolean {
  const t = drumTemplate(genre);
  if (symbol === 'g') return false;
  if (voice === 'BD') return t.four_on_floor ? step % 4 === 0 : symbol === 'X';
  if (voice === t.backbeat || (voice === 'CP' && t.backbeat === 'SD') || (voice === 'SD' && t.backbeat === 'CP')) {
    return t.half_time ? step === 8 : step === 4 || step === 12;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Variation and fills, on the grid
// ---------------------------------------------------------------------------

/**
 * A' (10-15% of events changed) or B (15-25%): only hats, ghosts and
 * percussion move; the kick and backbeat that carry the genre never do.
 */
export function varyGrid(genre: string, grid: Grid, variant: "A'" | 'B', seed = 1): Grid {
  const random = makeRandom(seed);
  const out: Grid = { ...grid };
  const events = rows(grid).flatMap(([voice, row]) =>
    [...row].map((s, step) => ({ voice, step, s })).filter((e) => e.s !== '.'),
  );
  const [lo, hi] = drumKnowledge().variation_share[variant];
  const changes = Math.max(1, Math.round(events.length * (lo + random() * (hi - lo))));
  const movable = events.filter((e) => !isStructural(genre, e.voice, e.step, e.s));

  for (let i = 0, guard = 0; i < changes && guard < 200; guard += 1) {
    const kind = random();
    if (kind < 0.4 && movable.length) {
      // Drop one ornament.
      const pick = movable.splice(Math.floor(random() * movable.length), 1)[0]!;
      out[pick.voice] = setStep(out[pick.voice], pick.step, '.');
      i += 1;
    } else if (kind < 0.75) {
      // Add a ghost on an empty step: hats or, for a B, a ghost kick or snare.
      const voices: Voice[] = variant === 'B' ? ['CH', 'BD', grid.SD ? 'SD' : 'CP'] : ['CH'];
      const voice = voices[Math.floor(random() * voices.length)]!;
      const step = Math.floor(random() * STEPS);
      if ((out[voice] ?? '.'.repeat(STEPS))[step] !== '.') continue;
      if (voice === 'CH' && out.OH?.[step] && out.OH[step] !== '.') continue;
      if (voice === 'BD' && (step % 4 === 0 || out.BD?.[step - 1] === 'X')) continue;
      out[voice] = setStep(out[voice], step, 'g');
      i += 1;
    } else if (out.OH && out.OH.includes('o')) {
      // Move one open hat a 16th, keeping it clear of the closed hat.
      const steps = [...out.OH].map((s, n) => (s === 'o' ? n : -1)).filter((n) => n >= 0);
      const from = steps[Math.floor(random() * steps.length)]!;
      const to = (from + (random() < 0.5 ? 1 : -1) + STEPS) % STEPS;
      if (out.OH[to] !== '.') continue;
      out.OH = setStep(setStep(out.OH, from, '.'), to, 'o');
      if (out.CH) out.CH = setStep(out.CH, to, '.');
      i += 1;
    }
  }
  return out;
}

/** A phrase-ending fill in the genre's idiom, written over the last beat. */
export function fillGrid(genre: string, grid: Grid): Grid {
  const out: Grid = { ...grid };
  const clear = (voice: Voice, steps: number[]) => {
    for (const s of steps) if (out[voice]) out[voice] = setStep(out[voice], s, '.');
  };
  switch (genre) {
    case 'house':
      // Grace clap at the bar's end; the crash lands on the next downbeat.
      out.CP = setStep(out.CP, 15, 'g');
      break;
    case 'techno':
      // A 16th snare run through the final beat.
      out.SD = setStep(setStep(setStep(out.SD, 13, 'g'), 14, 'x'), 15, 'X');
      break;
    case 'hiphop':
      // Kick pickup and an open hat into the next one.
      clear('CH', [14]);
      out.OH = setStep(out.OH, 14, 'o');
      out.BD = setStep(out.BD, 15, 'g');
      break;
    case 'trap':
      // Hat rolls across the last beat.
      for (const s of [12, 13, 14, 15]) out.CH = setStep(out.CH, s, 'R');
      break;
    case 'electro':
      // Tom, tom, tom, cowbell exchange across the last quarter.
      clear('CH', [12, 13, 14, 15]);
      clear('OH', [12, 13, 14, 15]);
      out.LT = setStep(out.LT, 12, 'x');
      out.MT = setStep(out.MT, 13, 'x');
      out.HT = setStep(out.HT, 14, 'x');
      out.CB = setStep(out.CB, 15, 'X');
      break;
    default:
      out.SD = setStep(out.SD, 15, 'x');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid to notes
// ---------------------------------------------------------------------------

export interface DrumOptions {
  bars?: number;
  seed?: number;
  energy?: Energy;
  /** Fraction of a 16th that off-16ths are delayed, on hats and percussion only. 0-0.5. */
  swing?: number;
  /** Role-based microtiming and velocity drift. */
  humanize?: boolean;
  /** Note chance on ornaments only (needs Live 11+). */
  chance?: boolean;
  bpm?: number;
  /** One variant for every bar, or a 16-bar A/A'/B/F phrase. */
  variant?: Variant;
  phrase?: boolean;
}

function filterEnergy(grid: Grid, genre: string, energy: Energy | undefined): Grid {
  if (!energy) return grid;
  const keep = new Set(drumKnowledge().energy_layers[energy]);
  const out: Grid = {};
  for (const [voice, row] of rows(grid)) if (keep.has(voice)) out[voice] = row;
  const t = drumTemplate(genre);
  // High energy on a 909: a ride on the offbeat 8ths, not a new kick rhythm.
  if ((energy === 'high' || energy === 'peak') && t.machine === '909' && !out.RD) out.RD = '..x...x...x...x.';
  return out;
}

/** The bars a request asks for, as grids, before notes. */
export function drumGrids(genre: string, options: DrumOptions = {}): Grid[] {
  const t = drumTemplate(genre);
  const seed = options.seed ?? 1;
  const count = options.phrase ? 16 : (options.bars ?? t.bars.length);
  const variants: Variant[] = options.phrase
    ? drumKnowledge().phrase
    : Array.from({ length: count }, () => options.variant ?? 'A');
  const grids: Grid[] = [];
  for (let bar = 0; bar < count; bar += 1) {
    const base = t.bars[bar % t.bars.length]!;
    const v = variants[bar % variants.length]!;
    let grid: Grid = v === 'A' ? base : v === 'F' ? fillGrid(genre, base) : varyGrid(genre, base, v, seed * 101 + bar);
    // The crash after a house fill lands on the next downbeat (the loop's first bar).
    if (options.phrase && genre === 'house' && bar === 0) grid = { ...grid, CY: 'X...............' };
    grids.push(filterEnergy(grid, genre, options.energy));
  }
  return grids;
}

export function drumPattern(genre: string, options: DrumOptions = {}): Pattern {
  const t = drumTemplate(genre);
  const k = drumKnowledge();
  const random = makeRandom(options.seed ?? 1);
  const bpm = options.bpm ?? (t.tempo[0] + t.tempo[1]) / 2;
  const msToBeats = (ms: number) => (ms / 1000) * (bpm / 60);
  const swing = Math.max(0, Math.min(0.5, options.swing ?? 0));
  const grids = drumGrids(genre, options);
  const events: PatternEvent[] = [];

  grids.forEach((grid, bar) => {
    for (const [voice, row] of rows(grid)) {
      const pitch = k.note_map[voice];
      const role = k.roles[voice];
      for (let step = 0; step < STEPS; step += 1) {
        const s = row[step];
        if (!s || s === '.') continue;
        // Open and closed hat share one voice on a 909: on the same step the open hat wins.
        if (voice === 'CH' && grid.OH?.[step] && grid.OH[step] !== '.') continue;
        const [vlo, vhi] = VELOCITY[s] ?? VELOCITY.x!;
        let beat = bar * 4 + step * STEP;
        // Swing the off-16ths of hats and percussion; never the kick or backbeat.
        if (swing && step % 2 === 1 && role !== 'structural') beat += swing * STEP;
        if (s === 'g' && voice === 'BD' && t.ghost_kick_offset_ms) {
          const [a, b] = t.ghost_kick_offset_ms;
          beat += msToBeats(a + random() * (b - a));
        }
        if (options.humanize && s !== 'R') {
          const spreadMs = role === 'structural' ? (voice === 'BD' ? 0 : 1) : s === 'g' ? 6 : role === 'pulse' ? 3 : 5;
          beat += msToBeats((random() * 2 - 1) * spreadMs);
        }
        const chance = (range: [number, number]) => Math.round(range[0] + random() * (range[1] - range[0]));
        const probability = !options.chance
          ? undefined
          : s === 'g'
            ? chance(k.probability.ghost)
            : role === 'detail'
              ? chance(k.probability.detail)
              : undefined;
        if (s === 'R') {
          // A 32nd roll with a rising velocity contour.
          for (let r = 0; r < 2; r += 1) {
            events.push({ beat: round6(beat + r * STEP / 2), pitch, duration: STEP / 4, velocity: clampVelocity(vlo + r * (vhi - vlo)) });
          }
          continue;
        }
        events.push({
          beat: round6(Math.max(0, beat)),
          pitch,
          duration: voice === 'OH' ? STEP * 2 : voice === 'CY' || voice === 'RD' ? STEP * 2 : STEP / 2,
          velocity: clampVelocity(vlo + random() * (vhi - vlo)),
          ...(probability !== undefined ? { probability: probability / 100 } : {}),
        });
      }
    }
  });

  // Choke: an open hat stops where the next closed hat starts.
  const closed = events.filter((e) => e.pitch === k.note_map.CH).map((e) => e.beat).sort((a, b) => a - b);
  for (const e of events) {
    if (e.pitch !== k.note_map.OH) continue;
    const next = closed.find((b) => b > e.beat + 1e-6);
    if (next !== undefined) e.duration = round6(Math.min(e.duration, next - e.beat));
  }
  return { length_beats: grids.length * 4, events };
}

/** A grid as text, the way DRUMS.md draws it. */
export function formatGrid(grids: Grid[]): string {
  const order: Voice[] = ['BD', 'SD', 'CP', 'RS', 'CH', 'OH', 'RD', 'CB', 'LT', 'MT', 'HT', 'CY'];
  const lines: string[] = [];
  grids.forEach((grid, bar) => {
    if (grids.length > 1) lines.push(`bar ${bar + 1}`);
    lines.push('Step   01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16');
    for (const voice of order) {
      const row = grid[voice];
      if (!row) continue;
      const cells = [...row].map((c) => ` ${c}`);
      lines.push(`${voice.padEnd(6)}${[0, 4, 8, 12].map((i) => cells.slice(i, i + 4).join(' ')).join(' |')}`);
    }
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Checks (DRUMS.md validation checklist, the measurable parts)
// ---------------------------------------------------------------------------

export interface DrumFinding {
  severity: 'info' | 'warn' | 'review';
  message: string;
}

export function checkDrumPattern(pattern: Pattern, genre: string, bpm = 125): DrumFinding[] {
  const t = drumTemplate(genre);
  const k = drumKnowledge();
  const findings: DrumFinding[] = [];
  const at = (pitch: number) => pattern.events.filter((e) => e.pitch === pitch);
  const bars = Math.max(1, Math.round(pattern.length_beats / 4));
  const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;

  const kicks = at(k.note_map.BD);
  if (t.four_on_floor) {
    const missing = [];
    for (let b = 0; b < bars * 4; b += 1) if (!kicks.some((e) => near(e.beat, b))) missing.push(b);
    // One missing downbeat before a section change is a deliberate gap.
    if (missing.length > 1) findings.push({ severity: 'review', message: `Four-on-the-floor ${genre} is missing the kick on ${missing.length} beats.` });
  }
  const backbeatPitches = [k.note_map[t.backbeat], k.note_map.SD, k.note_map.CP];
  const backbeatBeats = t.half_time ? [2] : [1, 3];
  let missingBackbeat = 0;
  for (let bar = 0; bar < bars; bar += 1) {
    for (const b of backbeatBeats) {
      if (!pattern.events.some((e) => backbeatPitches.includes(e.pitch) && near(e.beat, bar * 4 + b) && e.velocity >= 80)) missingBackbeat += 1;
    }
  }
  if (missingBackbeat > 0) {
    findings.push({ severity: 'review', message: `The ${t.half_time ? 'half-time snare on beat 3' : 'backbeat on 2 and 4'} is missing ${missingBackbeat} times; it orients the listener.` });
  }

  // Choke: open and closed hat on the same step smear together.
  const ch = at(k.note_map.CH);
  const clashes = at(k.note_map.OH).filter((o) => ch.some((c) => near(c.beat, o.beat, 0.01))).length;
  if (clashes) findings.push({ severity: 'warn', message: `${clashes} open hats start with a closed hat on the same step; choke them or move one.` });

  // Dynamics: strong, normal and ghost should be audibly different.
  const velocities = pattern.events.map((e) => e.velocity);
  if (velocities.length && Math.max(...velocities) - Math.min(...velocities) < 25) {
    findings.push({ severity: 'warn', message: 'Every hit is within 25 velocity steps; the groove will feel robotic. Differentiate strong, normal and ghost.' });
  }
  if (ch.length >= bars * 8) {
    const spread = Math.max(...ch.map((e) => e.velocity)) - Math.min(...ch.map((e) => e.velocity));
    if (spread < 15) findings.push({ severity: 'info', message: 'Closed hats all hit at one level; alternate their dynamics so they do not sound fake.' });
  }

  // Timing: structural kicks stay on the grid.
  const msPerBeat = 60000 / bpm;
  const drift = kicks.filter((e) => e.velocity >= 100 && Math.abs(e.beat - Math.round(e.beat * 4) / 4) * msPerBeat > 10).length;
  if (drift) findings.push({ severity: 'warn', message: `${drift} main kicks sit more than 10 ms off the grid; humanise hats and ghosts, not the kick.` });

  // Chance belongs on ornaments.
  const uncertain = pattern.events.filter((e) => e.probability !== undefined && e.probability < 1 && e.velocity >= 105).length;
  if (uncertain) findings.push({ severity: 'review', message: `${uncertain} strong hits have a trigger chance below 100%; keep the core groove deterministic.` });

  return findings;
}
