/**
 * Multi-step workflows shared by the CLI and the MCP server.
 *
 * Each takes a LiveClient (anything that can post a bridge command), so the
 * same code runs over HTTP from the CLI or in-process from the MCP server.
 * Musical decisions come from agent/src; this module only sequences reads,
 * edits and verification.
 */

import { BridgeError } from './errors.js';
import type { Note } from './protocol.js';
import {
  profileForGenre,
  referencesForSet,
  scanLibrary,
  selectReferences,
  type LibraryEntry,
} from '../../qc/src/library.js';
import {
  arrangementCommands,
  planArrangement,
  type ArrangementFinding,
  type PlannedSection,
  type RoleSource,
} from '../../agent/src/arrangement.js';
import { checkStylePlan } from '../../agent/src/artists.js';
import { auditTimeline, formatAuditReport, type AuditOptions, type AuditReport } from '../../agent/src/audit.js';
import { buildTimeline, isPitched, trackRole, type ArrangementClipData, type Timeline, type TimelineOptions, type TrackData } from '../../agent/src/timeline.js';
import { audioClipNotes, type AudioNotesResult } from '../../qc/src/audio-notes.js';
import { inferTrackRole, writePattern } from '../../agent/src/composition.js';
import {
  checkDrumPattern,
  drumGrids,
  drumPattern,
  formatGrid,
  kitMapFromPads,
  remapToKit,
  type DrumFinding,
  type DrumOptions,
} from '../../agent/src/drums.js';
import { rankCandidates, rankSamples, type Candidate, type RankedCandidate, type RankedSample, type SoundBrief } from '../../agent/src/sound-selection.js';
import { scanSamples } from '../../qc/src/samples.js';
import { analyzeFile } from '../../qc/src/analyze.js';
import { analyzeReferences } from '../../qc/src/run.js';
import type { Analysis } from '../../qc/src/types.js';
import { buildReferenceProfile } from '../../agent/src/mastering/reference.js';
import {
  formatBalance,
  MIN_MOVE_DB,
  solveBalance,
  type BalanceOptions,
  type BalanceResult,
  type PartLevels,
} from '../../agent/src/mastering/balance.js';
import { CAPTURE_TRACK_NAME } from './mastering/capture.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applySwing,
  compareMaterial,
  conformToKey,
  humanizeTiming,
  humanizeVelocity,
  increaseDensity,
  makeMoreSyncopated,
  mergePlans,
  planToCommands,
  reduceDensity,
  silenceGap,
  straighten,
  transpose,
  varyEveryNthBar,
  type EditPlan,
} from '../../agent/src/transforms.js';

