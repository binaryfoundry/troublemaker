/**
 * The track audit from AGENTS.md (*Auditing a track*), as far as it can be
 * measured from the Arrangement's notes. Each step reports what it measured
 * and lists, as manual, what still needs a capture or an ear - so a step is
 * never marked done on evidence it does not have.
 *
 *  1 arrangement hygiene        7 bass and the low end (MIDI half)
 *  2 DJ intro and outro         8 automation          (manual: capture)
 *  3 rubs, harmony and ranges   9 emotion
 *  4 groove                    10 mix                 (manual: capture, QC)
 *  5 hook                      11 finish              (manual: NEW_TRACK)
 *  6 lead numbers
 *
 * Pure: it reads a Timeline (agent/src/timeline.ts); gathering one from Live
 * is `auditTrack` in bridge/src/workflows.ts.
 */

import type { Note } from '../../bridge/src/protocol.js';
import { checkLeadNumbers, type LeadCheck } from './camelphat.js';
import { checkChords, type VoicedChord } from './chords.js';
import { checkEmotion, type BlockFeatures } from './emotion.js';
import { checkGroove, type GrooveProfile } from './groove.js';
import { checkHook, summariseBars, type HookMap } from './hooks.js';
import { checkInstrumentRange, orchestralKnowledge } from './orchestral.js';
import { activitySpans, barOf, type Timeline, type TimelineNote, type TimelineTrack } from './timeline.js';

export type Severity = 'fail' | 'warn' | 'info';
export type StepStatus = 'PASS' | 'REVIEW' | 'FAIL' | 'MANUAL';

export interface AuditFinding {
  severity: Severity;
  message: string;
}

export interface AuditStep {
  step: number;
  name: string;
  guides: string;
  status: StepStatus;
  summary: string;
  findings: AuditFinding[];
  /** What this step still needs that notes cannot show. */
  manual: string[];
}

export interface AuditOptions {
  /** The primary hook's track name. Without it the hook step only runs if exactly one lead-role track exists. */
  hook?: string;
  /** The emotional peak, in bars; otherwise the 16 bars with the most layers. */
  peak?: { from: number; to: number };
  /** Track name -> orchestral instrument (orchestral.json), where the name does not say. */
  instruments?: Record<string, string>;
  /** Bars free of pitched material at each end (default 16). */
  pitchFreeBars?: number;
  /** Beat-led bars at each end (default 32). */
  djBars?: number;
  date?: string;
  title?: string;
  tempo?: number;
}

export interface AuditReport {
  title: string;
  date: string;
  tempo: number | null;
  bars: number;
  steps: AuditStep[];
  groove: GrooveProfile[];
  hook: HookMap | null;
  leads: Array<{ track: string; bars: string; checks: LeadCheck[] }>;
  blocks: BlockFeatures[];
  peak: { from: number; to: number };
}

const THIRTY_SECOND = 0.125;

function statusOf(findings: AuditFinding[], measured = true): StepStatus {
  if (!measured) return 'MANUAL';
  if (findings.some((f) => f.severity === 'fail')) return 'FAIL';
  if (findings.some((f) => f.severity === 'warn')) return 'REVIEW';
  return 'PASS';
}

const drums = (t: TimelineTrack) => !t.pitched;
const bars = (timeline: Timeline, beat: number) => barOf(timeline, beat);

// ---------------------------------------------------------------------------
// 1. Arrangement hygiene
// ---------------------------------------------------------------------------

const noteKey = (n: { pitch: number; start: number; duration: number }) =>
  `${n.pitch}@${Math.round(n.start * 1000)}/${Math.round(n.duration * 1000)}`;

