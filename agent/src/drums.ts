/**
 * Drum-machine programming (DRUMS.md): 808/909 grids, velocity by role,
 * accent kept apart from velocity, A/A'/B/F variation that preserves
 * anchors, fills that resolve, swing as a pair ratio, deliberate feel,
 * flams, ratchets, remapping to a kit's real pads, and the hard checks
 * DRUMS.md asks an agent to run before delivering a pattern.
 *
 * Grids are read from agent/knowledge/drum-patterns.json. Rows are either
 * one character per step ("X...x...") or space-separated tokens, where a
 * token may be an exact velocity ("120 .. .. 82"). Everything is seeded,
 * so the same request gives the same pattern.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clampVelocity, makeRandom, round6 } from './music-theory.js';
import type { Pattern, PatternEvent } from './patterns.js';

export type Voice = 'BD' | 'RS' | 'SD' | 'CP' | 'CH' | 'LT' | 'OH' | 'MT' | 'CY' | 'HT' | 'RD' | 'CB';
export type Energy = 'low' | 'medium' | 'high' | 'peak' | 'break';
export type Variant = 'A' | "A'" | 'B' | 'F';
export type Feel = 'straight' | 'laid_back';
/** One bar: a row of step tokens per voice. */
export type Grid = Partial<Record<Voice, string[]>>;

type FillKind = 'tom_run' | 'snare_run' | 'pickup' | 'rolls' | 'percussion_exchange';

interface Template {
  source?: string;
  machine: '808' | '909';
  tempo: [number, number];
  swing_percent: [number, number] | null;
  backbeat: Voice;
  four_on_floor: boolean;
  half_time?: boolean;
  steps: number;
  meter: string;
  fill: FillKind;
  ghost_kick_offset_ms?: [number, number];
  bars: Array<Partial<Record<Voice, string>>>;
}

