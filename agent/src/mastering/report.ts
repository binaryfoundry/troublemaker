/**
 * The compact, auditable job report MIXING.md describes.
 */

import type { Analysis } from '../../../qc/src/types.js';
import type { Comparison } from './compare.js';
import type { Evaluation, Finding } from './policy.js';
import type { ReferenceProfile } from './reference.js';

const SEVERITY_ORDER: Record<Finding['severity'], number> = { fail: 0, review: 1, warn: 2, info: 3 };

function fmt(value: number, unit: string): string {
  return `${value.toFixed(1)} ${unit}`;
}

export function formatReport(
  target: Analysis,
  evaluation: Evaluation,
  options: { profileName: string; reference?: ReferenceProfile },
): string {
  const lines: string[] = [];
  const { loudness, section } = target;

  lines.push(`MASTER RESULT: ${evaluation.verdict}`, '');
  lines.push(`File:      ${target.file.path}`);
  lines.push(
    `Format:    ${target.file.codec}, ${target.file.sampleRate} Hz, ` +
      `${target.file.bitDepth ?? '?'}-bit, ${target.file.channels} ch, ` +
      `${target.file.durationSeconds.toFixed(1)} s`,
  );
  lines.push(`Profile:   ${options.profileName}`, '');

  lines.push('Measurements:');
  lines.push(`  LUFS-I          ${fmt(loudness.integratedLufs, 'LUFS')}`);
  lines.push(
    `  section LUFS-S  ${fmt(section.shortTermMeanLufs, 'LUFS')}  ` +
      `(${section.range.source}, ${section.range.startSeconds.toFixed(1)}s +${section.range.durationSeconds.toFixed(0)}s)`,
  );
  lines.push(`  max LUFS-S      ${fmt(loudness.shortTermMaxLufs, 'LUFS')}`);
  lines.push(`  true peak       ${fmt(loudness.truePeakDbtp, 'dBTP')}`);
  lines.push(`  sample peak     ${fmt(loudness.samplePeakDbfs, 'dBFS')}`);
  lines.push(`  PLR             ${fmt(loudness.plrDb, 'dB')}`);
  lines.push(`  LRA             ${fmt(loudness.loudnessRangeLu, 'LU')}`);
  lines.push(
    `  low-end mono    ${fmt(section.stereo.lowMonoLossDb, 'dB')}  (corr ${section.stereo.lowCorrelation})`,
  );
  lines.push(`  clipped runs    ${target.whole.integrity.clippedRuns}`, '');

  if (options.reference) {
    const ref = options.reference;
    lines.push(`Reference median (${ref.count} files):`);
    lines.push(`  LUFS-I          ${fmt(ref.integratedLufs, 'LUFS')}`);
    lines.push(`  section LUFS-S  ${fmt(ref.sectionLufs, 'LUFS')}`);
    lines.push(`  true peak       ${fmt(ref.truePeakDbtp, 'dBTP')}`);
    lines.push(`  PLR             ${fmt(ref.plrDb, 'dB')}`, '');
  }

  if (evaluation.comparison) {
    lines.push('Tonal balance vs references (loudness-independent):');
    for (const [band, delta] of Object.entries(evaluation.comparison.bandDeltaDb)) {
      const shown = Math.abs(delta) < 0.05 ? ' 0.0' : `${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)}`;
      const bar = (delta > 0 ? '+' : '-').repeat(Math.min(10, Math.round(Math.abs(delta))));
      lines.push(`  ${band.padEnd(11)} ${shown} dB  ${bar}`);
    }
    lines.push('');
  }

  lines.push(
    `Working window: ${evaluation.working.lufsLow} to ${evaluation.working.lufsHigh} LUFS ` +
      `(${evaluation.working.source === 'references' ? 'loudest section, from the references' : 'integrated, from the profile'}), ` +
      `ceiling ${evaluation.working.truePeakCeilingDbtp} dBTP`,
    '',
  );

  const sorted = [...evaluation.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  lines.push('Findings:');
  for (const finding of sorted) {
    lines.push(`  [${finding.severity.toUpperCase()}] ${finding.message}`);
    lines.push(`         -> ${finding.action}`);
  }
  return lines.join('\n');
}

/** The A/B verdict, in the same compact style as the master report. */
export function formatComparison(
  comparison: Comparison,
  options: {
    labels?: { a: string; b: string };
    listening?: { a: string; b: string } | null;
  } = {},
): string {
  const labels = options.labels ?? { a: 'A', b: 'B' };
  const { a, b } = comparison;
  const row = (name: string, av: string, bv: string) =>
    `  ${name.padEnd(16)} ${av.padStart(10)}   ${bv.padStart(10)}`;
  const n = (v: number, unit: string) => `${v.toFixed(1)} ${unit}`;
  const lines = [
    `A/B RESULT: prefer ${comparison.preferred} (${comparison.confidence})`,
    '',
    `  A = ${labels.a}`,
    `  B = ${labels.b}`,
    '',
    row('', 'A', 'B'),
    row('LUFS-I', n(a.integratedLufs, 'LUFS'), n(b.integratedLufs, 'LUFS')),
    row('true peak', n(a.truePeakDbtp, 'dBTP'), n(b.truePeakDbtp, 'dBTP')),
    row('PLR', n(a.plrDb, 'dB'), n(b.plrDb, 'dB')),
    row('low-end mono', n(a.lowMonoLossDb, 'dB'), n(b.lowMonoLossDb, 'dB')),
    row('clipped runs', String(a.clippedRuns), String(b.clippedRuns)),
  ];
  if (a.referenceDistanceDb !== null && b.referenceDistanceDb !== null) {
    lines.push(row('dist. to refs', n(a.referenceDistanceDb, 'dB'), n(b.referenceDistanceDb, 'dB')));
  }
  lines.push(
    '',
    `Compared at matched loudness: B is ${comparison.loudnessDeltaLu >= 0 ? '+' : ''}${comparison.loudnessDeltaLu.toFixed(1)} LU vs A, ` +
      `so B plays ${comparison.matchGainDb >= 0 ? '+' : ''}${comparison.matchGainDb.toFixed(1)} dB for listening.`,
  );
  const moved = Object.entries(comparison.tiltChangeDb).filter(([, d]) => Math.abs(d) >= 0.5);
  if (moved.length) {
    lines.push(
      `Tonal change A -> B: ${moved.map(([band, d]) => `${band} ${d > 0 ? '+' : ''}${d.toFixed(1)}`).join(', ')} dB`,
    );
  }
  lines.push('', 'Why:');
  for (const reason of comparison.reasons) lines.push(`  ${reason}`);
  if (options.listening) {
    lines.push('', 'Loudness-matched listening copies (judge by ear too):');
    lines.push(`  ${options.listening.a}`, `  ${options.listening.b}`);
  }
  return lines.join('\n');
}
