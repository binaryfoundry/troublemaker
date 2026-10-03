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
  checkArrangement,
  planArrangement,
  type ArrangementFinding,
  type PlannedSection,
  type RoleSource,
} from '../../agent/src/arrangement.js';
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
  const findings = checkArrangement(plan);
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