export function checkHygiene(timeline: Timeline): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const track of timeline.tracks) {
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      const offset = clip.start % timeline.beatsPerBar;
      if (Math.abs(offset) > 1e-3 && Math.abs(offset - timeline.beatsPerBar) > 1e-3) {
        findings.push({
          severity: 'fail',
          message: `${track.name}: clip "${clip.name}" starts at beat ${clip.start} (bar ${bars(timeline, clip.start)} + ${round(offset)} beats), off the bar grid.`,
        });
      }
      if (/\bref\b/i.test(clip.name)) {
        findings.push({ severity: 'fail', message: `${track.name}: a "${clip.name}" clip at bar ${bars(timeline, clip.start)} - a stray reference clip?` });
      }
    }
    for (let i = 1; i < clips.length; i += 1) {
      if (clips[i]!.start < clips[i - 1]!.end - 1e-3) {
        findings.push({
          severity: 'warn',
          message: `${track.name}: clips "${clips[i - 1]!.name}" and "${clips[i]!.name}" overlap at bar ${bars(timeline, clips[i]!.start)}.`,
        });
      }
    }
    // Arrangement copies against the Session clip they share a name with.
    const byName = new Map<string, Note[]>();
    for (const s of track.session) if (!byName.has(s.name)) byName.set(s.name, s.notes);
    const differing: number[] = [];
    for (const clip of track.clips) {
      const source = clip.is_midi_clip && clip.notes ? byName.get(clip.name) : undefined;
      if (!source) continue;
      const a = clip.notes!.filter((n) => !n.mute).map(noteKey).sort().join(',');
      const b = source.filter((n) => !n.mute).map(noteKey).sort().join(',');
      if (a !== b) differing.push(bars(timeline, clip.start));
    }
    if (differing.length) {
      findings.push({
        severity: 'warn',
        message: `${track.name}: Arrangement copies at ${summariseBars(differing)} differ from their Session clip. Intended Arrangement-only edits, or a stale copy? Fix in place (re-placing overwrites Arrangement edits).`,
      });
    }
  }
  if (timeline.lengthBeats % timeline.beatsPerBar > 1e-3) {
    findings.push({ severity: 'warn', message: `The Arrangement ends at beat ${timeline.lengthBeats}, not on a bar line.` });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 2. DJ intro and outro
// ---------------------------------------------------------------------------

export function checkDjEnds(timeline: Timeline, options: { pitchFreeBars?: number; djBars?: number } = {}): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const free = options.pitchFreeBars ?? 16;
  const dj = options.djBars ?? 32;
  const last = timeline.bars;

  // No pitched material in the first or last 16 bars.
  for (const track of timeline.tracks.filter((t) => t.pitched)) {
    const early = track.notes.filter((n) => bars(timeline, n.start) <= free);
    const late = track.notes.filter((n) => bars(timeline, n.start) > last - free);
    if (early.length) {
      findings.push({ severity: 'fail', message: `${track.name}: pitched notes in the first ${free} bars (from bar ${bars(timeline, early[0]!.start)}). The DJ mixes over the neighbouring record here.` });
    }
    if (late.length) {
      findings.push({ severity: 'fail', message: `${track.name}: pitched notes in the last ${free} bars (until bar ${bars(timeline, late.at(-1)!.start)}).` });
    }
    const audio = track.clips.filter((c) => !c.is_midi_clip && (bars(timeline, c.start) <= free || bars(timeline, c.end - 1e-3) > last - free));
    if (audio.length) {
      findings.push({ severity: 'warn', message: `${track.name}: an audio clip within the first or last ${free} bars (bar ${bars(timeline, audio[0]!.start)}); its pitch is invisible to this check - listen or capture.` });
    }
  }

  // Beat-led: a kick on every beat through the first and last 32 bars.
  const kicks = timeline.tracks.filter((t) => t.role === 'kick');
  if (!kicks.length) {
    findings.push({ severity: 'warn', message: 'No kick track recognised by name; the beat-led check needs one (pass roles to name it).' });
  } else {
    const beats = new Set(kicks.flatMap((t) => t.notes.map((n) => Math.round(n.start * 4) / 4)));
    const missing = new Set<number>();
    for (const [from, to] of [[1, Math.min(dj, last)], [Math.max(1, last - dj + 1), last]] as const) {
      for (let bar = from; bar <= to; bar += 1) {
        for (let b = 0; b < timeline.beatsPerBar; b += 1) {
          if (!beats.has((bar - 1) * timeline.beatsPerBar + b)) missing.add(bar);
        }
      }
    }
    if (missing.size) {
      findings.push({ severity: 'fail', message: `Bars without a kick on every beat inside the DJ intro/outro: ${summariseBars([...missing].sort((a, b) => a - b))}.` });
    }
  }

  // Changes on 8-bar lines; spans shorter than 8 bars are fills and transitions.
  const onLine = (bar: number, size: number) => (bar - 1) % size === 0 || bar % size === 0;
  for (const track of timeline.tracks) {
    for (const span of activitySpans(timeline, track, 4)) {
      if (span.to - span.from + 1 < 8) continue;
      if (!onLine(span.from, 8)) findings.push({ severity: 'warn', message: `${track.name} enters at bar ${span.from}, off the 8-bar grid.` });
      if (!onLine(span.to, 8) && span.to !== last) findings.push({ severity: 'warn', message: `${track.name} leaves after bar ${span.to}, off the 8-bar grid.` });
    }
  }

  // The bass in and out on a 16-bar line; outro order melodic -> bass -> drums.
  const bass = timeline.tracks.filter((t) => t.role === 'bass' && t.notes.length);
  const lastOnset = (ts: TimelineTrack[]) => Math.max(0, ...ts.flatMap((t) => t.notes.map((n) => bars(timeline, n.start))));
  for (const t of bass) {
    const spans = activitySpans(timeline, t, 4);
    const first = spans[0], end = spans.at(-1);
    if (first && !onLine(first.from, 16)) findings.push({ severity: 'warn', message: `${t.name} first enters at bar ${first.from}, not on a 16-bar line (the DJ's bass swap).` });
    if (end && !onLine(end.to, 16) && end.to !== last) findings.push({ severity: 'warn', message: `${t.name} leaves after bar ${end.to}, not on a 16-bar line.` });
  }
  const melodic = timeline.tracks.filter((t) => t.pitched && t.role !== 'bass' && t.notes.length);
  const drumTracks = timeline.tracks.filter((t) => drums(t) && t.notes.length);
  if (bass.length && melodic.length && lastOnset(melodic) > lastOnset(bass)) {
    findings.push({ severity: 'warn', message: `Melodic parts play until bar ${lastOnset(melodic)}, after the bass leaves (bar ${lastOnset(bass)}). Outro order: melodic layers out, then bass, then percussion.` });
  }
  if (bass.length && drumTracks.length && lastOnset(bass) > lastOnset(drumTracks)) {
    findings.push({ severity: 'warn', message: `The bass plays until bar ${lastOnset(bass)}, after the drums stop (bar ${lastOnset(drumTracks)}).` });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Rubs, harmony and ranges
// ---------------------------------------------------------------------------

export interface Rub {
  a: string;
  b: string;
  bar: number;
  pitches: [number, number];
  overlap: number;
}

/**
 * Semitone and minor-ninth (and compound) overlaps between different pitched
 * parts, longer than a 32nd. A written, resolving appoggiatura is allowed;
 * telling one apart needs the score, so every rub is listed.
 */
export function findRubs(timeline: Timeline): Rub[] {
  const notes = timeline.tracks
    .filter((t) => t.pitched)
    .flatMap((t) => t.notes.map((n) => ({ ...n, track: t.name })))
    .sort((a, b) => a.start - b.start);
  const rubs: Rub[] = [];
  let active: typeof notes = [];
  for (const n of notes) {
    active = active.filter((a) => a.start + a.duration > n.start + 1e-6);
    for (const a of active) {
      if (a.track === n.track || Math.abs(a.pitch - n.pitch) % 12 !== 1) continue;
      const overlap = Math.min(a.start + a.duration, n.start + n.duration) - n.start;
      if (overlap > THIRTY_SECOND + 1e-6) {
        rubs.push({ a: a.track, b: n.track, bar: barOf(timeline, n.start), pitches: [a.pitch, n.pitch], overlap: round(overlap) });
      }
    }
    active.push(n);
  }
  return rubs;
}

function rubFindings(rubs: Rub[]): AuditFinding[] {
  const pairs = new Map<string, Rub[]>();
  for (const r of rubs) {
    const key = [r.a, r.b].sort().join(' / ');
    pairs.set(key, [...(pairs.get(key) ?? []), r]);
  }
  return [...pairs.entries()]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([pair, list]) => {
      const longest = [...list].sort((x, y) => y.overlap - x.overlap)[0]!;
      return {
        severity: 'warn' as const,
        message: `${pair}: ${list.length} semitone/minor-ninth overlap${list.length === 1 ? '' : 's'} longer than a 32nd, at ${summariseBars([...new Set(list.map((r) => r.bar))])}; longest ${longest.overlap} beats (MIDI ${longest.pitches[0]} against ${longest.pitches[1]}, bar ${longest.bar}). Resolving appoggiatura, or a clash?`,
      };
    });
}

/** Chord parts, one check per distinct clip: voicings from notes that start together. */
export function checkHarmony(timeline: Timeline): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const track of timeline.tracks.filter((t) => t.pitched && t.role === 'chords')) {
    const seen = new Map<string, number[]>();
    track.clips.forEach((clip, index) => {
      const notes = track.notes.filter((n) => n.clip === index);
      const voicings = voicingsOf(timeline, notes);
      if (voicings.length < 2) return;
      const key = voicings.map((v) => v.pitches.join('.')).join('|');
      seen.set(key, [...(seen.get(key) ?? []), barOf(timeline, clip.start)]);
      if ((seen.get(key) ?? []).length > 1) return;
      for (const f of checkChords(voicings)) {
        findings.push({ severity: f.severity, message: `${track.name} (clip at bar ${barOf(timeline, clip.start)}): ${f.message}` });
      }
    });
  }
  return findings;
}

