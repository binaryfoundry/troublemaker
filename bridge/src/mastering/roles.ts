/**
 * Master-chain roles and their safe ranges.
 *
 * A role is a named job ("limiter_ceiling") that maps onto whichever device
 * parameter does it in the current Set. The agent addresses roles, never raw
 * parameter ids, and every numeric role carries a hard range in engineering
 * units (dB, ms, Hz, %). That is MIXING.md's "restrict the range" trick: a
 * mastering agent does not need +/-15 dB of shelf gain, so it never gets it.
 *
 * Parameter names list Live 12 names first and Live 11 names as fallbacks;
 * both were read from the real devices, not guessed.
 */

export type Unit = 'dB' | 'ms' | 'Hz' | '%' | 'ratio';

interface RoleBase {
  role: string;
  /** Live device class_names that can provide this role, in preference order. */
  deviceClasses: string[];
  /** Candidate parameter names, matched case-insensitively. */
  parameterNames: string[];
  description: string;
}

export interface NumericRole extends RoleBase {
  kind: 'number';
  unit: Unit;
  /** Normal hard limits. */
  range: [number, number];
  /** Wider limits available only in mix-repair mode. */
  mixRepairRange?: [number, number];
  /** Wider limits for width, only with allow_widen. */
  widenRange?: [number, number];
  /**
   * When Live shows this parameter without a unit, what one display unit is
   * worth in `unit`. Glue's release shows ".6" meaning 0.6 s = 600 ms.
   */
  unitlessScale?: number;
}

export interface OptionRole extends RoleBase {
  kind: 'option';
  /** Allowed values, as the agent names them. */
  options: string[];
  /** Alternative display strings for an option, e.g. Auto shows as "A". */
  aliases?: Record<string, string[]>;
}

export type RoleSpec = NumericRole | OptionRole;

const UTILITY = ['StereoGain'];
const EQ8 = ['Eq8'];
const GLUE = ['GlueCompressor', 'Compressor2'];
const SATURATOR = ['Saturator'];
const LIMITER = ['Limiter'];
const ON_OFF = ['On', 'Off'];

export const CHAIN_ORDER = ['StereoGain', 'Eq8', 'GlueCompressor|Compressor2', 'Saturator', 'Limiter'];

/** The devices a template chain is built from, for Live 12.3+ insertion. */
export const TEMPLATE_DEVICES = [
  { className: 'StereoGain', name: 'Utility' },
  { className: 'Eq8', name: 'EQ Eight' },
  { className: 'GlueCompressor', name: 'Glue Compressor' },
  { className: 'Saturator', name: 'Saturator' },
  { className: 'Limiter', name: 'Limiter' },
];

const eqRoles: RoleSpec[] = [];
for (let band = 1; band <= 8; band += 1) {
  eqRoles.push(
    {
      kind: 'number',
      role: `eq_${band}_gain`,
      deviceClasses: EQ8,
      parameterNames: [`${band} Gain A`],
      unit: 'dB',
      range: [-2, 2],
      mixRepairRange: [-6, 6],
      description: `EQ Eight band ${band} gain. Broad master moves stay within +/-2 dB.`,
    },
    {
      kind: 'number',
      role: `eq_${band}_freq`,
      deviceClasses: EQ8,
      parameterNames: [`${band} Frequency A`],
      unit: 'Hz',
      range: [10, 22000],
      description: `EQ Eight band ${band} frequency.`,
    },
    {
      kind: 'option',
      role: `eq_${band}_on`,
      deviceClasses: EQ8,
      parameterNames: [`${band} Filter On A`],
      options: ON_OFF,
      description: `EQ Eight band ${band} on/off.`,
    },
  );
}

