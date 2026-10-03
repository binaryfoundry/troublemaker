/**
 * The MCP surface: a curated set of tools over the bridge, plus the agent
 * prompts and knowledge files as MCP prompts and resources.
 *
 * Tools are deliberately narrower than the bridge's 80-odd commands. Each
 * one does a whole musical job (read, edit with a snapshot, verify) so an
 * agent cannot skip the safety steps PROJECT.md asks for. `bridge_command`
 * is the escape hatch for anything else, still validated by the bridge.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { toPayload } from '../bridge/src/errors.js';
import { COMMANDS } from '../bridge/src/commands/registry.js';
import { applyEffect, findEffect, loadCodex } from '../bridge/src/fx.js';
import {
  buildArrangement,
  resolveReferenceFiles,
  transformClip,
  TRANSFORMS,
  writeDrums,
  type ReferenceRequest,
} from '../bridge/src/workflows.js';
import { runQc } from '../qc/src/run.js';
import { runAb } from '../qc/src/ab.js';
import { analyzeBass, formatBassProfile } from '../qc/src/bass.js';
import { identifyEffect } from '../qc/src/identify.js';
import { genreSummary, loadReferenceSets, scanLibrary } from '../qc/src/library.js';
import { checkArrangement, formatPlan, planArrangement, styleNames } from '../agent/src/arrangement.js';
import {
  createBuildUp,
  createFourOnFloorKick,
  createOffbeatHat,
  createRollingBass,
  createTechnoDrumKit,
  writePattern,
  type Command,
} from '../agent/src/composition.js';
import { bassFromFeel, cycleArp, euclidean, euclideanPattern, polyrhythm } from '../agent/src/patterns.js';
import { progression } from '../agent/src/music-theory.js';
import { drumGenres } from '../agent/src/drums.js';
import { checkMelody, motifMelody } from '../agent/src/melody.js';
import { checkChords, chordKnowledge, chordTemplate, voiceLeadingReport, voiceProgression, type VoicedChord } from '../agent/src/chords.js';
import { bassPattern, bassPatternNames, checkBassline, mergeRepeats } from '../agent/src/basslines.js';
import type { ChainState, Decision } from '../agent/src/mastering/policy.js';

export interface McpClient {
  post(command: string, args?: Record<string, unknown>, options?: { dryRun?: boolean }): Promise<unknown>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function text(...parts: unknown[]): ToolResult {
  return {
    content: parts.map((p) => ({ type: 'text' as const, text: typeof p === 'string' ? p : JSON.stringify(p, null, 2) })),
  };
}

/** Bridge errors carry a code and remedy; hand them to the agent intact. */
async function guarded(work: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await work();
  } catch (error) {
    const payload = toPayload(error);
    return { content: [{ type: 'text', text: JSON.stringify({ error: payload }, null, 2) }], isError: true };
  }
}

const id = z.number().int().nonnegative();
const trackId = id.describe('track_id from get_project (stable for the session)');
const slot = z.number().int().nonnegative().describe('Clip slot index, 0 = top');

const references = {
  reference_set: z
    .string()
    .optional()
    .describe('Named set from config/reference-sets.json, e.g. "deep house", "melodic techno", "house"'),
  reference_files: z.array(z.string()).optional().describe('Explicit reference audio files'),
  references_dir: z.string().optional().describe('Pick references from this folder (with genre)'),
  genre: z.string().optional().describe('Beatport genre tag, with references_dir'),
  profile: z.string().optional().describe('Mastering profile: techno, house, deep, ...; defaults from the set'),
};

function referenceRequest(args: {
  reference_set?: string;
  reference_files?: string[];
  references_dir?: string;
  genre?: string;
}): ReferenceRequest {
  return { set: args.reference_set, files: args.reference_files, dir: args.references_dir, genre: args.genre };
}