function voicingsOf(timeline: Timeline, notes: TimelineNote[]): VoicedChord[] {
  const groups = new Map<number, number[]>();
  for (const n of notes) {
    const at = Math.round(n.start * 4) / 4;
    groups.set(at, [...(groups.get(at) ?? []), n.pitch]);
  }
  const out: VoicedChord[] = [];
  for (const [beat, pitches] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...new Set(pitches)].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    const previous = out.at(-1);
    if (previous && previous.pitches.join('.') === sorted.join('.')) continue;
    out.push({ symbol: `bar ${barOf(timeline, beat)}`, pitches: sorted, beat, beats: 0 });
  }
  return out;
}

const INSTRUMENT_NAMES: Array<[RegExp, string]> = [
  [/\bpiccolo\b/i, 'piccolo'],
  [/\b(english horn|cor anglais)\b/i, 'english_horn'],
  [/\bbass clarinet\b/i, 'bass_clarinet'],
  [/\bcontrabassoon\b/i, 'contrabassoon'],
  [/\bbass trombone\b/i, 'bass_trombone'],
  [/\b(double ?bass(es)?|contrabass(es)?|string bass)\b/i, 'double_bass'],
  [/\b(violins?|vln?s?)\b/i, 'violin'],
  [/\b(violas?|vla)\b/i, 'viola'],
  [/\b(cellos?|celli|vc)\b/i, 'cello'],
  [/\bflutes?\b/i, 'flute'],
  [/\boboes?\b/i, 'oboe'],
  [/\bclarinets?\b/i, 'clarinet'],
  [/\bbassoons?\b/i, 'bassoon'],
  [/\b(french )?horns?\b/i, 'horn'],
  [/\btrumpets?\b/i, 'trumpet'],
  [/\btrombones?\b/i, 'trombone'],
  [/\btubas?\b/i, 'tuba'],
];