export const ROLES: RoleSpec[] = [
  {
    kind: 'number',
    role: 'input_trim',
    deviceClasses: UTILITY,
    // Live 12's Utility calls its gain "Output"; Live 11's called it "Gain".
    parameterNames: ['Output', 'Gain'],
    unit: 'dB',
    range: [-12, 6],
    description: 'Utility gain at the head of the chain: operating margin, not loudness.',
  },
  {
    kind: 'number',
    role: 'width',
    deviceClasses: UTILITY,
    parameterNames: ['Stereo Width', 'Width'],
    unit: '%',
    range: [0, 100],
    widenRange: [0, 130],
    description: 'Master width. Above 100% needs allow_widen, a positive A/B and a mono pass.',
  },
  {
    kind: 'option',
    role: 'bass_mono',
    deviceClasses: UTILITY,
    parameterNames: ['Bass Mono'],
    options: ON_OFF,
    description:
      'Mono below bass_mono_freq. Only when low-frequency side energy is measured as a problem; ' +
      'never by default.',
  },
  {
    kind: 'number',
    role: 'bass_mono_freq',
    deviceClasses: UTILITY,
    parameterNames: ['Bass Freq'],
    unit: 'Hz',
    range: [50, 200],
    description: 'Bass Mono crossover. Learn it from the bass and references, not a rule.',
  },
  ...eqRoles,
  {
    kind: 'number',
    role: 'glue_threshold',
    deviceClasses: GLUE,
    parameterNames: ['Threshold'],
    unit: 'dB',
    range: [-40, 0],
    description: 'Bus compressor threshold. Target 0.5-1.5 dB of regular gain reduction.',
  },
  {
    kind: 'number',
    role: 'glue_ratio',
    deviceClasses: GLUE,
    parameterNames: ['Ratio'],
    unit: 'ratio',
    range: [1.5, 4],
    description: 'Bus compressor ratio. 2:1 by default; 4:1 for firmer drum cohesion.',
  },
  {
    kind: 'number',
    role: 'glue_attack',
    deviceClasses: GLUE,
    parameterNames: ['Attack'],
    unit: 'ms',
    range: [0.1, 30],
    unitlessScale: 1,
    description: 'Bus compressor attack. 30 ms keeps transients; test 10 ms only if punch survives.',
  },
  {
    kind: 'number',
    role: 'glue_release',
    deviceClasses: GLUE,
    parameterNames: ['Release'],
    unit: 'ms',
    range: [100, 1200],
    unitlessScale: 1000,
    description: 'Bus compressor release in ms. Use glue_auto_release for Auto.',
  },
  {
    kind: 'option',
    role: 'glue_auto_release',
    deviceClasses: ['GlueCompressor'],
    parameterNames: ['Release'],
    options: ['Auto'],
    aliases: { Auto: ['A'] },
    description: "Set the Glue Compressor's release to Auto (the MIXING.md default).",
  },
  {
    kind: 'number',
    role: 'glue_range',
    deviceClasses: ['GlueCompressor'],
    parameterNames: ['Range'],
    unit: 'dB',
    range: [0.5, 70],
    description: 'Maximum gain reduction Glue may apply. 2 dB keeps a master bus honest.',
  },
  {
    kind: 'number',
    role: 'glue_makeup',
    deviceClasses: GLUE,
    parameterNames: ['Output', 'Makeup', 'Output Gain'],
    unit: 'dB',
    range: [0, 6],
    description: 'Bus compressor makeup gain.',
  },
  {
    kind: 'option',
    role: 'glue_soft_clip',
    deviceClasses: ['GlueCompressor'],
    parameterNames: ['Peak Clip In', 'Soft Clip'],
    options: ON_OFF,
    description: "Glue's clip stage is deliberate coloration, not a safety limiter. Off by default.",
  },
  {
    kind: 'number',
    role: 'saturator_drive',
    deviceClasses: SATURATOR,
    parameterNames: ['Drive'],
    unit: 'dB',
    range: [0, 3],
    description: 'Saturator drive for peak conditioning. Review above 2.5 dB.',
  },
  {
    kind: 'number',
    role: 'saturator_output',
    deviceClasses: SATURATOR,
    parameterNames: ['Output'],
    unit: 'dB',
    range: [-6, 0],
    description: 'Saturator output; roughly the inverse of drive, so A/B is level-matched.',
  },
  {
    kind: 'option',
    role: 'saturator_type',
    deviceClasses: SATURATOR,
    parameterNames: ['Type'],
    options: ['Analog Clip', 'Soft Sine', 'Medium Curve', 'Hard Curve', 'Sinoid Fold', 'Digital Clip'],
    description: 'Saturation curve. Analog Clip is the conservative mastering choice.',
  },
  {
    kind: 'option',
    role: 'saturator_pre_dc',
    deviceClasses: SATURATOR,
    parameterNames: ['Pre Dc Filter', 'Pre-DC'],
    options: ON_OFF,
    description: 'DC filter before saturation. On only when QC measures DC offset.',
  },
  {
    kind: 'number',
    role: 'limiter_gain',
    deviceClasses: LIMITER,
    parameterNames: ['Input Gain', 'Gain', 'Drive'],
    unit: 'dB',
    range: [0, 6],
    description: 'Limiter drive. Warn above 3 dB, review above 4 dB.',
  },
  {
    kind: 'number',
    role: 'limiter_ceiling',
    deviceClasses: LIMITER,
    parameterNames: ['Ceiling', 'Output Ceiling'],
    unit: 'dB',
    range: [-3, -0.3],
    description: '-1.0 dB by default; -0.5 only for a dedicated unencoded club PCM, with a reason.',
  },
  {
    kind: 'number',
    role: 'limiter_release',
    deviceClasses: LIMITER,
    parameterNames: ['Release'],
    unit: 'ms',
    range: [1, 3000],
    description: 'Limiter release.',
  },
  {
    kind: 'number',
    role: 'limiter_lookahead',
    deviceClasses: LIMITER,
    parameterNames: ['Lookahead'],
    unit: 'ms',
    range: [1.5, 6],
    description: '3 ms by default; test 6 ms if 3 ms distorts transients or low end.',
  },
  {
    kind: 'option',
    role: 'limiter_mode',
    deviceClasses: LIMITER,
    parameterNames: ['Mode'],
    options: ['True Peak', 'Standard'],
    description: 'Live 12 Limiter mode. True Peak prevents inter-sample overs; use it for masters.',
  },
];

/** Roles a mastering pass cannot work without. */
export const CORE_ROLES = ['input_trim', 'limiter_gain', 'limiter_ceiling'];