export function createMcpServer(client: McpClient): McpServer {
  const server = new McpServer(
    { name: 'troublemaker', version: '0.1.0' },
    {
      instructions:
        'Control a running Ableton Live Set. Read before writing: get_project, then read_clip. ' +
        'Edits snapshot first and return a snapshot_id for restore_snapshot. Master changes need a reason. ' +
        'Load the "system" prompt (and composition / effects / mastering for those jobs) for the full working rules.',
    },
  );
  const post = (command: string, args: Record<string, unknown> = {}) => client.post(command, args);

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  server.registerTool(
    'live_status',
    {
      title: 'Live status',
      description: 'Live version capabilities, tempo, signature and transport. Call first to confirm Live is connected.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(async () => {
        const [capabilities, transport, signature] = await Promise.all([
          post('live.get_capabilities'),
          post('live.get_transport'),
          post('live.get_time_signature'),
        ]);
        return text({ capabilities, transport, signature });
      }),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Project overview',
      description:
        'Every track with its track_id, clips per slot, devices, mixer; plus scenes. Use the ids it returns in every other tool.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guarded(async () => text(await post('live.get_project_state'))),
  );

  server.registerTool(
    'get_selection',
    {
      title: 'Selection',
      description: 'What the user has selected in Live: resolves "this track", "this clip", "this device".',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(async () => {
        const read = async (command: string) => {
          try {
            return await post(command);
          } catch {
            return null;
          }
        };
        return text({
          track: await read('live.get_selected_track'),
          scene: await read('live.get_selected_scene'),
          clip: await read('live.get_selected_clip'),
          device: await read('live.get_selected_device'),
        });
      }),
  );

  server.registerTool(
    'read_clip',
    {
      title: 'Read clip notes',
      description: 'All notes of a MIDI clip (note_id, pitch, start, duration, velocity) and its length in beats.',
      inputSchema: { track_id: trackId, clip_slot: slot },
      annotations: { readOnlyHint: true },
    },
    (args) => guarded(async () => text(await post('live.get_notes', args))),
  );

  server.registerTool(
    'get_devices',
    {
      title: 'Devices and parameters',
      description: 'Devices on a track in chain order, each with its parameters (name, value, display, range).',
      inputSchema: { track_id: trackId },
      annotations: { readOnlyHint: true },
    },
    ({ track_id }) =>
      guarded(async () => {
        const { devices } = (await post('live.get_devices', { track_id })) as { devices: Array<{ device_id: number }> };
        const detailed = [];
        for (const device of devices) {
          detailed.push(await post('live.get_device', { track_id, device_id: device.device_id }));
        }
        return text({ track_id, devices: detailed });
      }),
  );

  // -------------------------------------------------------------------------
  // Editing notes
  // -------------------------------------------------------------------------

  server.registerTool(
    'transform_clip',
    {
      title: 'Transform a clip',
      description:
        'Edit existing notes musically: syncopate, straighten, thin, densify, humanize, swing, transpose, ' +
        'conform_key, vary (every Nth bar), silence_gap (pre-drop gap). Snapshots first, applies atomically, ' +
        'reads back and reports what changed. amount is 0..1 where it applies.',
      inputSchema: {
        track_id: trackId,
        clip_slot: slot,
        transform: z.enum(TRANSFORMS),
        amount: z.number().min(0).max(1).optional(),
        semitones: z.number().int().min(-48).max(48).optional().describe('transpose'),
        root: z.string().optional().describe('conform_key, e.g. "F"'),
        scale: z.string().optional().describe('conform_key, default minor'),
        every_bars: z.number().int().min(1).optional().describe('vary'),
        from_beat: z.number().nonnegative().optional().describe('silence_gap start'),
        to_beat: z.number().nonnegative().optional().describe('silence_gap end, default clip end'),
        preserve_edges: z.boolean().optional().describe('Keep the first and last notes untouched'),
        seed: z.number().int().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    (args) => guarded(async () => text(await transformClip(client, args))),
  );

  server.registerTool(
    'write_notes',
    {
      title: 'Write notes',
      description:
        'Write explicit notes into a clip (creating it when the slot is empty). mode=replace clears the clip ' +
        'first, add keeps what is there. Snapshots before writing. Beats are 0-based quarter notes.',
      inputSchema: {
        track_id: trackId,
        clip_slot: slot,
        notes: z
          .array(
            z.object({
              pitch: z.number().int().min(0).max(127),
              start: z.number().nonnegative(),
              duration: z.number().positive(),
              velocity: z.number().min(1).max(127).default(100),
            }),
          )
          .min(1),
        mode: z.enum(['replace', 'add']).default('replace'),
        length_beats: z.number().positive().optional().describe('Clip length when creating; default covers the notes'),
      },
    },
    (args) =>
      guarded(async () => {
        const target = { track_id: args.track_id, clip_slot: args.clip_slot };
        const end = Math.max(...args.notes.map((n) => n.start + n.duration));
        const commands: Command[] = [];
        let snapshot: string | null = null;
        try {
          snapshot = ((await post('live.snapshot_clip', { ...target, label: 'before write_notes' })) as { snapshot_id: string })
            .snapshot_id;
        } catch {
          const length = args.length_beats ?? Math.max(4, Math.ceil(end / 4) * 4);
          commands.push({ command: 'live.create_midi_clip', args: { ...target, length_beats: length } });
        }
        commands.push({
          command: args.mode === 'add' ? 'live.add_notes' : 'live.replace_notes',
          args: { ...target, notes: args.notes },
        });
        const result = await post('transaction', { atomic: true, commands });
        return text({ snapshot_id: snapshot, written: args.notes.length, result });
      }),
  );

  const PARTS = [
    'kick',
    'hats',
    'drum_kit',
    'drums',
    'arp',
    'melody',
    'bass',
    'bassline',
    'chords',
    'build_up',
    'euclidean',
    'polyrhythm',
    'bass_from_reference',
  ] as const;

  server.registerTool(
    'write_part',
    {
      title: 'Generate a part',
      description:
        'Generate a part into a clip slot: drums (a DRUMS.md genre groove - genre house/techno/hiphop/trap/electro, ' +
        'energy, variant A/A\'/B/F or phrase=true for a 16-bar A/A\'/B/F phrase, swing, humanize, chance), ' +
        'bassline (a BASSLINES.md pattern - house_offbeat, rolling_techno, dnb_sub... - transposed to root, form=true for ' +
        'A/A2/B/A3 development, checked against the kick), ' +
        'melody (motif-first hook: rhythm on one note, chord tones on strong beats, A A A\' B, resolves to the tonic; ' +
        'needs root, chords from symbols/template/degrees), ' +
        'arp (cycle arpeggio over a voice-led progression: contour, accent, octave and rest cycles of different ' +
        'lengths drift against the bar; needs root), kick (four on the floor), hats (offbeat), drum_kit, bass (rolling, ' +
        'needs root), chords (voice-led: symbols, a CHORDS.md template H01-H08, or root + degrees), build_up, euclidean (hits/steps/pitch), ' +
        'polyrhythm (a:b), bass_from_reference (copy a reference track\'s bass rhythm, accents and pitches). ' +
        'Replaces the clip in that slot; the previous clip is snapshotted when there was one.',
      inputSchema: {
        track_id: trackId,
        clip_slot: slot,
        part: z.enum(PARTS),
        bars: z.number().int().min(1).max(64).optional(),
        genre: z.string().optional().describe(`drums: ${drumGenres().join(', ')}`),
        energy: z.enum(['low', 'medium', 'high', 'peak', 'break']).optional().describe('drums: which voices play'),
        variant: z.enum(['A', "A'", 'B', 'F']).optional().describe('drums: canonical, subtle change, stronger change, fill'),
        phrase: z.boolean().optional().describe('drums: a 16-bar A/A\'/B/F phrase ending in a fill'),
        swing_percent: z.number().min(50).max(75).optional().describe('drums: pair ratio, 50 straight, 66.7 triplet; hats and percussion only. Not the Groove Pool amount'),
        feel: z.enum(['straight', 'laid_back']).optional().describe('drums: laid_back = clap +3 ms, open hat +4 ms'),
        humanize: z.boolean().optional().describe('drums: role-based microtiming; main kicks stay on the grid'),
        chance: z.boolean().optional().describe('drums: trigger chance on ghosts and percussion only'),
        contour: z.array(z.number().int().min(0).max(12)).optional().describe('arp: indices into chord tones, e.g. [0,2,1,3,2]'),
        accent_hits: z.number().int().min(1).optional().describe('arp: Euclidean accents, hits per accent_steps (default 3 of 8)'),
        accent_steps: z.number().int().min(2).optional(),
        octave_cycle: z.array(z.number().int().min(-24).max(24)).optional().describe('arp: semitone offsets cycle, default [0,0,12,0,0,0,0]'),
        rests_per_bar: z.number().int().min(0).max(12).optional().describe('arp: rests in each 16-step cycle (default 3)'),
        motif_notes: z.number().int().min(2).max(9).optional().describe('melody: notes in the one-bar rhythmic motif (default 5)'),
        beats_per_chord: z.number().positive().optional().describe('arp/chords: default 8 (two bars)'),
        pattern: z.string().optional().describe(`bassline: ${bassPatternNames().join(', ')}`),
        form: z.boolean().optional().describe('bassline: A / A2 / B / A3 development across the clip'),
        octave_shift: z.number().int().min(-2).max(2).optional().describe('bassline: whole octaves up or down'),
        merge_repeats: z.boolean().optional().describe('bass parts: join back-to-back repeats so the envelope does not restart (clicks)'),
        kick_track_id: id.optional().describe('bass parts: check the bass against the kick in this track\'s slot 0'),
        root: z.string().optional().describe('Key root, e.g. "F" or "A#"'),
        scale: z.string().optional().describe('minor, major, dorian, phrygian, ...'),
        degrees: z.array(z.number().int().min(1).max(7)).optional().describe('chords'),
        symbols: z.array(z.string()).optional().describe('chords: chord symbols, e.g. ["F#m9","Dmaj7","Aadd9","E6/9sus4"]; "Gsus4→G" resolves inside one slot'),
        template: z.string().optional().describe(`chords: CHORDS.md template ${Object.entries(chordKnowledge().templates).map(([k, t]) => `${k} ${t.style}`).join('; ')}`),
        voicing: z.enum(['triad', 'seventh', 'ninth', 'sus2', 'sus4', 'power']).optional().describe('chords from degrees'),
        bars_per_chord: z.number().int().min(1).optional(),
        octave: z.number().int().min(0).max(8).optional(),
        density: z.number().min(0).max(1).optional().describe('bass'),
        hits: z.number().int().min(0).optional().describe('euclidean'),
        steps: z.number().int().min(1).optional().describe('euclidean'),
        rotation: z.number().int().optional().describe('euclidean'),
        pitch: z.number().int().min(0).max(127).optional().describe('euclidean / polyrhythm first voice'),
        ratio: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional().describe('polyrhythm a:b'),
        reference_file: z.string().optional().describe('bass_from_reference: the audio file'),
        transpose: z.number().int().min(-48).max(48).optional().describe('bass_from_reference: semitones'),
        kick_delay: z.number().min(0).max(0.125).optional().describe('bass_from_reference: beats to delay kick-step notes'),
        seed: z.number().int().optional(),
      },
    },
    (args) =>
      guarded(async () => {
        const target = { track_id: args.track_id, clip_slot: args.clip_slot };
        if (args.part === 'drums') {
          const written = await writeDrums(client, target, args.genre ?? 'techno', {
            bars: args.bars,
            seed: args.seed,
            energy: args.energy,
            variant: args.variant,
            phrase: args.phrase,
            swingPercent: args.swing_percent,
            feel: args.feel,
            humanize: args.humanize,
            chance: args.chance,
          });
          const { grid, findings, ...summary } = written;
          return text(
            summary,
            grid,
            findings.length ? findings.map((f) => `[${f.severity}] ${f.message}`).join('\n') : 'Drum checks: no findings.',
          );
        }
        const groove = { bars: args.bars, seed: args.seed };
        let commands: Command[];
        let notes: string[] = [];
        switch (args.part) {
          case 'kick':
            commands = createFourOnFloorKick(target, groove);
            break;
          case 'hats':
            commands = createOffbeatHat(target, groove);
            break;
          case 'drum_kit':
            commands = createTechnoDrumKit(target, groove);
            break;
          case 'bass':
            if (!args.root) throw new Error('bass needs a root, e.g. "F".');
            commands = createRollingBass(target, { ...groove, root: args.root, scale: args.scale, density: args.density });
            break;
          case 'chords': {
            // Symbols, a CHORDS.md template, or scale degrees - always voice-led.
            const beatsPerChord = args.beats_per_chord ?? (args.bars_per_chord ?? 1) * 4;
            let voiced: VoicedChord[];
            if (args.symbols?.length || args.template) {
              const symbols = args.symbols?.length ? args.symbols : chordTemplate(args.template!).progression;
              voiced = voiceProgression(symbols, { beatsPerChord });
            } else {
              if (!args.root) throw new Error('chords needs symbols, a template (H01-H08) or a root with degrees.');
              const led = progression(args.root, args.scale ?? 'minor', args.degrees ?? [1, 6, 3, 7], {
                voicing: args.voicing ?? 'triad',
                octave: args.octave ?? 3,
              });
              voiced = led.map((pitches, i) => ({ symbol: `degree ${(args.degrees ?? [1, 6, 3, 7])[i]}`, pitches, beat: i * beatsPerChord, beats: beatsPerChord }));
            }
            const length = Math.max(...voiced.map((c) => c.beat + c.beats));
            const pattern = {
              length_beats: length,
              events: voiced.flatMap((c) => c.pitches.map((pitch) => ({ beat: c.beat, pitch, duration: c.beats * 0.98, velocity: 88 }))),
            };
            commands = writePattern(pattern, { ...target, bars: length / 4, createClip: true, name: 'Chords' });
            const motion = voiceLeadingReport(voiced).map((st) => `${st.from} → ${st.to}: ${st.motion} semitones, ${st.commonTones} common`).join('; ');
            const findings = checkChords(voiced);
            notes = [
              voiced.map((c) => `${c.symbol}: ${c.pitches.join(' ')}`).join('\n'),
              motion ? `Voice leading: ${motion}.` : 'One chord.',
              findings.length ? findings.map((f) => `[${f.severity}] ${f.message}`).join('\n') : 'Chord checks: no findings.',
            ];
            break;
          }
          case 'build_up':
            commands = createBuildUp(target, groove);
            break;
          case 'bassline': {
            if (!args.pattern) throw new Error(`bassline needs a pattern: ${bassPatternNames().join(', ')}.`);
            const pattern = bassPattern(args.pattern, { root: args.root, octave: args.octave_shift ?? 0, bars: args.bars, form: args.form, seed: args.seed });
            commands = writePattern(pattern, { ...target, bars: pattern.length_beats / 4, createClip: true, name: `Bass ${args.pattern}` });
            notes = [`${args.pattern}: ${pattern.spec.purpose} (written at ${pattern.spec.tempo} BPM, ${pattern.spec.genre}).`];
            break;
          }
          case 'melody': {
            if (!args.root) throw new Error('melody needs a root (the key), e.g. "F".');
            const beatsPerChord = args.beats_per_chord ?? 4;
            const chords = args.symbols?.length || args.template
              ? voiceProgression(args.symbols?.length ? args.symbols : chordTemplate(args.template!).progression, { beatsPerChord }).map((c) => c.pitches)
              : progression(args.root, args.scale ?? 'minor', args.degrees ?? [1, 6, 3, 7], { voicing: 'seventh' });
            const melodyOptions = { chords, beatsPerChord, root: args.root, scale: args.scale, bars: args.bars, hits: args.motif_notes, seed: args.seed };
            const melody = motifMelody(melodyOptions);
            commands = writePattern(melody, { ...target, bars: melody.length_beats / 4, createClip: true, name: 'Melody' });
            const findings = checkMelody(melody, melodyOptions);
            notes = [findings.length ? findings.map((f) => `[${f.severity}] ${f.message}`).join('\n') : 'Melody checks: no findings.'];
            break;
          }
          case 'arp': {
            if (!args.root) throw new Error('arp needs a root, e.g. "F".');
            const bars = args.bars ?? 16;
            const chords = progression(args.root, args.scale ?? 'minor', args.degrees ?? [1, 6, 3, 7], {
              voicing: 'seventh',
              octave: args.octave ?? 4,
            });
            const arp = cycleArp({
              chords,
              beatsPerChord: args.beats_per_chord ?? 8,
              bars,
              contour: args.contour ?? [0, 2, 1, 3, 2],
              accents: euclidean(args.accent_hits ?? 3, args.accent_steps ?? 8),
              octaves: args.octave_cycle ?? [0, 0, 12, 0, 0, 0, 0],
              mask: euclidean(16 - (args.rests_per_bar ?? 3), 16, 3),
              gate: 0.55,
              seed: args.seed,
            });
            commands = writePattern(arp, { ...target, bars, createClip: true, name: 'Arp cycles' });
            notes = [`The line repeats after ${arp.repeatsAfterSteps} sixteenths (${(arp.repeatsAfterSteps / 16).toFixed(1)} bars); the clip is ${bars} bars.`];
            break;
          }
          case 'euclidean': {
            if (args.hits === undefined || args.steps === undefined || args.pitch === undefined) {
              throw new Error('euclidean needs hits, steps and pitch.');
            }
            const bars = args.bars ?? 1;
            const pattern = euclideanPattern({
              bars,
              seed: args.seed,
              hits: args.hits,
              steps: args.steps,
              rotation: args.rotation,
              pitch: args.pitch,
            });
            commands = writePattern(pattern, { ...target, bars, createClip: true, name: `E(${args.hits},${args.steps})` });
            break;
          }
          case 'polyrhythm': {
            const [a, b] = args.ratio ?? [3, 2];
            const bars = args.bars ?? 1;
            const pitch = args.pitch ?? 37;
            const pattern = polyrhythm({ a, b, pitchA: pitch, pitchB: pitch + 1, bars });
            commands = writePattern(pattern, { ...target, bars, createClip: true, name: `${a}:${b}` });
            break;
          }
          case 'bass_from_reference': {
            if (!args.reference_file) throw new Error('bass_from_reference needs reference_file.');
            const profile = await analyzeBass(args.reference_file);
            const pitched = profile.steps.map((s) => s.pitch).filter((p): p is number => p !== null);
            const counts = new Map<number, number>();
            for (const p of pitched) counts.set(p, (counts.get(p) ?? 0) + 1);
            const rootMidi = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? profile.register?.low ?? 36;
            const bars = args.bars ?? 4;
            const pattern = bassFromFeel(
              { steps: profile.steps, gate: profile.gate, rootMidi },
              {
                bars,
                seed: args.seed,
                transpose: args.transpose,
                skipKickSteps: args.kick_delay === undefined,
                kickDelay: args.kick_delay,
              },
            );
            commands = writePattern(pattern, { ...target, bars, createClip: true, name: 'Bass (ref)' });
            notes = [formatBassProfile(profile)];
            break;
          }
        }
        if (['bass', 'bassline', 'bass_from_reference'].includes(args.part)) {
          const replace = commands.find((c) => c.command === 'live.replace_notes');
          if (replace) {
            const raw = replace.args.notes as Array<{ pitch: number; start: number; duration: number; velocity: number }>;
            let line = { length_beats: Math.max(4, ...raw.map((n) => n.start + n.duration)), events: raw.map((n) => ({ beat: n.start, pitch: n.pitch, duration: n.duration, velocity: n.velocity })) };
            if (args.merge_repeats) {
              line = mergeRepeats(line);
              replace.args.notes = line.events.map((e) => ({ pitch: e.pitch, start: e.beat, duration: e.duration, velocity: e.velocity }));
            }
            let kicks: number[] | undefined;
            if (args.kick_track_id !== undefined) {
              try {
                const kick = (await post('live.get_notes', { track_id: args.kick_track_id, clip_slot: 0 })) as { notes: Array<{ start?: number; start_time?: number }> };
                kicks = kick.notes.map((n) => n.start ?? n.start_time ?? 0);
              } catch {
                // No kick clip: check without it.
              }
            }
            const transport = (await post('live.get_tempo').catch(() => ({ bpm: 124 }))) as { bpm: number };
            const findings = checkBassline(line, { bpm: transport.bpm, kicks });
            notes.push(findings.length ? findings.map((f) => `[${f.severity}] ${f.message}`).join('\n') : 'Bass checks: no findings.');
          }
        }
        let snapshot: string | null = null;
        try {
          snapshot = ((await post('live.snapshot_clip', { ...target, label: `before write_part ${args.part}` })) as {
            snapshot_id: string;
          }).snapshot_id;
        } catch {
          // Empty slot: nothing to keep.
        }
        const result = await post('transaction', { atomic: true, commands });
        const read = await post('live.get_notes', target);
        return text(
          { part: args.part, snapshot_id: snapshot, note_count: (read as { notes: unknown[] }).notes.length, result },
          ...notes,
        );
      }),
  );

  server.registerTool(
    'restore_snapshot',
    {
      title: 'Restore a snapshot',
      description: 'Put a clip back exactly as it was before an edit, using the snapshot_id an edit returned. Omit to list snapshots.',
      inputSchema: { snapshot_id: z.string().optional() },
    },
    ({ snapshot_id }) =>
      guarded(async () =>
        text(snapshot_id ? await post('live.restore_clip', { snapshot_id }) : await post('live.list_snapshots')),
      ),
  );

  // -------------------------------------------------------------------------
  // Mixer, devices, transport
  // -------------------------------------------------------------------------

  server.registerTool(
    'set_mixer',
    {
      title: 'Mixer',
      description:
        'Set a track\'s volume (dB, e.g. -6), pan (-1..1), a send (send index + dB), mute or solo. ' +
        'Give only the fields to change.',
      inputSchema: {
        track_id: trackId,
        volume_db: z.number().min(-70).max(6).optional(),
        pan: z.number().min(-1).max(1).optional(),
        send: id.optional().describe('Send index (0 = A)'),
        send_db: z.number().min(-70).max(0).optional(),
        mute: z.boolean().optional(),
        solo: z.boolean().optional(),
      },
    },
    (args) =>
      guarded(async () => {
        const done: Record<string, unknown> = {};
        const t = { track_id: args.track_id };
        // Faders are not linear in dB: search the fader's own display so -6 means -6 dB.
        const byDisplay = (mixer: string, target: number) =>
          post('live.set_device_parameter_display', { ...t, mixer, target });
        if (args.volume_db !== undefined) done.volume = await byDisplay('volume', args.volume_db);
        if (args.pan !== undefined) done.pan = await post('live.set_track_pan', { ...t, value: args.pan });
        if (args.send !== undefined && args.send_db !== undefined) {
          done.send = await byDisplay(`send:${args.send}`, args.send_db);
        }
        if (args.mute !== undefined) done.mute = await post('live.set_track_mute', { ...t, enabled: args.mute });
        if (args.solo !== undefined) done.solo = await post('live.set_track_solo', { ...t, enabled: args.solo });
        return text(done);
      }),
  );

  server.registerTool(
    'set_device_parameter',
    {
      title: 'Device parameter',
      description:
        'Set a device parameter by name. display is the number Live shows, in the unit it shows ' +
        '(-6 for "-6 dB", 120 for "120 Hz", 35 for "35 %"); option is a named state ("1/16", "Lowpass", "On"); ' +
        'value is the raw native value.',
      inputSchema: {
        track_id: trackId,
        device_id: id,
        parameter: z.string().describe('Parameter name as get_devices lists it'),
        display: z.number().optional(),
        option: z.string().optional(),
        value: z.number().optional(),
      },
    },
    (args) =>
      guarded(async () => {
        const ref = { track_id: args.track_id, device_id: args.device_id, parameter_name: args.parameter };
        if (args.option !== undefined) {
          return text(await post('live.set_device_parameter_option', { ...ref, option: args.option }));
        }
        if (args.display !== undefined) {
          return text(await post('live.set_device_parameter_display', { ...ref, target: args.display }));
        }
        if (args.value !== undefined) return text(await post('live.set_device_parameter', { ...ref, value: args.value }));
        throw new Error('Give display, option or value.');
      }),
  );

  const BROWSER_CATEGORIES = [
    'drums',
    'instruments',
    'sounds',
    'samples',
    'audio_effects',
    'midi_effects',
    'packs',
    'user_library',
    'user_folders',
  ] as const;

  interface BrowserItem {
    name: string;
    path: string[];
    is_loadable: boolean;
    is_folder: boolean;
  }

  async function searchBrowser(category: string, query: string): Promise<BrowserItem[]> {
    const { items } = (await post('live.browse', { category, query, limit: 40 })) as { items: BrowserItem[] };
    return items.filter((i) => i.is_loadable);
  }

  server.registerTool(
    'find_sounds',
    {
      title: 'Find sounds',
      description:
        "Search Live's browser: drum kits (drums), instrument presets (sounds, instruments), samples, effects, " +
        'packs, the User Library and added folders (user_folders). Every word of query must appear in the name. ' +
        'Omit query to list a folder (path).',
      inputSchema: {
        category: z.enum(BROWSER_CATEGORIES),
        query: z.string().optional().describe('e.g. "808 kit", "sub bass", "clap"'),
        path: z.array(z.string()).optional().describe('Folder to list, as names from the category down'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => guarded(async () => text(await post('live.browse', { ...args, limit: 60 }))),
  );

  server.registerTool(
    'load_sound',
    {
      title: 'Load a sound',
      description:
        'Load a kit, preset, instrument or sample onto a track: give query (best match is loaded, alternatives ' +
        'returned) or category + path from find_sounds. A Drum Rack kit reports its pads, so kick / clap / hat ' +
        'notes are known; write_part drums use GM notes (kick 36, snare 38, clap 39, closed hat 42, open hat 46).',
      inputSchema: {
        track_id: trackId,
        query: z.string().optional().describe('e.g. "808 Core Kit", "Sub Bass"'),
        category: z.enum(BROWSER_CATEGORIES).optional().describe('Where to look; default drums, sounds, instruments, samples'),
        path: z.array(z.string()).optional(),
      },
    },
    (args) =>
      guarded(async () => {
        let category = args.category as string | undefined;
        let path = args.path;
        let alternatives: BrowserItem[] = [];
        if (!path) {
          if (!args.query) throw new Error('Give query, or category and path.');
          const wanted = args.query.trim().toLowerCase();
          const order = category ? [category] : ['drums', 'sounds', 'instruments', 'samples'];
          for (const where of order) {
            const found = await searchBrowser(where, args.query);
            if (!found.length) continue;
            const stem = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
            found.sort(
              (a, b) =>
                Number(stem(b.name) === wanted) - Number(stem(a.name) === wanted) ||
                Number(/\.adg$/i.test(b.name)) - Number(/\.adg$/i.test(a.name)) ||
                a.name.length - b.name.length,
            );
            category = where;
            path = found[0]!.path;
            alternatives = found.slice(1, 8);
            break;
          }
          if (!path) throw new Error(`Nothing loadable matches '${args.query}' in ${order.join(', ')}.`);
        }
        if (!category) throw new Error('Give category with path.');
        const loaded = (await post('live.load_browser_item', { track_id: args.track_id, category, path })) as {
          devices: Array<{ device_id: number; name: string; class_name: string | null }>;
        };
        const kit = loaded.devices.find((d) => d.class_name === 'DrumGroupDevice');
        const pads = kit
          ? ((await post('live.get_drum_pads', { track_id: args.track_id, device_id: kit.device_id })) as {
              pads: Array<{ note: number; name: string }>;
            }).pads
          : undefined;
        return text({
          ...loaded,
          ...(pads ? { pads } : {}),
          ...(alternatives.length ? { alternatives: alternatives.map((a) => ({ name: a.name, path: a.path })) } : {}),
        });
      }),
  );

  server.registerTool(
    'insert_device',
    {
      title: 'Insert a device',
      description:
        'Insert a native Live device (e.g. "Auto Filter", "EQ Eight", "Reverb", "Drift") on a track (Live 12.3+). ' +
        'Suite-only devices are not available on Standard.',
      inputSchema: {
        track_id: trackId,
        device_name: z.string(),
        index: z.number().int().nonnegative().optional().describe('Chain position; default end'),
      },
    },
    (args) => guarded(async () => text(await post('live.insert_device', args))),
  );

  server.registerTool(
    'transport',
    {
      title: 'Transport',
      description: 'play, stop, continue, set tempo, fire a scene or a clip, stop all clips.',
      inputSchema: {
        action: z.enum(['play', 'stop', 'continue', 'tempo', 'fire_scene', 'fire_clip', 'stop_all_clips']),
        bpm: z.number().min(20).max(999).optional(),
        scene_id: id.optional(),
        track_id: id.optional(),
        clip_slot: id.optional(),
      },
    },
    (args) =>
      guarded(async () => {
        switch (args.action) {
          case 'play':
            return text(await post('live.play'));
          case 'stop':
            return text(await post('live.stop'));
          case 'continue':
            return text(await post('live.continue_playing'));
          case 'stop_all_clips':
            return text(await post('live.stop_all_clips'));
          case 'tempo':
            if (args.bpm === undefined) throw new Error('tempo needs bpm.');
            return text(await post('live.set_tempo', { bpm: args.bpm }));
          case 'fire_scene':
            if (args.scene_id === undefined) throw new Error('fire_scene needs scene_id.');
            return text(await post('live.fire_scene', { scene_id: args.scene_id }));
          case 'fire_clip':
            if (args.track_id === undefined || args.clip_slot === undefined) {
              throw new Error('fire_clip needs track_id and clip_slot.');
            }
            return text(await post('live.fire_clip', { track_id: args.track_id, clip_slot: args.clip_slot }));
        }
      }),
  );

  // -------------------------------------------------------------------------
  // Mastering (MIXING.md)
  // -------------------------------------------------------------------------

  server.registerTool(
    'master_chain',
    {
      title: 'Master chain',
      description:
        'Inspect the Master chain in engineering units (inspect), build Utility > EQ Eight > Glue > Saturator > ' +
        'Limiter (build), apply a preset (preset, e.g. "clean"), checkpoint / restore, or list decisions.',
      inputSchema: {
        action: z.enum(['inspect', 'build', 'preset', 'checkpoint', 'restore', 'list_checkpoints', 'decisions', 'meters']),
        preset: z.string().optional(),
        label: z.string().optional().describe('checkpoint label'),
        checkpoint_id: z.string().optional(),
        seconds: z.number().min(0.2).max(30).optional().describe('meters'),
      },
    },
    (args) =>
      guarded(async () => {
        switch (args.action) {
          case 'inspect':
            return text(await post('master.inspect_chain'));
          case 'build':
            return text(await post('master.build_chain', args.preset ? { preset: args.preset } : {}));
          case 'preset':
            return text(await post('master.apply_preset', { preset: args.preset ?? 'clean' }));
          case 'checkpoint':
            return text(await post('master.checkpoint', { label: args.label ?? 'checkpoint' }));
          case 'restore':
            if (!args.checkpoint_id) throw new Error('restore needs checkpoint_id.');
            return text(await post('master.restore_checkpoint', { checkpoint_id: args.checkpoint_id }));
          case 'list_checkpoints':
            return text(await post('master.list_checkpoints'));
          case 'decisions':
            return text(await post('master.decisions'));
          case 'meters':
            return text(await post('master.meters', args.seconds ? { seconds: args.seconds } : {}));
        }
      }),
  );

  server.registerTool(
    'master_set',
    {
      title: 'Change a master role',
      description:
        'Set one Master chain role in engineering units (e.g. ceiling -1.0 dBTP, glue_ratio 2, low_shelf_gain -1.5 dB), ' +
        'within safe ranges. reason is required and logged. Prefer ab_trial when the change should be proven by ear.',
      inputSchema: {
        role: z.string(),
        value: z.union([z.number(), z.string()]),
        reason: z.string().min(3),
        mix_repair: z.boolean().optional(),
        allow_widen: z.boolean().optional(),
      },
    },
    (args) => guarded(async () => text(await post('master.set', args))),
  );

  server.registerTool(
    'capture_master',
    {
      title: 'Record the Master',
      description:
        'Record the Master output to a WAV (resampling inside Live), optionally launching a scene first. ' +
        'Returns file_path for qc or compare.',
      inputSchema: {
        bars: z.number().int().min(1).max(256).optional(),
        scene_id: id.optional(),
        start_beat: z.number().nonnegative().optional().describe('Or play the Arrangement from here'),
      },
    },
    (args) => guarded(async () => text(await post('master.capture', args))),
  );

  server.registerTool(
    'qc',
    {
      title: 'Club-readiness QC',
      description:
        'Measure a mix against MIXING.md: loudness (BS.1770), true peak, PLR, band balance, mono compatibility, ' +
        'against references. Give file, or capture=true to record the Master first. Verdict PASS / REVIEW / FAIL ' +
        'with reasons and suggested chain moves.',
      inputSchema: {
        file: z.string().optional(),
        capture: z.boolean().optional(),
        bars: z.number().int().min(1).max(256).optional(),
        scene_id: id.optional(),
        with_chain: z.boolean().optional().describe('Include the live Master chain readings in the advice'),
        ...references,
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        let target = args.file;
        if (args.capture) {
          if (target) throw new Error('Give file or capture, not both.');
          const captured = (await post('master.capture', {
            ...(args.bars ? { bars: args.bars } : {}),
            ...(args.scene_id !== undefined ? { scene_id: args.scene_id } : {}),
          })) as { file_path: string };
          target = captured.file_path;
        }
        if (!target) throw new Error('qc needs file, or capture=true.');
        const resolved = await resolveReferenceFiles(client, referenceRequest(args));
        let chain: ChainState | undefined;
        let decisions: Decision[] | undefined;
        if (args.with_chain) {
          const inspection = (await post('master.inspect_chain')) as {
            track_id: number;
            readings: ChainState['readings'];
            limiter_true_peak: ChainState['limiterTruePeak'];
          };
          chain = { readings: inspection.readings, limiterTruePeak: inspection.limiter_true_peak };
          decisions = ((await post('master.decisions', { track_id: inspection.track_id })) as { decisions: Decision[] })
            .decisions;
        }
        const result = await runQc({
          target,
          references: resolved.files,
          profile: args.profile ?? resolved.profile ?? undefined,
          chain,
          decisions,
        });
        return text(
          [...resolved.describe, '', result.report].join('\n'),
          { file: target, verdict: result.evaluation.verdict },
        );
      }),
  );

  server.registerTool(
    'ab_trial',
    {
      title: 'A/B a master change',
      description:
        'Capture A, apply one role change, capture B, compare at matched loudness against references, and keep ' +
        'the change only if B wins (otherwise it is reverted). Writes gain-matched listening copies.',
      inputSchema: {
        role: z.string(),
        value: z.union([z.number(), z.string()]),
        reason: z.string().min(3).describe('The hypothesis this trial tests'),
        bars: z.number().int().min(1).max(64).optional(),
        scene_id: id.optional(),
        mix_repair: z.boolean().optional(),
        allow_widen: z.boolean().optional(),
        ...references,
      },
    },
    (args) =>
      guarded(async () => {
        const resolved = await resolveReferenceFiles(client, referenceRequest(args));
        const log: string[] = [];
        const result = await runAb(
          client,
          {
            role: args.role,
            value: args.value,
            reason: args.reason,
            bars: args.bars,
            scene_id: args.scene_id,
            references: resolved.files,
            profile: args.profile ?? resolved.profile ?? undefined,
            mix_repair: args.mix_repair,
            allow_widen: args.allow_widen,
          },
          (line) => log.push(line),
        );
        return text(result.report, { kept: result.kept, captures: result.captures, checkpoint_id: result.checkpoint_id });
      }),
  );

  server.registerTool(
    'references',
    {
      title: 'Reference tracks',
      description:
        'List the named reference sets (sets), the genres in a library folder (genres), or pick references for ' +
        'a set or genre near the current tempo (pick).',
      inputSchema: {
        action: z.enum(['sets', 'genres', 'pick']),
        dir: z.string().optional(),
        ...references,
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        if (args.action === 'sets') return text(loadReferenceSets());
        if (args.action === 'genres') {
          const dir = args.dir ?? loadReferenceSets().library;
          if (!dir) throw new Error('Give dir, or set "library" in config/reference-sets.json.');
          return text(genreSummary(await scanLibrary(dir)));
        }
        const resolved = await resolveReferenceFiles(client, {
          ...referenceRequest(args),
          dir: args.references_dir ?? args.dir,
        });
        return text(resolved.describe.join('\n'), { files: resolved.files, profile: resolved.profile });
      }),
  );

  server.registerTool(
    'analyze_bass',
    {
      title: 'Analyse a bassline',
      description:
        'Describe a track\'s bass: 16-step rhythm and accents, pitches, root, register, sidechain duck depth and ' +
        'recovery, gate. Use it to match a reference bass the user likes.',
      inputSchema: { file: z.string(), bpm: z.number().positive().optional() },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        const profile = await analyzeBass(args.file, args.bpm ? { bpm: args.bpm } : {});
        return text(formatBassProfile(profile));
      }),
  );

  // -------------------------------------------------------------------------
  // Effects (EFFECTS.md)
  // -------------------------------------------------------------------------

  server.registerTool(
    'effects',
    {
      title: 'Effects codex',
      description:
        'Look up production effects (risers, filter sweeps, stutters, washouts...) by name or description: cue, ' +
        'mechanism, control law, energy function and whether Live can build it. Omit query to list them all.',
      inputSchema: {
        query: z.string().optional().describe('An id, alias or description, e.g. "roulette wheel slowing down"'),
        energy: z.string().optional().describe('Filter the list: accumulate, release, contrast, ...'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      guarded(async () => {
        if (args.query) return text(findEffect(args.query));
        const list = loadCodex()
          .effects.filter((e) => !args.energy || e.energy.includes(args.energy))
          .map((e) => ({ id: e.id, name: e.name, family: e.family, energy: e.energy, build: e.build.method }));
        return text(list);
      }),
  );

  server.registerTool(
    'apply_effect',
    {
      title: 'Build an effect',
      description:
        'Build a codex effect on a track from native devices, clip automation and generated MIDI, over a span ' +
        'of beats in a clip. Refuses effects Live cannot build through its API, with the reason.',
      inputSchema: {
        effect: z.string(),
        track_id: trackId,
        clip_slot: slot.optional(),
        start_beat: z.number().nonnegative().optional(),
        length_beats: z.number().positive().optional(),
        pitch: z.number().int().min(0).max(127).optional(),
        root: z.string().optional(),
        set: z.record(z.union([z.number(), z.string()])).optional().describe('Parameter overrides by name'),
        dry_run: z.boolean().optional(),
      },
    },
    (args) => guarded(async () => text(await applyEffect(client, args))),
  );

  server.registerTool(
    'identify_effect',
    {
      title: 'Identify an effect',
      description: 'Which codex effect an audio excerpt sounds like, from onset spacing, pitch and brightness trends.',
      inputSchema: {
        file: z.string(),
        start: z.number().nonnegative().optional(),
        duration: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => guarded(async () => text(await identifyEffect(args.file, args.start ?? 0, args.duration))),
  );

  // -------------------------------------------------------------------------
  // Arrangement (COMPOSITION.md, EDM-COMPOSITION.md)
  // -------------------------------------------------------------------------

  server.registerTool(
    'arrangement',
    {
      title: 'Arrangement',
      description:
        `Plan a full track from a style template (plan), or lay the Session loops in slot 0 onto the Arrangement ` +
        `following that plan (build). Roles come from track names or an explicit map. Styles: ${styleNames().join(', ')}.`,
      inputSchema: {
        action: z.enum(['plan', 'build']),
        style: z.string(),
        roles: z.array(z.string()).optional().describe('plan: which roles exist'),
        map: z.record(id).optional().describe('build: role -> track_id, e.g. {"kick": 12, "bass": 15}'),
        replace: z.boolean().optional().describe('build: clear existing Arrangement clips first'),
        dry_run: z.boolean().optional(),
      },
    },
    (args) =>
      guarded(async () => {
        if (args.action === 'plan') {
          const plan = planArrangement(args.style, args.roles ? { roles: args.roles } : {});
          return text(formatPlan(plan, checkArrangement(plan)));
        }
        const built = await buildArrangement(client, {
          style: args.style,
          map: args.map,
          replace: args.replace,
          dryRun: args.dry_run,
        });
        return text(formatPlan(built.plan, built.findings), {
          roles: built.roles,
          placed: built.placed,
          dry_run: built.dryRun,
        });
      }),
  );

  // -------------------------------------------------------------------------
  // Escape hatch
  // -------------------------------------------------------------------------

  server.registerTool(
    'bridge_command',
    {
      title: 'Bridge command',
      description:
        'Run any bridge command by name with validated args (see the troublemaker://commands resource), or a ' +
        '"transaction" of several. Use dry_run to see what would happen. Prefer the specific tools when one fits.',
      inputSchema: {
        command: z.string(),
        args: z.record(z.unknown()).optional(),
        dry_run: z.boolean().optional(),
      },
    },
    (args) => guarded(async () => text(await client.post(args.command, args.args ?? {}, { dryRun: args.dry_run }))),
  );

  // -------------------------------------------------------------------------
  // Prompts and resources
  // -------------------------------------------------------------------------

  const prompts: Array<[string, string, string]> = [
    ['system', 'system.md', 'Working rules for controlling Live: read first, snapshot, verify, report.'],
    ['music-editing', 'music-editing.md', 'How to turn musical language into note edits.'],
    ['composition', 'composition.md', 'Composition and arrangement practice (COMPOSITION.md, EDM-COMPOSITION.md).'],
    ['effects', 'effects.md', 'Production effects practice (EFFECTS.md).'],
    ['mastering', 'mastering.md', 'Club mastering practice (MIXING.md).'],
    ['drums', 'drums.md', '808/909 drum programming practice (DRUMS.md).'],
    ['chords', 'chords.md', 'Chord progressions and voice leading (CHORDS.md).'],
    ['edm-tips', 'edm-tips.md', 'EDM Tips decision trees, guardrails and QA (EDM-TIPS.md).'],
    ['basslines', 'basslines.md', 'Bassline writing, kick/bass and low-end practice (BASSLINES.md).'],
  ];
  for (const [name, file, description] of prompts) {
    const path = join(ROOT, 'agent', 'prompts', file);
    server.registerPrompt(name, { title: name, description }, () => ({
      messages: [{ role: 'user', content: { type: 'text', text: readFileSync(path, 'utf8') } }],
    }));
    server.registerResource(
      `prompt-${name}`,
      `troublemaker://prompts/${name}`,
      { title: `${name} guide`, description, mimeType: 'text/markdown' },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(path, 'utf8') }] }),
    );
  }

  const files: Array<[string, string, string]> = [
    ['effects-codex', 'agent/knowledge/effects.json', 'The 34-effect codex with Live recipes.'],
    ['styles', 'agent/knowledge/styles.json', 'Arrangement style templates.'],
    ['chord-progressions', 'agent/knowledge/chord-progressions.json', 'CHORDS.md progression templates H01-H08.'],
    ['bass-patterns', 'agent/knowledge/bass-patterns.json', 'BASSLINES.md pattern library and checks.'],
    ['drum-patterns', 'agent/knowledge/drum-patterns.json', 'DRUMS.md genre grids, velocity tiers, A/A\'/B/F phrase.'],
    ['reference-sets', 'config/reference-sets.json', 'Named reference-track sets and their profiles.'],
  ];
  for (const [name, file, description] of files) {
    server.registerResource(
      name,
      `troublemaker://${name}`,
      { title: name, description, mimeType: 'application/json' },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: readFileSync(join(ROOT, file), 'utf8') }] }),
    );
  }
  server.registerResource(
    'commands',
    'troublemaker://commands',
    { title: 'Bridge commands', description: 'Every bridge command with its summary.', mimeType: 'application/json' },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(COMMANDS, null, 2) }] }),
  );

  return server;
}
