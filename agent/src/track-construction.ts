/**
 * NEW-TRACK-DETAILED.md as code: the agent contract (every production action
 * names its target, location, edit, starting value, expected effect and
 * pass/fail test), the seven validation passes, the failure modes, and the
 * translation from a vague request to something executable.
 *
 * The document is a procedure. Nothing here decides a musical question
 * another guide owns, or settles a conflict between guides - that is the
 * user's call; it only refuses a hand-wave.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface TrackAction {
  target: string;
  location: string;
  edit: string;
  starting_value: string;
  expected_effect: string;
  test: string;
}

export interface ValidationPass {
  id: string;
  section: string;
  checks: string[];
}

export interface FailureMode {
  id: string;
  section: string;
  problem: string;
  fix: string;
}

export interface TrackConstructionKnowledge {
  source: string;
  action_fields: Array<{ field: keyof TrackAction; section: number; question: string }>;
  banned_instructions: string[];
  order_of_work: string[];
  validation_passes: ValidationPass[];
  failure_modes: FailureMode[];
  translation_table: Array<{ vague: string; action: string }>;
  minimum_viable_track: string[];
  fx_budget_per_8_bars: { section: number; transition_events: number; micro_variations: number; note: string };
  eight_bar_change_rule: { section: number; kinds: string[]; note: string };
}

const PATH = fileURLToPath(new URL('../knowledge/track-construction.json', import.meta.url));
let cached: TrackConstructionKnowledge | null = null;

export function trackConstructionKnowledge(): TrackConstructionKnowledge {
  if (!cached) cached = JSON.parse(readFileSync(PATH, 'utf8')) as TrackConstructionKnowledge;
  return cached;
}

export interface ActionFinding {
  severity: 'warn';
  field: keyof TrackAction | 'instruction';
  message: string;
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Section 1: an action missing any of the six fields is an observation, not an
 * instruction. A field whose text is one of the document's banned phrasings is
 * reported too, with the translation where the table has one.
 */
export function checkAction(action: Partial<TrackAction>): ActionFinding[] {
  const k = trackConstructionKnowledge();
  const findings: ActionFinding[] = [];
  for (const { field, question } of k.action_fields) {
    const value = action[field];
    if (value === undefined || value.trim() === '') {
      findings.push({ severity: 'warn', field, message: `${field} is missing: ${question}` });
    }
  }
  for (const value of Object.values(action)) {
    if (typeof value !== 'string') continue;
    const text = normalise(value);
    const banned = k.banned_instructions.find((b) => text === b || text.includes(b));
    if (banned) {
      const translation = translateRequest(banned);
      findings.push({
        severity: 'warn',
        field: 'instruction',
        message: translation
          ? `"${banned}" is an observation, not an action: ${translation}.`
          : `"${banned}" is an observation, not an action; say what changes, where, to what value, and how it is judged.`,
      });
    }
  }
  return findings;
}

/** Whether every word of `phrase` appears in `text`, in order ("add groove" matches "add some groove"). */
function containsInOrder(text: string, phrase: string): boolean {
  const words = text.split(' ');
  let at = 0;
  for (const word of phrase.split(' ')) {
    at = words.indexOf(word, at) + 1;
    if (at === 0) return false;
  }
  return true;
}

/** Section 42: the executable form of a vague request, when the table has one. */
export function translateRequest(request: string): string | null {
  const text = normalise(request);
  const hits = trackConstructionKnowledge().translation_table.filter((r) => containsInOrder(text, normalise(r.vague)));
  // The most specific row wins when several match.
  const best = hits.sort((a, b) => b.vague.length - a.vague.length)[0];
  return best ? best.action : null;
}

/** Section 39: the seven passes, in the order the document runs them. */
export function validationPasses(): ValidationPass[] {
  return trackConstructionKnowledge().validation_passes;
}

/** Section 43: what this project keeps getting wrong. */
export function failureModes(): FailureMode[] {
  return trackConstructionKnowledge().failure_modes;
}

/**
 * Section 44: a track is not complete because it has many channels. Returns
 * the roles still missing from the ones a track claims to have.
 */
export function missingFromMinimumTrack(roles: string[]): string[] {
  const have = new Set(roles.map(normalise));
  return trackConstructionKnowledge().minimum_viable_track.filter((role) => !have.has(normalise(role)));
}