export function roleSpec(role: string): RoleSpec | undefined {
  return ROLES.find((r) => r.role === role);
}

/** Soft thresholds reported back with every write, mirroring the QC policy. */
export function softWarnings(role: string, value: number | string): string[] {
  const warnings: string[] = [];
  if (typeof value === 'string') {
    if (role === 'bass_mono' && value.toLowerCase() === 'on') {
      warnings.push('NOTE: Bass Mono is on. Justify it with measured low-frequency side energy.');
    }
    if (role === 'limiter_mode' && value.toLowerCase() === 'standard') {
      warnings.push('WARN: Standard mode allows inter-sample overs. Masters should use True Peak.');
    }
    if (role === 'glue_soft_clip' && value.toLowerCase() === 'on') {
      warnings.push('NOTE: Glue soft clip is coloration, not a safety limiter.');
    }
    return warnings;
  }
  if (role === 'limiter_gain') {
    if (value > 4) warnings.push('REVIEW: more than 4 dB of limiter drive. Revisit kick/sub/drum peaks first.');
    else if (value > 3) warnings.push('WARN: more than 3 dB of limiter drive; scrutinise for audible side effects.');
  }
  if (/^eq_\d_gain$/.test(role) && Math.abs(value) > 2) {
    warnings.push('REVIEW: broad master EQ beyond 2 dB means the mix should probably be revised.');
  }
  if (role === 'saturator_drive' && value > 2.5) {
    warnings.push('REVIEW: saturator drive above 2.5 dB. Gain-match before judging.');
  }
  if (role === 'width' && value > 100) {
    warnings.push('WARN: width above 100%. Requires a positive A/B and a mono-compatibility pass.');
  }
  if (role === 'limiter_ceiling' && value > -1) {
    warnings.push('NOTE: ceiling above -1 dBTP. Only for a dedicated unencoded club PCM master.');
  }
  return warnings;
}

/**
 * Parse a Live display string into canonical units: dB, ms, Hz, %.
 * Mirrors parse_display in the Remote Script. Accepts Live's bare decimals
 * such as ".6".
 */
export function parseDisplay(text: string | null | undefined): { value: number; unit: string } | null {
  if (!text) return null;
  const match = /(-?inf|[-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([kKmM]?)\s*([A-Za-z%]*)/.exec(text);
  if (!match) return null;
  const [, raw, prefixRaw, unitRaw] = match;
  let value = /inf$/i.test(raw!) ? (raw!.startsWith('-') ? -1e9 : 1e9) : Number(raw);
  let prefix = prefixRaw ?? '';
  let unit = unitRaw ?? '';
  if (prefix === 'm' && unit.toLowerCase() === 's') {
    unit = 'ms';
    prefix = '';
  } else if (prefix === 'm' && !unit) {
    prefix = '';
  }
  if (prefix === 'k' || prefix === 'K') value *= 1000;
  if (prefix === 'M') value *= 1_000_000;
  if (unit === 's') {
    value *= 1000;
    unit = 'ms';
  }
  return { value, unit };
}

/** A parsed display converted into the role's unit, honouring unitless displays. */
export function displayInRoleUnits(spec: NumericRole, display: string | null): number | null {
  const parsed = parseDisplay(display);
  if (!parsed) return null;
  const scale = parsed.unit === '' && spec.unitlessScale ? spec.unitlessScale : 1;
  return Math.round(parsed.value * scale * 1000) / 1000;
}

/** The starting chain from MIXING.md's "Club Master - Clean" table. */
export const PRESETS: Record<string, Array<{ role: string; value: number | string; why: string }>> = {
  clean: [
    { role: 'input_trim', value: 0, why: 'trim starts neutral; adjust for operating margin only' },
    { role: 'width', value: 100, why: 'no master widening by default' },
    { role: 'bass_mono', value: 'Off', why: 'no low-end mono without measured evidence' },
    { role: 'glue_ratio', value: 2, why: '2:1 for gentle bus cohesion' },
    { role: 'glue_attack', value: 30, why: '30 ms attack preserves transients' },
    { role: 'glue_auto_release', value: 'Auto', why: 'auto release follows the material' },
    { role: 'glue_range', value: 2, why: 'cap bus gain reduction at 2 dB' },
    { role: 'glue_threshold', value: 0, why: 'no compression until the material asks for it' },
    { role: 'glue_soft_clip', value: 'Off', why: 'soft clip is coloration, not safety' },
    { role: 'saturator_type', value: 'Analog Clip', why: 'conservative peak conditioning curve' },
    { role: 'saturator_drive', value: 1, why: '+1 dB drive as a gentle starting point' },
    { role: 'saturator_output', value: -1, why: 'inverse of drive keeps the A/B level-matched' },
    { role: 'limiter_mode', value: 'True Peak', why: 'prevent inter-sample overs' },
    { role: 'limiter_lookahead', value: 3, why: '3 ms lookahead as the clean default' },
    { role: 'limiter_gain', value: 0, why: 'no limiter drive until loudness is reference-matched' },
    { role: 'limiter_ceiling', value: -1, why: '-1 dBTP for distribution safety' },
  ],
};