export function instrumentFor(name: string, explicit: Record<string, string> = {}): string | null {
  if (explicit[name]) return explicit[name]!;
  for (const [pattern, instrument] of INSTRUMENT_NAMES) if (pattern.test(name)) return instrument;
  return null;
}

export function checkRanges(timeline: Timeline, instruments: Record<string, string> = {}): AuditFinding[] {
  const known = orchestralKnowledge().instruments;
  const findings: AuditFinding[] = [];
  for (const track of timeline.tracks.filter((t) => t.pitched && t.notes.length)) {
    const instrument = instrumentFor(track.name, instruments);
    if (!instrument || !known[instrument]) {
      if (/\b(strings?|spiccato|pizz(icato)?|staccato|brass|winds?|orchestra|ensemble|section)\b/i.test(track.name)) {
        findings.push({ severity: 'info', message: `${track.name}: an orchestral part with no single instrument in its name; pass instruments to range-check it (MIDI ${Math.min(...track.notes.map((n) => n.pitch))}-${Math.max(...track.notes.map((n) => n.pitch))}).` });
      }
      continue;
    }
    const out = checkInstrumentRange(instrument, track.notes.map((n) => n.pitch));
    if (out.length) {
      findings.push({ severity: 'warn', message: `${track.name} (${instrument}): ${out.length} pitch${out.length === 1 ? '' : 'es'} outside its practical range - ${out.slice(0, 3).map((f) => f.message.replace(`${instrument}: `, '')).join(' ')}` });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 7. Bass and the low end (the part the notes show)
// ---------------------------------------------------------------------------

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function checkLowEnd(timeline: Timeline): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const kickBeats = new Set(timeline.tracks.filter((t) => t.role === 'kick').flatMap((t) => t.notes.map((n) => Math.round(n.start * 4) / 4)));
  const bass = timeline.tracks.filter((t) => t.role === 'bass' && t.notes.length);
  for (const t of bass) {
    const onKick = t.notes.filter((n) => kickBeats.has(Math.round(n.start * 4) / 4)).length;
    const share = onKick / t.notes.length;
    if (kickBeats.size && share >= 0.25) {
      findings.push({ severity: 'info', message: `${t.name}: ${Math.round(share * 100)} % of its notes start on a kick. The rolling default (*Basslines*) never plays on the kick; if this bass is meant to be another kind, that is the user's call.` });
    }
    const low = t.notes.filter((n) => hz(n.pitch) < 35);
    if (low.length) {
      const lowest = Math.min(...low.map((n) => n.pitch));
      findings.push({ severity: 'warn', message: `${t.name}: ${low.length} notes below ~35 Hz (lowest MIDI ${lowest}, ${hz(lowest).toFixed(1)} Hz). On Threshold notes this low overshot the 31.5 Hz band by 11-14 dB; choose the octave by measurement against the references.` });
    }
  }
  if (bass.length) {
    const bassNotes = bass.flatMap((t) => t.notes);
    for (const t of timeline.tracks.filter((x) => x.pitched && x.role !== 'bass' && x.notes.length)) {
      const deep = t.notes.filter((n) => n.pitch < 46 && bassNotes.some((b) => b.start < n.start + n.duration && b.start + b.duration > n.start));
      if (deep.length) {
        findings.push({ severity: 'info', message: `${t.name}: ${deep.length} notes below ~120 Hz while the bass plays. LOW_END: the low end is owned by one part at a time.` });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

function chooseHook(timeline: Timeline, name?: string): { track: TimelineTrack | null; note: string } {
  if (name) {
    const track = timeline.tracks.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null;
    return { track, note: track ? `hook: ${track.name} (given)` : `no track named "${name}"` };
  }
  const leads = timeline.tracks.filter((t) => t.role === 'lead' && t.notes.length);
  if (leads.length === 1) return { track: leads[0]!, note: `hook: ${leads[0]!.name} (the only lead-role track; name it to be sure)` };
  return {
    track: null,
    note: leads.length ? `${leads.length} lead-role tracks (${leads.map((t) => t.name).join(', ')}); name the primary hook` : 'no lead-role track; name the primary hook',
  };
}

export function auditTimeline(timeline: Timeline, options: AuditOptions = {}): AuditReport {
  const steps: AuditStep[] = [];
  const add = (step: Omit<AuditStep, 'status'> & { measured?: boolean }) =>
    steps.push({ ...step, status: statusOf(step.findings, step.measured ?? true) });

  const hygiene = checkHygiene(timeline);
  add({
    step: 1, name: 'Arrangement hygiene', guides: 'AGENTS.md audit 1', findings: hygiene,
    summary: `${timeline.tracks.reduce((n, t) => n + t.clips.length, 0)} Arrangement clips on ${timeline.tracks.length} tracks`,
    manual: timeline.tracks.some((t) => t.wrapped) ? ['Some clips loop or start from a marker; their notes were placed by Live\'s marker semantics - spot-check one in Live.'] : [],
  });

  const dj = checkDjEnds(timeline, options);
  add({
    step: 2, name: 'DJ intro and outro', guides: 'AGENTS.md *DJ intro and outro*', findings: dj,
    summary: `${timeline.bars} bars; pitch-free ${options.pitchFreeBars ?? 16} bars and beat-led ${options.djBars ?? 32} bars each end`,
    manual: ['The sub waits for the intro\'s build to finish; nothing stops abruptly (fades of at least 8 bars) - check by ear or capture.'],
  });

  const rubs = findRubs(timeline);
  const harmony = checkHarmony(timeline);
  const ranges = checkRanges(timeline, options.instruments);
  add({
    step: 3, name: 'Rubs, harmony and ranges', guides: 'AGENTS.md audit 3; CHORDS.md 8, 68, 69, 76; ORCHESTRAL.md 21',
    findings: [...rubFindings(rubs), ...harmony, ...ranges],
    summary: `${plural(rubs.length, 'rub')} between parts; ${plural(harmony.length, 'chord finding')}; ${plural(ranges.length, 'range finding')}`,
    manual: [],
  });

  const groove = checkGroove(timeline);
  const grooveLayers = groove.profiles.filter((p) => p.role === 'groove').map((p) => p.track);
  add({
    step: 4, name: 'Groove', guides: 'GROOVE.md 9, 15, 22, 26', findings: groove.findings,
    summary: `groove layers: ${grooveLayers.join(', ') || 'none'}`,
    manual: ['Synced LFOs that syncopate (a 3/16 filter LFO) count as groove layers too - list them by hand.', 'GROOVE 26: the groove survives at low volume and in the full mix (listening).'],
  });

  const chosen = chooseHook(timeline, options.hook);
  const hook = chosen.track ? checkHook(timeline, chosen.track) : null;
  add({
    step: 5, name: 'Hook', guides: 'HOOKS.md 11, 12, 18, 41, 42', findings: hook?.findings ?? [],
    measured: Boolean(hook),
    summary: hook ? `${chosen.note}; first full at bar ${hook.map.firstFull}, removed at ${hook.map.removedAt ?? '-'}, returns at ${hook.map.returnsAt ?? '-'}; nucleus ${hook.map.nucleusBars ? plural(hook.map.nucleusBars, 'bar') : 'over 4 bars'}` : chosen.note,
    manual: [
      'Name the primary hook in one sentence and classify every other part (secondary, support, texture, transition) - HOOKS 9, 42.',
      'Measure it in context: the hook, the rest and each competitor captured alone, compared in its bands.',
      'Score /40 (HOOKS 31) without inflation; hum-back and one-finger tests are the user\'s (13, 14).',
    ],
  });

  const leads: AuditReport['leads'] = [];
  const leadFindings: AuditFinding[] = [];
  for (const track of timeline.tracks.filter((t) => t.role === 'lead' && t.notes.length)) {
    const seen = new Set<string>();
    track.clips.forEach((clip, index) => {
      const notes = (clip.notes ?? []).filter((n) => !n.mute);
      const key = notes.map(noteKey).sort().join(',');
      if (!notes.length || seen.has(key)) return;
      seen.add(key);
      const checks = checkLeadNumbers(notes, timeline.beatsPerBar);
      const range = `bar ${barOf(timeline, clip.start)}`;
      leads.push({ track: track.name, bars: range, checks });
      const failed = checks.filter((c) => !c.pass);
      if (failed.length) {
        leadFindings.push({ severity: 'warn', message: `${track.name} (clip at ${range}, index ${index}): ${failed.map((c) => `${c.check} ${c.value} (pass: ${c.rule})`).join('; ')}.` });
      }
    });
  }
  add({
    step: 6, name: 'Lead numbers', guides: 'CAMELPHAT.md 6', findings: leadFindings, measured: leads.length > 0,
    summary: leads.length ? `${plural(leads.length, 'distinct lead clip')} measured` : 'no lead-role track',
    manual: ['Expression: does velocity reach the sound, does the filter move within the note and across the phrase? Verify velocity on an unducked probe track.'],
  });

  const low = checkLowEnd(timeline);
  add({
    step: 7, name: 'Bass and the low end', guides: '*Basslines*; LOW_END.md 7, 17, 19', findings: low,
    summary: plural(timeline.tracks.filter((t) => t.role === 'bass').length, 'bass-role track'),
    manual: [
      'Capture in mono below 120 Hz against references chosen by low-end likeness (`references`, `analyze_bass`): low-end share, beat profile, bar-to-bar level, mono correlation, 120-400 Hz harmonics against the sub.',
      'Phase: kick, sub and bass captured together against the power sum of each alone (LOW_END 9).',
      'Sub decisions are measured, not heard (the user monitors on headphones).',
    ],
  });

  add({
    step: 8, name: 'Automation', guides: 'AGENTS.md audit 8', findings: [], measured: false,
    summary: 'needs a capture',
    manual: ['After `live.re_enable_automation`, capture each automated entrance and read it in 30 ms windows; a seed blip shows as a full-level first window. Do not trust value_at_start or a beat-0 read.'],
  });

  const emotion = checkEmotion(timeline, { peak: options.peak, introBars: options.djBars, outroBars: options.djBars });
  add({
    step: 9, name: 'Emotion', guides: 'EMOTION.md 53, 55, 56; NEW-TRACK-DETAILED.md 22', findings: emotion.findings,
    summary: `peak taken as bars ${emotion.peak.from}-${emotion.peak.to}${options.peak ? '' : ' (most layers; pass the real one)'}`,
    manual: ['One surprise per section (EMOTION 54) and the emotional sentence and arc (3, 4) are judgement.'],
  });

  add({
    step: 10, name: 'Mix', guides: 'MIXING.md; LOW_END.md 14', findings: [], measured: false,
    summary: 'needs captures and QC',
    manual: ['Soloed balance against the kick with master dynamics bypassed (probe faders down), then `qc` against the reference. Make room before raising a fader. Decide the low end in full context last.'],
  });
  add({
    step: 11, name: 'Finish', guides: 'NEW_TRACK.md', findings: [], measured: false,
    summary: 'the 10-category audit /100 and the Professional Finish Report',
    manual: ['Score without inflation; report failures first.'],
  });

  return {
    title: options.title ?? 'Track audit',
    date: options.date ?? new Date().toISOString().slice(0, 10),
    tempo: options.tempo ?? null,
    bars: timeline.bars,
    steps,
    groove: groove.profiles,
    hook: hook?.map ?? null,
    leads,
    blocks: emotion.blocks,
    peak: emotion.peak,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Which tracks play in each 8-bar block: the arrangement map. */
export function arrangementMap(timeline: Timeline, size = 8): string {
  const blocks = Math.ceil(timeline.bars / size);
  const width = Math.min(24, Math.max(5, ...timeline.tracks.map((t) => t.name.length)));
  const header = ' '.repeat(width + 1) + Array.from({ length: blocks }, (_, i) => (i % 4 === 0 ? String(i * size + 1).padEnd(4) : '')).join('').trimEnd();
  const rows = timeline.tracks.map((t) => {
    const cells = Array.from({ length: blocks }, (_, i) => {
      const from = i * size * timeline.beatsPerBar, to = from + size * timeline.beatsPerBar;
      const midi = t.notes.some((n) => n.start >= from && n.start < to);
      const audio = t.clips.some((c) => !c.is_midi_clip && c.start < to && c.end > from);
      return midi ? '#' : audio ? '~' : '.';
    });
    return `${t.name.slice(0, width).padEnd(width)} ${cells.join('')}`;
  });
  return [header, ...rows].join('\n');
}

export function formatAuditReport(report: AuditReport, timeline: Timeline, options: { maxFindings?: number } = {}): string {
  const max = options.maxFindings ?? 12;
  const lines: string[] = [];
  lines.push(`## Audit ${report.date}: ${report.title}`, '');
  lines.push(`${report.bars} bars${report.tempo ? ` at ${report.tempo} BPM` : ''}.`, '');
  lines.push('Measured by `audit` from the Arrangement\'s notes. MANUAL steps and the manual items under each step still need a capture or an ear.', '');
  lines.push('| # | Check | Result | Summary |', '|---|---|---|---|');
  for (const s of report.steps) lines.push(`| ${s.step} | ${s.name} | ${s.status} | ${s.summary} |`);
  lines.push('');
  // Failures first, as AGENTS.md asks.
  const order: Record<StepStatus, number> = { FAIL: 0, REVIEW: 1, PASS: 2, MANUAL: 3 };
  for (const s of [...report.steps].sort((a, b) => order[a.status] - order[b.status] || a.step - b.step)) {
    lines.push(`### ${s.step}. ${s.name} - ${s.status}`, '', `Guides: ${s.guides}.`, '');
    const ranked = [...s.findings].sort((a, b) => rank(a.severity) - rank(b.severity));
    for (const f of ranked.slice(0, max)) lines.push(`- [${f.severity}] ${f.message}`);
    if (ranked.length > max) lines.push(`- ... and ${ranked.length - max} more.`);
    for (const m of s.manual) lines.push(`- [manual] ${m}`);
    if (s.step === 4 && report.groove.length) {
      lines.push('', '| Part | Role | Displaced bars | Dotted gaps | On the beat | Gate |', '|---|---|---|---|---|---|');
      for (const g of report.groove) lines.push(`| ${g.track} | ${g.role} | ${pct(g.syncopatedShare)} | ${pct(g.dottedShare)} | ${pct(g.onBeatShare)} | ${g.gate ?? '-'} |`);
    }
    if (s.step === 5 && report.hook) {
      const h = report.hook;
      lines.push('', '```text', `HOOK: ${h.track}`, `FIRST HINT: bar ${h.firstHint ?? '-'}`, `FIRST FULL APPEARANCE: bar ${h.firstFull ?? '-'}`,
        `REMOVED AT: ${h.removedAt ? `bar ${h.removedAt}` : 'never'}`, `RETURNS AT: ${h.returnsAt ? `bar ${h.returnsAt}` : '-'}`,
        `PLAYS: ${h.spans.map((x) => `${x.from}-${x.to}`).join(', ')}`, `NUCLEUS: ${h.nucleusBars ?? '> 4'} bars; identity per return ${h.identity === null ? '-' : pct(h.identity)}`, '```');
    }
    if (s.step === 6 && report.leads.length) {
      for (const lead of report.leads) {
        lines.push('', `${lead.track}, clip at ${lead.bars}:`, '', '| Check | Value | Pass |', '|---|---|---|');
        for (const c of lead.checks) lines.push(`| ${c.check} | ${c.value} | ${c.pass ? 'yes' : `**no** (${c.rule})`} |`);
      }
    }
    lines.push('');
  }
  lines.push('### Arrangement map (8-bar blocks; # notes, ~ audio clip)', '', '```text', arrangementMap(timeline), '```', '');
  return lines.join('\n');
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const rank = (s: Severity) => (s === 'fail' ? 0 : s === 'warn' ? 1 : 2);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const round = (x: number) => Math.round(x * 1000) / 1000;