interface DrumKnowledge {
  note_map: Record<Voice, number>;
  kit_pad_names: Record<Voice, string>;
  roles: Record<Voice, 'structural' | 'pulse' | 'detail'>;
  velocity: Record<string, [number, number]>;
  probability: { pulse: [number, number]; detail: [number, number]; ghost: [number, number]; fill: [number, number] };
  feel: Record<Feel, Partial<Record<Voice, number>>>;
  flam_ms: number;
  templates: Record<string, Template>;
  energy_layers: Record<Energy, Voice[]>;
  phrase: Variant[];
  variation_share: Record<"A'" | 'B', [number, number]>;
  checks: { ghost_hierarchy_min: number; anchor_retention_min: number };
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

/** Beats in one bar of the template's metre (a beat is a quarter note). */
export function barBeats(t: Template): number {
  const [num, den] = t.meter.split('/').map(Number) as [number, number];
  return (num * 4) / den;
}

const REST = new Set(['.', '..']);
const isRest = (token: string | undefined) => token === undefined || REST.has(token);

export function parseRow(row: string, steps: number): string[] {
  const tokens = row.includes(' ') ? row.trim().split(/\s+/) : [...row];
  if (tokens.length !== steps) throw new RangeError(`Row '${row}' has ${tokens.length} steps; expected ${steps}.`);
  return tokens.map((t) => (REST.has(t) ? '.' : t));
}

export function templateGrid(genre: string, bar = 0): Grid {
  const t = drumTemplate(genre);
  const raw = t.bars[bar % t.bars.length]!;
  const grid: Grid = {};
  for (const [voice, row] of Object.entries(raw) as Array<[Voice, string]>) grid[voice] = parseRow(row, t.steps);
  return grid;
}

function rows(grid: Grid): Array<[Voice, string[]]> {
  return Object.entries(grid) as Array<[Voice, string[]]>;
}

function withStep(grid: Grid, voice: Voice, step: number, token: string, steps: number): Grid {
  const row = [...(grid[voice] ?? Array<string>(steps).fill('.'))];
  row[step] = token;
  return { ...grid, [voice]: row };
}

type Strength = 'accent' | 'normal' | 'ghost' | 'open' | 'ratchet' | 'flam' | number;

/** What a token stands for: exact numbers win, letters map to roles. */
function strength(token: string): Strength {
  if (/^\d+$/.test(token)) return Number(token);
  const letters: Record<string, Strength> = { X: 'accent', x: 'normal', g: 'ghost', o: 'open', R: 'ratchet', F: 'flam' };
  return letters[token] ?? 'normal';
}

function velocityRange(voice: Voice, token: string): [number, number] {
  const v = drumKnowledge().velocity;
  const s = strength(token);
  if (typeof s === 'number') return [s, s];
  if (s === 'ratchet') return v.ratchet!;
  if (voice === 'BD') return s === 'ghost' ? v.kick_secondary! : v.kick_primary!;
  if (voice === 'SD' || voice === 'CP') {
    if (s === 'ghost') return v.snare_ghost!;
    return voice === 'CP' ? v.clap_primary! : v.snare_primary!;
  }
  if (voice === 'OH') return v.open_hat!;
  if (voice === 'CH' || voice === 'RD') return s === 'accent' ? v.hat_accent! : s === 'ghost' ? v.hat_ghost! : v.hat_body!;
  return s === 'accent' ? v.percussion_accent! : s === 'ghost' ? v.percussion_ghost! : v.percussion!;
}

/** Anchors: the kick on the beat (or a primary kick off it) and the strong backbeat strikes. */
export function isAnchor(genre: string, voice: Voice, step: number, token: string | undefined): boolean {
  if (isRest(token)) return false;
  const t = drumTemplate(genre);
  const s = strength(token!);
  const strong = s === 'accent' || s === 'normal' || s === 'flam' || (typeof s === 'number' && s >= 100);
  if (!strong) return false;
  if (voice === 'BD') {
    return t.four_on_floor ? step % Math.round(t.steps / 4) === 0 : s === 'accent' || (typeof s === 'number' && s >= 110);
  }
  return voice === t.backbeat || voice === (t.backbeat === 'SD' ? 'CP' : 'SD');
}

// ---------------------------------------------------------------------------
// Variation and fills
// ---------------------------------------------------------------------------

export interface VariationMetrics {
  /** Changed non-anchor positions / non-anchor events in the base. */
  changeRate: number;
  /** Anchors kept unchanged / anchors in the base. */
  anchorRetention: number;
}

export function variationMetrics(genre: string, base: Grid, varied: Grid): VariationMetrics {
  const steps = drumTemplate(genre).steps;
  let anchors = 0, kept = 0, nonAnchor = 0, changed = 0;
  const voices = new Set([...Object.keys(base), ...Object.keys(varied)]) as Set<Voice>;
  for (const voice of voices) {
    for (let i = 0; i < steps; i += 1) {
      const a = base[voice]?.[i] ?? '.';
      const b = varied[voice]?.[i] ?? '.';
      if (isAnchor(genre, voice, i, a)) {
        anchors += 1;
        if (a === b) kept += 1;
      } else {
        if (!isRest(a)) nonAnchor += 1;
        if (a !== b) changed += 1;
      }
    }
  }
  return { changeRate: nonAnchor ? changed / nonAnchor : 0, anchorRetention: anchors ? kept / anchors : 1 };
}

/**
 * A' (10-15% of non-anchor events) or B (15-25%). Only hats, ghosts and
 * percussion move; anchors never do.
 */
export function varyGrid(genre: string, grid: Grid, variant: "A'" | 'B', seed = 1): Grid {
  const steps = drumTemplate(genre).steps;
  const random = makeRandom(seed);
  let out: Grid = { ...grid };
  const movable = rows(grid).flatMap(([voice, row]) =>
    row.map((token, step) => ({ voice, step, token })).filter((e) => !isRest(e.token) && !isAnchor(genre, e.voice, e.step, e.token)),
  );
  const [lo, hi] = drumKnowledge().variation_share[variant];
  const changes = Math.max(1, Math.round(movable.length * (lo + random() * (hi - lo))));
  const ghostVoices: Voice[] = variant === 'B' ? ['CH', 'BD', grid.SD ? 'SD' : 'CP'] : ['CH'];
  const beatSteps = Math.max(1, Math.round(steps / 4));

  for (let done = 0, guard = 0; done < changes && guard < 400; guard += 1) {
    const kind = random();
    if (kind < 0.4 && movable.length) {
      const pick = movable.splice(Math.floor(random() * movable.length), 1)[0]!;
      out = withStep(out, pick.voice, pick.step, '.', steps);
      done += 1;
    } else if (kind < 0.75) {
      const voice = ghostVoices[Math.floor(random() * ghostVoices.length)]!;
      const step = Math.floor(random() * steps);
      if (!isRest(out[voice]?.[step])) continue;
      if (voice === 'CH' && !isRest(out.OH?.[step])) continue;
      if (voice === 'BD' && (step % beatSteps === 0 || !isRest(out.BD?.[step - 1]))) continue;
      out = withStep(out, voice, step, 'g', steps);
      done += 1;
    } else if (out.OH?.some((s) => !isRest(s))) {
      const opens = out.OH.map((s, n) => (!isRest(s) ? n : -1)).filter((n) => n >= 0);
      const from = opens[Math.floor(random() * opens.length)]!;
      const to = (from + (random() < 0.5 ? 1 : -1) + steps) % steps;
      if (!isRest(out.OH[to])) continue;
      const token = out.OH[from]!;
      out = withStep(withStep(out, 'OH', from, '.', steps), 'OH', to, token, steps);
      if (out.CH) out = withStep(out, 'CH', to, '.', steps);
      done += 1;
    }
  }
  return out;
}

/** A phrase-ending fill over the last quarter of the bar; the next downbeat restores the groove. */
export function fillGrid(genre: string, grid: Grid): Grid {
  const t = drumTemplate(genre);
  const n = t.steps;
  const q = Math.max(2, Math.round(n / 4));
  const last = Array.from({ length: q }, (_, i) => n - q + i);
  let out: Grid = { ...grid };
  const clear = (voices: Voice[], steps: number[]) => {
    for (const v of voices) for (const s of steps) if (out[v]) out = withStep(out, v, s, '.', n);
  };
  switch (t.fill) {
    case 'tom_run': {
      // DRUMS.md: low, mid and high tom rising into a kick on the last step.
      clear(['OH', 'CH'], last);
      const toms: Voice[] = ['LT', 'MT', 'HT'];
      const velocities = ['78', '94', '112'];
      last.slice(1).forEach((s, i) => {
        out = withStep(out, toms[Math.min(i, 2)]!, s, velocities[Math.min(i, 2)]!, n);
      });
      out = withStep(out, 'BD', n - 1, '105', n);
      break;
    }
    case 'snare_run':
      last.slice(-3).forEach((s, i) => (out = withStep(out, 'SD', s, ['g', 'x', 'X'][i]!, n)));
      break;
    case 'pickup':
      clear(['CH'], [n - 2]);
      out = withStep(withStep(out, 'OH', n - 2, 'o', n), 'BD', n - 1, 'g', n);
      break;
    case 'rolls':
      for (const s of last) out = withStep(out, 'CH', s, 'R', n);
      break;
    case 'percussion_exchange': {
      clear(['CH', 'OH'], last);
      const voices: Voice[] = ['LT', 'MT', 'HT', 'CB'];
      last.forEach((s, i) => (out = withStep(out, voices[i % 4]!, s, i === last.length - 1 ? 'X' : 'x', n)));
      break;
    }
  }
  return out;
}

/** A fill resolves when the bar after it opens with the kick. */
export function fillResolves(grids: Grid[], fillBar: number): boolean {
  const next = grids[(fillBar + 1) % grids.length]!;
  return !isRest(next.BD?.[0]);
}

// ---------------------------------------------------------------------------
// Grid to notes
// ---------------------------------------------------------------------------

export interface DrumOptions {
  bars?: number;
  seed?: number;
  energy?: Energy;
  /** Pair ratio: 50 is straight, 66.7 a triplet feel. Hats and percussion only. */
  swingPercent?: number;
  /** Deliberate, documented offsets (laid_back: clap +3 ms, open hat +4 ms). */
  feel?: Feel;
  /** Small role-based timing drift; main kicks stay on the grid. */
  humanize?: boolean;
  /** Note chance on ghosts and percussion only (Live 11+). */
  chance?: boolean;
  bpm?: number;
  variant?: Variant;
  /** A 16-bar A/A'/B/F phrase ending in the fill. */
  phrase?: boolean;
}

function filterEnergy(grid: Grid, genre: string, energy: Energy | undefined): Grid {
  if (!energy) return grid;
  const t = drumTemplate(genre);
  const keep = new Set(drumKnowledge().energy_layers[energy]);
  const out: Grid = {};
  for (const [voice, row] of rows(grid)) if (keep.has(voice)) out[voice] = row;
  // High energy on a 909 16-step groove: a ride on the offbeat 8ths, not a new kick rhythm.
  if ((energy === 'high' || energy === 'peak') && t.machine === '909' && t.steps === 16 && !out.RD) {
    out.RD = parseRow('..x...x...x...x.', 16);
  }
  return out;
}

export function drumGrids(genre: string, options: DrumOptions = {}): Grid[] {
  const t = drumTemplate(genre);
  const seed = options.seed ?? 1;
  const count = options.phrase ? 16 : (options.bars ?? t.bars.length);
  const variants: Variant[] = options.phrase ? drumKnowledge().phrase : Array.from({ length: count }, () => options.variant ?? 'A');
  const grids: Grid[] = [];
  for (let bar = 0; bar < count; bar += 1) {
    const base = templateGrid(genre, bar);
    const v = variants[bar % variants.length]!;
    const grid = v === 'A' ? base : v === 'F' ? fillGrid(genre, base) : varyGrid(genre, base, v, seed * 101 + bar);
    grids.push(filterEnergy(grid, genre, options.energy));
  }
  return grids;
}

export function drumPattern(genre: string, options: DrumOptions = {}): Pattern {
  return gridsToPattern(genre, drumGrids(genre, options), options);
}

/** Notes from explicit grids on a genre's step grid and metre (for custom or edited grids). */
export function gridsToPattern(genre: string, grids: Grid[], options: DrumOptions = {}): Pattern {
  const t = drumTemplate(genre);
  const k = drumKnowledge();
  const random = makeRandom(options.seed ?? 1);
  const bpm = options.bpm ?? (t.tempo[0] + t.tempo[1]) / 2;
  const msToBeats = (ms: number) => (ms / 1000) * (bpm / 60);
  const beatsPerBar = barBeats(t);
  const step = beatsPerBar / t.steps;
  // Swing delays the second step of each pair; a triplet grid already has that shape.
  const ratio = options.swingPercent ? Math.min(75, Math.max(50, options.swingPercent)) : 50;
  const swing = t.steps % 3 === 0 ? 0 : (2 * step * ratio) / 100 - step;
  const feel = k.feel[options.feel ?? 'straight'] ?? {};
  const events: PatternEvent[] = [];
  const chance = (range: [number, number]) => Math.round(range[0] + random() * (range[1] - range[0])) / 100;

  grids.forEach((grid, bar) => {
    for (const [voice, row] of rows(grid)) {
      const pitch = k.note_map[voice];
      const role = k.roles[voice];
      row.forEach((token, i) => {
        if (isRest(token)) return;
        // Open and closed hat share one voice on a 909: on the same step the open hat wins.
        if (voice === 'CH' && !isRest(grid.OH?.[i])) return;
        const s = strength(token);
        const [vlo, vhi] = velocityRange(voice, token);
        let beat = bar * beatsPerBar + i * step;
        if (swing && i % 2 === 1 && role !== 'structural') beat += swing;
        if (feel[voice]) beat += msToBeats(feel[voice]!);
        if (s === 'ghost' && voice === 'BD' && t.ghost_kick_offset_ms) {
          const [a, b] = t.ghost_kick_offset_ms;
          beat += msToBeats(a + random() * (b - a));
        }
        if (options.humanize && s !== 'ratchet') {
          const spreadMs = role === 'structural' ? (voice === 'BD' ? 0 : 1) : s === 'ghost' ? 6 : role === 'pulse' ? 3 : 5;
          beat += msToBeats((random() * 2 - 1) * spreadMs);
        }
        if (s === 'ratchet') {
          for (let r = 0; r < 2; r += 1) {
            events.push({ beat: round6(beat + (r * step) / 2), pitch, duration: round6(step / 4), velocity: clampVelocity(vlo + r * (vhi - vlo)) });
          }
          return;
        }
        const velocity = clampVelocity(vlo === vhi ? vlo : vlo + random() * (vhi - vlo));
        const accent = s === 'accent' || (typeof s === 'number' && s >= 115);
        const probability = !options.chance ? undefined : s === 'ghost' ? chance(k.probability.ghost) : role === 'detail' ? chance(k.probability.detail) : undefined;
        events.push({
          beat: round6(Math.max(0, beat)),
          pitch,
          duration: round6(voice === 'OH' || voice === 'CY' || voice === 'RD' ? step * 2 : step / 2),
          velocity,
          ...(accent ? { accent: true } : {}),
          ...(probability !== undefined ? { probability } : {}),
        });
        if (s === 'flam') {
          // The main strike stays on the step; the second follows it.
          events.push({ beat: round6(beat + msToBeats(k.flam_ms)), pitch, duration: round6(step / 2), velocity: clampVelocity(velocity * 0.8) });
        }
      });
    }
  });

  // Choke: an open hat stops where the next closed hat starts.
  const closed = events.filter((e) => e.pitch === k.note_map.CH).map((e) => e.beat).sort((a, b) => a - b);
  for (const e of events) {
    if (e.pitch !== k.note_map.OH) continue;
    const next = closed.find((b) => b > e.beat + 1e-6);
    if (next !== undefined) e.duration = round6(Math.min(e.duration, next - e.beat));
  }
  return { length_beats: grids.length * beatsPerBar, events };
}

// ---------------------------------------------------------------------------
// Kits: play the pattern on the pads a kit really has
// ---------------------------------------------------------------------------

export interface KitMap {
  notes: Partial<Record<Voice, number>>;
  missing: Voice[];
}

/**
 * Map each voice to a pad by name. DRUMS.md's numbers are canonical, but
 * kits differ: Ableton's 909 Core Kit has a ride where the canonical map
 * puts the high tom, so read the pads and remap rather than assume.
 */
export function kitMapFromPads(pads: Array<{ note: number; name: string }>): KitMap {
  const k = drumKnowledge();
  const notes: Partial<Record<Voice, number>> = {};
  const missing: Voice[] = [];
  for (const voice of Object.keys(k.note_map) as Voice[]) {
    const pattern = new RegExp(k.kit_pad_names[voice], 'i');
    const named = pads.filter((p) => pattern.test(p.name));
    // Prefer the canonical note when several pads match (two snares, two crashes).
    const pick = named.find((p) => p.note === k.note_map[voice]) ?? named[0];
    if (pick) notes[voice] = pick.note;
    else missing.push(voice);
  }
  return { notes, missing };
}

/** The DRUMS.md voice a Drum Rack pad is, from its name ("Kick 909" -> BD), or null. */
export function voiceForPadName(name: string): Voice | null {
  const k = drumKnowledge();
  for (const voice of Object.keys(k.kit_pad_names) as Voice[]) {
    if (new RegExp(k.kit_pad_names[voice], 'i').test(name)) return voice;
  }
  return null;
}

export function remapToKit(pattern: Pattern, kit: KitMap): { pattern: Pattern; dropped: Voice[] } {
  const k = drumKnowledge();
  const byNote = new Map((Object.entries(k.note_map) as Array<[Voice, number]>).map(([v, n]) => [n, v]));
  const dropped = new Set<Voice>();
  const events: PatternEvent[] = [];
  for (const e of pattern.events) {
    const voice = byNote.get(e.pitch);
    if (!voice) {
      events.push(e);
      continue;
    }
    const note = kit.notes[voice];
    if (note === undefined) dropped.add(voice);
    else events.push({ ...e, pitch: note });
  }
  return { pattern: { ...pattern, events }, dropped: [...dropped] };
}

// ---------------------------------------------------------------------------
// Polyrhythm and polymeter, described the way DRUMS.md requires
// ---------------------------------------------------------------------------

const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
const lcm = (x: number, y: number) => (x * y) / gcd(x, y);

/** a:b over one shared span: the common grid, each pulse's positions (1-based) and the realignment. */
export function describePolyrhythm(a: number, b: number): { grid: number; pulsesA: number[]; pulsesB: number[]; text: string } {
  const grid = lcm(a, b);
  const pulsesA = Array.from({ length: a }, (_, i) => 1 + (i * grid) / a);
  const pulsesB = Array.from({ length: b }, (_, i) => 1 + (i * grid) / b);
  return {
    grid,
    pulsesA,
    pulsesB,
    text: `${a}:${b} on a ${grid}-unit common grid = ${a}-pulse at [${pulsesA.join(',')}] and ${b}-pulse at [${pulsesB.join(',')}]; they realign every cycle.`,
  };
}

/** A loop of `loopSteps` against a bar of `barSteps`: when the two line up again. */
export function describePolymeter(loopSteps: number, barSteps = 16): { realignSteps: number; realignBars: number; text: string } {
  const realignSteps = lcm(loopSteps, barSteps);
  return {
    realignSteps,
    realignBars: realignSteps / barSteps,
    text: `A ${loopSteps}-step loop against a ${barSteps}-step bar realigns after ${realignSteps} steps (${realignSteps / barSteps} bars, ${realignSteps / loopSteps} loops).`,
  };
}

/** A grid as text, the way DRUMS.md draws it. */
export function formatGrid(grids: Grid[]): string {
  const order: Voice[] = ['BD', 'SD', 'CP', 'RS', 'CH', 'OH', 'RD', 'CB', 'LT', 'MT', 'HT', 'CY'];
  const lines: string[] = [];
  grids.forEach((grid, bar) => {
    const steps = Math.max(...rows(grid).map(([, r]) => r.length));
    const width = rows(grid).some(([, r]) => r.some((t) => t.length > 2)) ? 3 : 2;
    const cell = (s: string) => s.padStart(width);
    if (grids.length > 1) lines.push(`bar ${bar + 1}`);
    lines.push(`step  ${Array.from({ length: steps }, (_, i) => cell(String(i + 1).padStart(2, '0'))).join(' ')}`);
    for (const voice of order) {
      const row = grid[voice];
      if (row) lines.push(`${voice.padEnd(5)} ${row.map((t) => cell(isRest(t) ? '..' : t)).join(' ')}`);
    }
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Checks: DRUMS.md's hard failures and the measurable parts of its rubric
// ---------------------------------------------------------------------------

export interface DrumFinding {
  severity: 'info' | 'warn' | 'review' | 'fail';
  message: string;
}

export function checkDrumPattern(pattern: Pattern, genre: string, bpm = 125): DrumFinding[] {
  const t = drumTemplate(genre);
  const k = drumKnowledge();
  const findings: DrumFinding[] = [];
  const at = (pitch: number) => pattern.events.filter((e) => e.pitch === pitch);
  const beatsPerBar = barBeats(t);
  const bars = Math.max(1, Math.round(pattern.length_beats / beatsPerBar));
  const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  // Hard failures.
  const badVelocity = pattern.events.filter((e) => e.velocity < 1 || e.velocity > 127).length;
  const badNote = pattern.events.filter((e) => e.pitch < 0 || e.pitch > 127).length;
  const outside = pattern.events.filter((e) => e.beat < 0 || e.beat >= pattern.length_beats + 1e-6).length;
  if (badVelocity) findings.push({ severity: 'fail', message: `${badVelocity} events have a velocity outside 1-127.` });
  if (badNote) findings.push({ severity: 'fail', message: `${badNote} events have a MIDI note outside 0-127.` });
  if (outside) findings.push({ severity: 'fail', message: `${outside} events fall outside the declared ${pattern.length_beats}-beat pattern.` });

  const kicks = at(k.note_map.BD);
  if (t.four_on_floor) {
    const missing: number[] = [];
    for (let b = 0; b < bars * beatsPerBar; b += 1) if (!kicks.some((e) => near(e.beat, b))) missing.push(b);
    if (missing.length > 1) findings.push({ severity: 'review', message: `Four-on-the-floor ${genre} is missing the kick on ${missing.length} beats.` });
  }
  if (t.meter === '4/4') {
    const backbeat = [k.note_map[t.backbeat], k.note_map.SD, k.note_map.CP];
    const beats = t.half_time ? [2] : [1, 3];
    let missingBackbeat = 0;
    for (let bar = 0; bar < bars; bar += 1) {
      for (const b of beats) {
        const target = bar * 4 + b;
        // On 8- and 12-step grids the backbeat can land a little after the beat.
        if (!pattern.events.some((e) => backbeat.includes(e.pitch) && e.beat >= target - 0.03 && e.beat < target + 0.5 && e.velocity >= 80)) missingBackbeat += 1;
      }
    }
    if (missingBackbeat) {
      findings.push({ severity: 'review', message: `The ${t.half_time ? 'half-time snare on beat 3' : 'backbeat on 2 and 4'} is missing ${missingBackbeat} times; it orients the listener.` });
    }
  }

  // Choke: open and closed hat starting together smear.
  const ch = at(k.note_map.CH);
  const clashes = at(k.note_map.OH).filter((o) => ch.some((c) => near(c.beat, o.beat, 0.01))).length;
  if (clashes) findings.push({ severity: 'fail', message: `${clashes} open hats start with a closed hat on the same step; the choke is violated.` });

  // A ghost must sit clearly under its primary strikes.
  for (const [voice, ghostMax] of [['SD', 70], ['CP', 70], ['BD', 100]] as Array<[Voice, number]>) {
    const hits = at(k.note_map[voice]);
    const primary = hits.filter((e) => e.velocity > ghostMax).map((e) => e.velocity);
    const ghosts = hits.filter((e) => e.velocity <= ghostMax).map((e) => e.velocity);
    if (primary.length && ghosts.length && median(primary) - median(ghosts) < k.checks.ghost_hierarchy_min) {
      findings.push({ severity: 'fail', message: `${voice} ghosts are within ${k.checks.ghost_hierarchy_min} velocity of the main hits; a ghost must be clearly quieter.` });
    }
  }

  const velocities = pattern.events.map((e) => e.velocity);
  if (velocities.length && Math.max(...velocities) - Math.min(...velocities) < 25) {
    findings.push({ severity: 'warn', message: 'Every hit is within 25 velocity steps; the groove will feel robotic. Differentiate strong, normal and ghost.' });
  }
  if (ch.length >= bars * 8) {
    const spread = Math.max(...ch.map((e) => e.velocity)) - Math.min(...ch.map((e) => e.velocity));
    if (spread < 15) findings.push({ severity: 'info', message: 'Closed hats all hit at one level; alternate their dynamics.' });
  }

  const msPerBeat = 60000 / bpm;
  const grid = beatsPerBar / t.steps;
  const drift = kicks.filter((e) => e.velocity >= 105 && Math.abs(e.beat - Math.round(e.beat / grid) * grid) * msPerBeat > 10).length;
  if (drift) findings.push({ severity: 'warn', message: `${drift} main kicks sit more than 10 ms off the grid; move hats and ghosts, not the anchor.` });

  const uncertain = pattern.events.filter((e) => e.probability !== undefined && e.probability < 1 && e.velocity >= 105).length;
  if (uncertain) findings.push({ severity: 'review', message: `${uncertain} strong hits have a trigger chance below 100%; keep the core groove deterministic.` });

  return findings;
}