export interface LiveClient {
  post(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export interface ReferenceRequest {
  files?: string[];
  set?: string;
  dir?: string;
  genre?: string;
  bpm?: number;
  allowLossy?: boolean;
  exclude?: string[];
}

export interface ResolvedReferences {
  files: string[];
  profile: string | null;
  describe: string[];
}

/** Explicit files, a named set, or a folder + genre, into reference files. */
export async function resolveReferenceFiles(
  client: LiveClient | null,
  request: ReferenceRequest,
): Promise<ResolvedReferences> {
  const explicit = request.files ?? [];
  if (!request.set && !request.dir) return { files: explicit, profile: null, describe: [] };

  let bpm = request.bpm;
  if (bpm === undefined && client) {
    try {
      bpm = ((await client.post('live.get_tempo')) as { bpm: number }).bpm;
    } catch {
      // Live not reachable: choose without a tempo preference.
    }
  }

  let picked: LibraryEntry[];
  let profile: string | null;
  let notes: string[];
  let label: string;
  if (request.set) {
    const result = await referencesForSet(request.set, { bpm, exclude: request.exclude });
    picked = result.references;
    profile = result.profile;
    notes = result.notes;
    label = `set '${result.set}'`;
  } else {
    const index = await scanLibrary(request.dir!);
    const result = selectReferences(index, {
      genre: request.genre,
      bpm,
      allowLossy: request.allowLossy,
      exclude: request.exclude,
    });
    picked = result.references;
    profile = profileForGenre(request.genre);
    notes = result.notes;
    label = request.genre ? `'${request.genre}' in ${request.dir}` : request.dir!;
  }
  return {
    files: [...explicit, ...picked.map((e) => e.path)],
    profile,
    describe: [
      `References (${label}${bpm !== undefined ? `, near ${bpm} BPM` : ''}):`,
      ...picked.map((e) => `  ${String(e.bpm ?? '?').padStart(3)} BPM  ${e.artist} - ${e.title}`),
      ...notes.map((n) => `  note: ${n}`),
    ],
  };
}

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

export interface ArrangementBuild {
  plan: PlannedSection[];
  findings: ArrangementFinding[];
  roles: Record<string, number>;
  placed: number;
  dryRun: boolean;
}

export async function buildArrangement(
  client: LiveClient,
  options: { style: string; map?: Record<string, number>; replace?: boolean; dryRun?: boolean },
): Promise<ArrangementBuild> {
  const { tracks } = (await client.post('live.get_tracks')) as {
    tracks: Array<{ track_id: number; name: string }>;
  };
  const candidates = options.map && Object.keys(options.map).length
    ? Object.entries(options.map).map(([role, track_id]) => ({ role, track_id }))
    : tracks.map((t) => ({ role: inferTrackRole(t.name).role, track_id: t.track_id }));

  const sources: Record<string, RoleSource> = {};
  for (const { role, track_id } of candidates) {
    const key = role === 'snare' ? 'clap' : role;
    if (role === 'unknown' || sources[key]) continue;
    try {
      const clip = (await client.post('live.get_clip', { track_id, clip_slot: 0 })) as { length_beats: number };
      sources[key] = { track_id, clip_slot: 0, length_beats: clip.length_beats };
    } catch {
      // No loop in slot 0: this track does not take part.
    }
  }
  if (!Object.keys(sources).length) {
    throw new BridgeError(
      'NO_ROLES',
      'No tracks with a recognisable role (kick, bass, hats, chords, lead...) and a clip in slot 0. Pass a role map.',
    );
  }

  const plan = planArrangement(options.style, { roles: Object.keys(sources) });
  const findings = checkStylePlan(options.style, plan);
  const commands = arrangementCommands(plan, sources);
  const roles = Object.fromEntries(Object.entries(sources).map(([r, s]) => [r, s.track_id]));
  if (options.dryRun) return { plan, findings, roles, placed: 0, dryRun: true };

  const caps = (await client.post('live.get_capabilities')) as { arrangement_placement?: boolean };
  if (!caps.arrangement_placement) {
    throw new BridgeError('UNSUPPORTED', 'This Live version cannot place clips in the Arrangement via the API.');
  }
  for (const trackId of new Set(Object.values(sources).map((s) => s.track_id))) {
    const { clips } = (await client.post('live.get_arrangement_clips', { track_id: trackId })) as { clips: unknown[] };
    if (clips.length && !options.replace) {
      throw new BridgeError(
        'ARRANGEMENT_EXISTS',
        `Track ${trackId} already has ${clips.length} Arrangement clips. Rebuild with replace=true to clear them first.`,
      );
    }
    if (clips.length) await client.post('live.clear_arrangement', { track_id: trackId });
  }
  for (const command of commands) await client.post(command.command, command.args);
  return { plan, findings, roles, placed: commands.length, dryRun: false };
}

// ---------------------------------------------------------------------------
// Note transforms
// ---------------------------------------------------------------------------

export const TRANSFORMS = [
  'syncopate',
  'straighten',
  'thin',
  'densify',
  'humanize',
  'swing',
  'transpose',
  'conform_key',
  'vary',
  'silence_gap',
] as const;

export type TransformName = (typeof TRANSFORMS)[number];

export interface TransformRequest {
  track_id: number;
  clip_slot: number;
  transform: TransformName;
  amount?: number;
  semitones?: number;
  root?: string;
  scale?: string;
  every_bars?: number;
  from_beat?: number;
  to_beat?: number;
  preserve_edges?: boolean;
  seed?: number;
  dry_run?: boolean;
}

export interface TransformResult {
  transform: TransformName;
  summary: string[];
  updates: number;
  additions: number;
  removals: number;
  snapshot_id: string | null;
  verification: ReturnType<typeof compareMaterial> | null;
  dryRun: boolean;
}

/**
 * Edit existing material: read the clip, compute an EditPlan, snapshot,
 * apply as one atomic transaction, read back and compare. The read-modify-
 * verify loop PROJECT.md asks for, in one call.
 */
export async function transformClip(client: LiveClient, request: TransformRequest): Promise<TransformResult> {
  const read = (await client.post('live.get_notes', {
    track_id: request.track_id,
    clip_slot: request.clip_slot,
  })) as { notes: Note[]; length_beats: number };
  const before = read.notes;
  const context = {
    lengthBeats: read.length_beats,
    seed: request.seed ?? 1,
    preserveEdges: request.preserve_edges ?? false,
  };
  const amount = request.amount;

  let plan: EditPlan;
  switch (request.transform) {
    case 'syncopate':
      plan = makeMoreSyncopated(before, { ...context, amount });
      break;
    case 'straighten':
      plan = straighten(before, { ...context, strength: amount });
      break;
    case 'thin':
      plan = reduceDensity(before, { ...context, amount });
      break;
    case 'densify':
      plan = increaseDensity(before, { ...context, amount });
      break;
    case 'humanize':
      plan = mergePlans(
        humanizeVelocity(before, { ...context, spread: amount !== undefined ? amount * 30 : undefined }),
        humanizeTiming(before, context),
      );
      break;
    case 'swing':
      plan = applySwing(before, { ...context, amount });
      break;
    case 'transpose':
      if (request.semitones === undefined) throw new BridgeError('VALIDATION_FAILED', 'transpose needs semitones.');
      plan = transpose(before, request.semitones);
      break;
    case 'conform_key':
      if (!request.root) throw new BridgeError('VALIDATION_FAILED', 'conform_key needs a root, e.g. F.');
      plan = conformToKey(before, request.root, request.scale ?? 'minor');
      break;
    case 'vary':
      plan = varyEveryNthBar(before, { ...context, everyBars: request.every_bars, intensity: amount });
      break;
    case 'silence_gap': {
      const to = request.to_beat ?? read.length_beats;
      plan = silenceGap(before, request.from_beat ?? to - 0.5, to);
      break;
    }
  }

  const counts = { updates: plan.updates.length, additions: plan.additions.length, removals: plan.removals.length };
  if (request.dry_run || counts.updates + counts.additions + counts.removals === 0) {
    return {
      transform: request.transform,
      summary: plan.summary.length ? plan.summary : ['no change was needed'],
      ...counts,
      snapshot_id: null,
      verification: null,
      dryRun: Boolean(request.dry_run),
    };
  }

  const snapshot = (await client.post('live.snapshot_clip', {
    track_id: request.track_id,
    clip_slot: request.clip_slot,
    label: `before ${request.transform}`,
  })) as { snapshot_id: string };
  await client.post('transaction', {
    atomic: true,
    commands: planToCommands(request.track_id, request.clip_slot, plan),
  });
  const after = ((await client.post('live.get_notes', {
    track_id: request.track_id,
    clip_slot: request.clip_slot,
  })) as { notes: Note[] }).notes;

  return {
    transform: request.transform,
    summary: plan.summary,
    ...counts,
    snapshot_id: snapshot.snapshot_id,
    verification: compareMaterial(before, after),
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

export interface DrumWrite {
  genre: string;
  note_count: number;
  snapshot_id: string | null;
  kit: string;
  grid: string;
  findings: DrumFinding[];
}

/**
 * Write a DRUMS.md groove into a clip on the pads the track's kit really
 * has: canonical notes are remapped by pad name (the 909 Core Kit's note 50
 * is a ride, not the canonical high tom), and voices the kit lacks are
 * reported rather than played on the wrong pad.
 */
export async function writeDrums(
  client: LiveClient,
  target: { track_id: number; clip_slot: number },
  genre: string,
  options: DrumOptions = {},
): Promise<DrumWrite> {
  const pattern = drumPattern(genre, options);
  const findings = checkDrumPattern(pattern, genre);
  let kit = 'No Drum Rack on this track: canonical DRUMS.md notes (BD 36, SD 38, CP 39, CH 42, OH 46, LT 43, MT 47, HT 50).';
  let toWrite = pattern;
  try {
    const { devices } = (await client.post('live.get_devices', { track_id: target.track_id })) as {
      devices: Array<{ device_id: number; class_name: string | null }>;
    };
    const rack = devices.find((d) => d.class_name === 'DrumGroupDevice');
    if (rack) {
      const { pads } = (await client.post('live.get_drum_pads', { track_id: target.track_id, device_id: rack.device_id })) as {
        pads: Array<{ note: number; name: string }>;
      };
      const map = kitMapFromPads(pads);
      const remapped = remapToKit(pattern, map);
      toWrite = remapped.pattern;
      kit = `Remapped to the kit's pads ${JSON.stringify(map.notes)}` +
        (remapped.dropped.length ? `; no pad for ${remapped.dropped.join(', ')}, so those hits were left out.` : '.');
    }
  } catch {
    // No device information: keep the canonical notes.
  }
  let snapshot: string | null = null;
  try {
    snapshot = ((await client.post('live.snapshot_clip', { ...target, label: `before drums ${genre}` })) as { snapshot_id: string }).snapshot_id;
  } catch {
    // Empty slot: nothing to keep.
  }
  await client.post('transaction', {
    atomic: true,
    commands: writePattern(toWrite, { ...target, bars: toWrite.length_beats / 4, createClip: true, name: `Drums ${genre}` }),
  });
  const { notes } = (await client.post('live.get_notes', target)) as { notes: unknown[] };
  return {
    genre,
    note_count: notes.length,
    snapshot_id: snapshot,
    kit,
    grid: formatGrid(drumGrids(genre, { ...options, bars: Math.min(options.bars ?? 2, 2), phrase: false })),
    findings,
  };
}

// ---------------------------------------------------------------------------
// Sound selection
// ---------------------------------------------------------------------------

/**
 * Run a sound brief's searches against Live's browser and return a ranked
 * short list to audition in context. Searches that fail (a category this
 * Live does not have) are skipped and reported.
 */
export async function shortlistSounds(
  client: LiveClient,
  brief: SoundBrief,
  limit = 8,
): Promise<{ shortlist: RankedCandidate[]; searched: string[]; skipped: string[] }> {
  const candidates: Candidate[] = [];
  const searched: string[] = [];
  const skipped: string[] = [];
  for (const [category, query] of brief.searches) {
    try {
      const { items } = (await client.post('live.browse', { category, query, limit: 40 })) as {
        items: Array<{ name: string; path: string[]; is_loadable: boolean; is_folder: boolean }>;
      };
      searched.push(`${category}: ${query}`);
      for (const item of items) if (item.is_loadable && !item.is_folder) candidates.push({ name: item.name, category, path: item.path });
    } catch {
      skipped.push(`${category}: ${query}`);
    }
  }
  return { shortlist: rankCandidates(candidates, brief, limit), searched, skipped };
}

export interface SampleLibraryConfig {
  root: string;
  place_name: string;
}

/** config/sample-library.json, if the user has a local sample library. */
export function sampleLibraryConfig(): SampleLibraryConfig | null {
  const path = fileURLToPath(new URL('../../config/sample-library.json', import.meta.url));
  if (!existsSync(path)) return null;
  const config = JSON.parse(readFileSync(path, 'utf8')) as Partial<SampleLibraryConfig>;
  return config.root ? { root: config.root, place_name: config.place_name ?? 'Samples' } : null;
}

/**
 * Browser paths for library files, from the Places Live actually lists: the
 * library root itself, or folders inside it added one by one.
 */
export async function placeResolver(client: LiveClient | null, config: SampleLibraryConfig): Promise<(relative: string) => string[]> {
  let places: string[] = [];
  if (client) {
    try {
      places = ((await client.post('live.browse', { category: 'user_folders' })) as { items: Array<{ name: string }> }).items.map((i) => i.name);
    } catch {
      // Live not reachable: fall back to the configured name.
    }
  }
  return (relative: string) => {
    const parts = relative.split('/');
    if (places.includes(parts[0]!)) return parts;
    if (places.includes(config.place_name)) return [config.place_name, ...parts];
    return [config.place_name, ...parts];
  };
}

export interface SampleContext {
  /** Kick: the bass track whose notes the kick tail must clear. */
  pairTrackId?: number;
  /** The track the sample will play on: its note lengths bound the tail. */
  partTrackId?: number;
}

/** Tail limits from the part: a kick must end before the bass answers; a pulse wants a short sound. */
export async function contextTails(client: LiveClient, role: string, context: SampleContext): Promise<{ maxTailMs?: number; minTailMs?: number; maxAttackMs?: number; notes: string[] }> {
  const notes: string[] = [];
  const { bpm } = (await client.post('live.get_tempo')) as { bpm: number };
  const ms = (beats: number) => (beats * 60000) / bpm;
  const read = async (track_id: number) =>
    ((await client.post('live.get_notes', { track_id, clip_slot: 0 })) as { notes: Array<{ start?: number; start_time?: number; duration: number }> }).notes
      .map((n) => ({ start: n.start ?? n.start_time ?? 0, duration: n.duration }));
  let maxTailMs: number | undefined;
  let minTailMs: number | undefined;
  let maxAttackMs: number | undefined;
  if (context.pairTrackId !== undefined && role === 'kick') {
    const bass = await read(context.pairTrackId);
    // The shortest distance from a beat to the next bass onset.
    const gaps = [0, 1, 2, 3].map((beat) => {
      const next = bass.map((n) => n.start % 4).filter((s) => s > beat + 1e-6).sort((a, b) => a - b)[0];
      return next !== undefined ? next - beat : 1;
    });
    maxTailMs = ms(Math.min(...gaps));
    notes.push(`the bass answers ${Math.round(maxTailMs)} ms after the kick, so the kick tail should end by then`);
  }
  if (context.partTrackId !== undefined) {
    const part = await read(context.partTrackId);
    if (part.length) {
      const sorted = part.map((n) => n.duration).sort((a, b) => a - b);
      const median = ms(sorted[Math.floor(sorted.length / 2)]!);
      maxAttackMs = median * 0.5;
      if (median < 400) {
        maxTailMs = Math.min(maxTailMs ?? Infinity, median * 3);
        notes.push(`the part plays short notes (${Math.round(median)} ms), so a long ringing sound would smear it`);
      } else {
        minTailMs = median * 0.5;
        notes.push(`the part holds notes for ${Math.round(median)} ms, so the sound should sustain`);
      }
    }
  }
  return { maxTailMs, minTailMs, maxAttackMs, notes };
}

/** Measured samples from the local library ranked against a brief (scans once, then cached). */
export async function shortlistLocalSamples(
  brief: SoundBrief,
  options: { root?: string; limit?: number; loops?: boolean; client?: LiveClient; context?: SampleContext } = {},
): Promise<{ library: string; samples: RankedSample[]; context: string[] } | null> {
  const config = sampleLibraryConfig();
  if (!config || !existsSync(config.root)) return null;
  const index = await scanSamples(config.root);
  const tails = options.client && options.context ? await contextTails(options.client, brief.role, options.context) : { notes: [] as string[] };
  const browserPath = await placeResolver(options.client ?? null, config);
  return {
    library: config.root,
    context: tails.notes,
    samples: rankSamples(index.entries, brief, {
      limit: options.limit,
      root: options.root,
      libraryName: config.place_name,
      loops: options.loops,
      maxTailMs: 'maxTailMs' in tails ? tails.maxTailMs : undefined,
      minTailMs: 'minTailMs' in tails ? tails.minTailMs : undefined,
      maxAttackMs: 'maxAttackMs' in tails ? tails.maxAttackMs : undefined,
      browserPath,
    }),
  };
}

// ---------------------------------------------------------------------------
// Track audit (AGENTS.md *Auditing a track*)
// ---------------------------------------------------------------------------

interface LiveTrackSummary {
  track_id: number;
  name: string;
  type: string;
  devices?: Array<{ device_id: number; class_name?: string | null }>;
  clips?: Array<{ name: string; slot: number; is_midi_clip: boolean }>;
}

/**
 * Detect notes in each audio clip, in arrangement beats. Clips that share a
 * file, markers, loop, warp and transposition are analysed once.
 */
async function analyseAudioClips(
  clips: ArrangementClipData[],
  decode: ((path: string) => Promise<Float32Array>) | undefined,
  cache: Map<string, AudioNotesResult>,
): Promise<void> {
  for (const clip of clips) {
    if (clip.is_midi_clip) continue;
    const key = JSON.stringify([
      clip.file_path, clip.end - clip.start, clip.start_marker, clip.loop_start, clip.loop_end, clip.looping,
      clip.warping, clip.pitch_coarse, clip.pitch_fine, clip.warp_markers,
    ]);
    let result = cache.get(key);
    if (!result) {
      // Analyse as if the clip started at beat 0, then place it.
      result = await audioClipNotes({ ...clip, start: 0, end: clip.end - clip.start }, decode);
      cache.set(key, result);
    }
    clip.audioNotes = result.notes.map((n) => ({ ...n, start: n.start + clip.start }));
    clip.audioAnalysis = { analysed: result.analysed, reason: result.reason, voicedShare: result.voicedShare };
  }
}

function isUnknownCommand(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'UNKNOWN_COMMAND' || (error instanceof Error && error.message.includes('UNKNOWN_COMMAND'));
}

async function readTrackBatched(client: LiveClient, trackId: number): Promise<ArrangementClipData[]> {
  const { clips } = (await client.post('live.get_arrangement_notes', { track_id: trackId })) as { clips: ArrangementClipData[] };
  return clips;
}

async function readTrackPerClip(client: LiveClient, trackId: number): Promise<ArrangementClipData[]> {
  const result = (await client.post('live.get_arrangement_clips', { track_id: trackId })) as {
    clips: Array<Omit<ArrangementClipData, 'arrangement_index'>>;
  };
  const clips: ArrangementClipData[] = result.clips.map((c, i) => ({ ...c, arrangement_index: i }));
  for (const clip of clips) {
    if (!clip.is_midi_clip) continue;
    const read = (await client.post('live.get_notes', { track_id: trackId, arrangement_index: clip.arrangement_index })) as {
      notes: Note[];
      start_marker?: number;
      end_marker?: number;
      loop_start?: number;
      loop_end?: number;
      looping?: boolean;
    };
    Object.assign(clip, {
      notes: read.notes,
      start_marker: read.start_marker,
      end_marker: read.end_marker,
      loop_start: read.loop_start,
      loop_end: read.loop_end,
      looping: read.looping,
    });
  }
  return clips;
}

/**
 * Read every track's Arrangement clips and their notes, and the Session clips
 * that share a name with them, into a Timeline. Read-only. A track whose
 * Arrangement cannot be read is skipped and named, not fatal.
 */
export async function gatherTimeline(
  client: LiveClient,
  options: TimelineOptions & {
    /** Analyse the audio clips of pitched tracks for notes (default true). */
    audio?: boolean;
    /** Decoder for audio files; tests replace it. */
    decode?: (path: string) => Promise<Float32Array>;
  } = {},
): Promise<{ timeline: Timeline; tempo: number | null; skipped: string[] }> {
  const { tracks } = (await client.post('live.get_tracks', { include_devices: true, include_clips: true })) as {
    tracks: LiveTrackSummary[];
  };
  const signature = (await client.post('live.get_time_signature')) as { numerator: number; denominator: number };
  const tempo = ((await client.post('live.get_tempo')) as { bpm?: number }).bpm ?? null;

  const data: TrackData[] = [];
  const skipped: string[] = [];
  let firstError: unknown = null;
  const audioCache = new Map<string, AudioNotesResult>();
  // One request per track when the bridge and the Remote Script know
  // live.get_arrangement_notes; one per clip on older ones.
  let batched = true;
  for (const track of tracks) {
    let clips: ArrangementClipData[];
    try {
      clips = batched ? await readTrackBatched(client, track.track_id) : await readTrackPerClip(client, track.track_id);
    } catch (error) {
      if (batched && isUnknownCommand(error)) {
        batched = false;
        try {
          clips = await readTrackPerClip(client, track.track_id);
        } catch (inner) {
          firstError ??= inner;
          skipped.push(`${track.name} (${inner instanceof Error ? inner.message : String(inner)})`);
          continue;
        }
      } else {
        firstError ??= error;
        skipped.push(`${track.name} (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
    }
    // Pitched audio (a vocal, a sampled hook): detect its notes so the audit can see them.
    const role = trackRole(track.name, options.roles);
    if (options.audio !== false && isPitched(track.name, role, [], options.unpitched)) {
      await analyseAudioClips(clips, options.decode, audioCache);
    }
    const names = new Set(clips.map((c) => c.name));
    const session: TrackData['session'] = [];
    for (const s of track.clips ?? []) {
      if (!s.is_midi_clip || !names.has(s.name)) continue;
      const read = (await client.post('live.get_notes', { track_id: track.track_id, clip_slot: s.slot })) as { notes: Note[] };
      session.push({ name: s.name, slot: s.slot, notes: read.notes });
    }
    // A Drum Rack's pad names tell its kick from its hats.
    let pads: TrackData['pads'];
    const rack = (track.devices ?? []).find((d) => d.class_name === 'DrumGroupDevice');
    if (rack) {
      try {
        const read = (await client.post('live.get_drum_pads', { track_id: track.track_id, device_id: rack.device_id })) as {
          pads: Array<{ note: number; name: string }>;
        };
        pads = read.pads;
      } catch {
        pads = undefined;
      }
    }
    data.push({
      track_id: track.track_id,
      name: track.name,
      devices: (track.devices ?? []).map((d) => d.class_name ?? '').filter(Boolean),
      clips,
      session,
      pads,
    });
  }
  if (!data.length && firstError) throw firstError;
  const beatsPerBar = (signature.numerator * 4) / signature.denominator;
  return { timeline: buildTimeline(data, { ...options, beatsPerBar }), tempo, skipped };
}

export interface AuditRequest extends AuditOptions, TimelineOptions {
  /** Analyse pitched audio clips for notes (default true). */
  audio?: boolean;
}

/** Run every measurable step of the track audit on the open Set. Read-only. */
export async function auditTrack(
  client: LiveClient,
  request: AuditRequest = {},
): Promise<{ report: AuditReport; markdown: string; skipped: string[] }> {
  const { timeline, tempo, skipped } = await gatherTimeline(client, { roles: request.roles, unpitched: request.unpitched, audio: request.audio });
  if (!timeline.bars) {
    throw new BridgeError('EMPTY_ARRANGEMENT', 'The Arrangement has no clips to audit. Build or place the Arrangement first.');
  }
  const report = auditTimeline(timeline, { ...request, tempo: tempo ?? undefined });
  let markdown = formatAuditReport(report, timeline);
  if (skipped.length) markdown += `\nTracks not read: ${skipped.join('; ')}.\n`;
  return { report, markdown, skipped };
}

// ---------------------------------------------------------------------------
// Balance: solve fader moves against the references (docs/lessons.md, Black
// Glass 2026-10-08). Measure every part alone, solve, apply, verify.
// ---------------------------------------------------------------------------

/**
 * Master devices that change level non-linearly, bypassed while parts are
 * measured so each part is read as it enters the master. EQ stays on: it is
 * linear, and part of the tone the solve is matching.
 */
const MASTER_DYNAMICS = ['GlueCompressor', 'Compressor2', 'Limiter', 'Saturator', 'MultibandDynamics', 'DrumBuss', 'Overdrive', 'Pedal', 'Roar'];

/** A capture peaking this close to full scale clipped, and reads low. */
const CLIP_DBFS = -0.1;

interface MixerTrack {
  track_id: number;
  name: string;
  type: string;
  muted?: boolean;
  soloed?: boolean;
  is_grouped?: boolean;
  volume?: { display_value?: string | null; automation_state?: string | null };
  devices?: Array<{ device_id: number; class_name: string | null; is_active?: boolean }>;
}

interface TrackList {
  tracks: MixerTrack[];
  master_track: MixerTrack;
}

export type AnalyzeCapture = (path: string) => Promise<Analysis>;

export interface PartsRequest {
  bars: number;
  /** Arrangement position to capture from; or sceneId. */
  startBeat?: number;
  sceneId?: number;
  /** Measure only these tracks (default: every unmuted track). */
  trackIds?: number[];
}

export interface MeasuredPart extends PartLevels {
  trackId: number;
  samplePeakDbfs: number;
  file: string;
}

/** A part's levels from a capture of it alone. The capture is the section, so the whole file is read. */
export function partLevels(track: string, analysis: Analysis): PartLevels {
  const bands = analysis.whole.bands;
  const reference = bands.find((b) => Number.isFinite(b.midDb) && Number.isFinite(b.midRelativeDb));
  return {
    track,
    lufs: analysis.loudness.integratedLufs,
    fullDb: reference ? reference.midDb - reference.midRelativeDb : -Infinity,
    bandDb: Object.fromEntries(bands.map((b) => [b.name, b.midDb])),
  };
}

function captureArgs(request: PartsRequest): Record<string, unknown> {
  if (request.startBeat !== undefined && request.sceneId !== undefined) {
    throw new BridgeError('INVALID_ARGS', 'Give start_beat or scene_id, not both.');
  }
  return {
    bars: request.bars,
    ...(request.startBeat !== undefined ? { start_beat: request.startBeat } : {}),
    ...(request.sceneId !== undefined ? { scene_id: request.sceneId } : {}),
  };
}

/**
 * Run `work` on the mix as it enters the master: the master's dynamics bypassed
 * and any solo the user left on cleared. Restores both, even on failure.
 */
async function withMixPrepared<T>(client: LiveClient, state: TrackList, work: () => Promise<T>): Promise<T> {
  const master = state.master_track;
  const dynamics = (master.devices ?? []).filter((d) => d.class_name && MASTER_DYNAMICS.includes(d.class_name) && d.is_active !== false);
  const soloed = state.tracks.filter((t) => t.soloed);
  try {
    for (const d of dynamics) await client.post('live.set_device_active', { track_id: master.track_id, device_id: d.device_id, enabled: false });
    for (const t of soloed) await client.post('live.set_track_solo', { track_id: t.track_id, enabled: false });
    return await work();
  } finally {
    for (const t of soloed) await client.post('live.set_track_solo', { track_id: t.track_id, enabled: true }).catch(() => undefined);
    for (const d of dynamics) {
      await client.post('live.set_device_active', { track_id: master.track_id, device_id: d.device_id, enabled: true }).catch(() => undefined);
    }
  }
}

/**
 * Capture each part alone over the section, master dynamics bypassed, and read
 * its bands. Restores every solo and device it touched, even on failure. Takes
 * real time: one capture per track.
 */
export async function measureParts(
  client: LiveClient,
  request: PartsRequest,
  analyze: AnalyzeCapture = (path) => analyzeFile(path),
  log: (line: string) => void = () => undefined,
): Promise<{ parts: MeasuredPart[]; left: Array<{ track: string; reason: string }> }> {
  const state = (await client.post('live.get_tracks', { include_devices: true })) as TrackList;
  const tracks = state.tracks;
  const left: Array<{ track: string; reason: string }> = [];
  // A group track is followed by its members, and soloing it plays them all.
  const groupHead = (i: number) => !tracks[i]!.is_grouped && Boolean(tracks[i + 1]?.is_grouped);
  const candidates = tracks.filter((t, i) => {
    if (t.name === CAPTURE_TRACK_NAME || /\bprobe\b/i.test(t.name)) return false;
    if (request.trackIds && !request.trackIds.includes(t.track_id)) return false;
    if (t.muted) {
      left.push({ track: t.name, reason: 'muted, so not in the mix' });
      return false;
    }
    if (groupHead(i)) {
      left.push({ track: t.name, reason: 'group track: its members are measured instead' });
      return false;
    }
    return true;
  });
  if (!candidates.length) throw new BridgeError('NO_TRACKS', 'No unmuted track to measure.');

  const capture = captureArgs(request);
  const parts: MeasuredPart[] = [];
  let current: number | undefined;
  await withMixPrepared(client, state, async () => {
    try {
      for (const t of candidates) {
        if (current !== undefined) await client.post('live.set_track_solo', { track_id: current, enabled: false });
        await client.post('live.set_track_solo', { track_id: t.track_id, enabled: true });
        current = t.track_id;
        log(`Capturing '${t.name}' alone (${request.bars} bars, real time)...`);
        const captured = (await client.post('master.capture', capture)) as { file_path: string };
        const analysis = await analyze(captured.file_path);
        parts.push({ ...partLevels(t.name, analysis), trackId: t.track_id, samplePeakDbfs: analysis.loudness.samplePeakDbfs, file: captured.file_path });
      }
    } finally {
      if (current !== undefined) await client.post('live.set_track_solo', { track_id: current, enabled: false }).catch(() => undefined);
    }
  });
  return { parts, left };
}

/** "-6.0 dB" -> -6; "-inf dB" -> -Infinity; anything else -> null. */
export function parseFaderDb(display: string | null | undefined): number | null {
  if (!display) return null;
  if (/-\s*inf/i.test(display)) return -Infinity;
  const match = /-?\d+(?:\.\d+)?/.exec(display);
  return match ? Number(match[0]) : null;
}

export interface FaderMove {
  trackId: number;
  track: string;
  db: number;
}

export interface AppliedMove extends FaderMove {
  fromDb: number;
  toDb: number;
  /** What the fader displays after the write. */
  achievedDb: number | null;
}

/**
 * Move faders by dB through their own display (faders are not linear in dB).
 * An automated fader is skipped: writing it would override its automation,
 * and Back to Arrangement does not undo that (AGENTS.md, Live facts).
 */
export async function applyFaderMoves(
  client: LiveClient,
  moves: FaderMove[],
  minMoveDb = MIN_MOVE_DB,
): Promise<{ applied: AppliedMove[]; skipped: Array<{ track: string; reason: string }> }> {
  const state = (await client.post('live.get_tracks', { include_devices: false })) as TrackList;
  const applied: AppliedMove[] = [];
  const skipped: Array<{ track: string; reason: string }> = [];
  for (const move of moves) {
    if (Math.abs(move.db) < minMoveDb) continue;
    const track = state.tracks.find((t) => t.track_id === move.trackId);
    if (!track) {
      skipped.push({ track: move.track, reason: 'no longer in the Set' });
      continue;
    }
    const automation = track.volume?.automation_state;
    if (automation === 'playing' || automation === 'overridden') {
      skipped.push({
        track: move.track,
        reason: `its fader is automated, and writing it would override the automation: move a Utility Gain on the track by ${move.db} dB instead`,
      });
      continue;
    }
    const fromDb = parseFaderDb(track.volume?.display_value);
    if (fromDb === null || !Number.isFinite(fromDb)) {
      skipped.push({ track: move.track, reason: `cannot read its fader ('${track.volume?.display_value ?? 'none'}')` });
      continue;
    }
    const toDb = Math.round(Math.min(6, fromDb + move.db) * 10) / 10;
    const result = (await client.post('live.set_device_parameter_display', { track_id: move.trackId, mixer: 'volume', target: toDb })) as {
      achieved?: number | null;
    } | null;
    applied.push({ ...move, fromDb, toDb, achievedDb: typeof result?.achieved === 'number' ? result.achieved : null });
  }
  return { applied, skipped };
}

export interface BalanceRequest extends PartsRequest, BalanceOptions {
  /** Reference files: a balance is never solved without them. */
  references: string[];
  /** Write the moves, then capture the mix and measure what they did. */
  apply?: boolean;
}

export interface BalanceReport {
  result: BalanceResult;
  parts: MeasuredPart[];
  /** Parts whose capture clipped: their levels read low. */
  clipped: string[];
  applied: AppliedMove[];
  skipped: Array<{ track: string; reason: string }>;
  /** The mix captured after applying (master dynamics bypassed): measured tilt per band. */
  verification: { file: string; tilt: Record<string, number>; worstDb: number; clipped: boolean } | null;
  text: string;
}

/** Measure every part, solve the fader moves against the references, and optionally apply and verify them. */
export async function balanceMix(
  client: LiveClient,
  request: BalanceRequest,
  deps: { analyze?: AnalyzeCapture; analyzeReferences?: (paths: string[]) => Promise<Analysis[]>; log?: (line: string) => void } = {},
): Promise<BalanceReport> {
  if (!request.references.length) {
    throw new BridgeError('NO_REFERENCES', 'A balance is solved against club references; give a reference set or files.');
  }
  const analyze = deps.analyze ?? ((path: string) => analyzeFile(path));
  const log = deps.log ?? (() => undefined);
  const referenceTilt = buildReferenceProfile(await (deps.analyzeReferences ?? analyzeReferences)(request.references)).bandTilt;

  const { parts, left } = await measureParts(client, request, analyze, log);
  const result = solveBalance(parts, referenceTilt, request);
  result.left.unshift(...left);
  const clipped = parts.filter((p) => p.samplePeakDbfs >= CLIP_DBFS).map((p) => p.track);

  let applied: AppliedMove[] = [];
  let skipped: Array<{ track: string; reason: string }> = [];
  let verification: BalanceReport['verification'] = null;
  if (request.apply) {
    const byTrack = new Map(parts.map((p) => [p.track, p.trackId]));
    const moves = result.moves.filter((m) => !m.anchor).map((m) => ({ trackId: byTrack.get(m.track)!, track: m.track, db: m.db }));
    ({ applied, skipped } = await applyFaderMoves(client, moves));
    if (applied.length) {
      log('Capturing the mix with the moves applied...');
      const state = (await client.post('live.get_tracks', { include_devices: true })) as TrackList;
      const captured = (await withMixPrepared(client, state, () =>
        client.post('master.capture', captureArgs(request)),
      )) as { file_path: string };
      const analysis = await analyze(captured.file_path);
      const tilt = Object.fromEntries(analysis.whole.bands.map((b) => [b.name, Math.round(b.midRelativeDb * 10) / 10]));
      const gaps = result.bands.map((b) => Math.abs((tilt[b.band] ?? NaN) - b.referenceDb)).filter(Number.isFinite);
      verification = {
        file: captured.file_path,
        tilt,
        worstDb: Math.round(Math.max(...gaps) * 10) / 10,
        clipped: analysis.loudness.samplePeakDbfs >= CLIP_DBFS,
      };
    }
  }

  const lines = [formatBalance(result, { measuredAfter: verification?.tilt })];
  if (clipped.length) lines.push('', `Clipped alone, so their levels read low (lower the master's input trim and re-run): ${clipped.join(', ')}`);
  if (applied.length) {
    lines.push('', 'Applied (to undo, set each fader back to its first value):');
    for (const a of applied) lines.push(`  ${a.track}: ${a.fromDb.toFixed(1)} -> ${(a.achievedDb ?? a.toDb).toFixed(1)} dB`);
  }
  for (const s of skipped) lines.push(`Not applied: ${s.track} - ${s.reason}`);
  if (verification) {
    lines.push('', `Measured after: worst band ${verification.worstDb.toFixed(1)} dB off the references (${verification.file})`);
    if (verification.clipped) lines.push("The verification capture clipped: lower the master's input trim and measure again.");
  }
  lines.push('', 'Next: listen, then `qc` the master against the same references. A part at its limit needs fixing at its source.');
  return { result, parts, clipped, applied, skipped, verification, text: lines.join('\n') };
}

