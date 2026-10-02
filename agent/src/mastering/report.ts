/**
 * The compact, auditable job report MIXING.md describes.
 */

import type { Analysis } from '../../../qc/src/types.js';
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
      `(from ${evaluation.working.source}), ceiling ${evaluation.working.truePeakCeilingDbtp} dBTP`,
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
