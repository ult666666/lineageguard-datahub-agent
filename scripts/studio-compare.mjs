#!/usr/bin/env node
import { readReviewFile } from './lib/review-file.mjs';
import { compareReviewBytes } from '../src/studio/review-comparison.mjs';
import { StudioError } from '../public/studio/core/contract.js';

const args = process.argv.slice(2),
  machine = args.includes('--json');
const invalid = () => {
  throw new StudioError('INVALID_ARGUMENT', 'Use --help for comparison options');
};
function readSide(name, side) {
  try {
    return readReviewFile(name);
  } catch {
    const error = new StudioError('FILE_UNREADABLE', 'The export could not be safely read');
    error.side = side;
    throw error;
  }
}
try {
  const paths = {},
    seen = new Set();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) invalid();
    seen.add(key);
    if (arg === '--json') continue;
    if (arg === '--help' && args.length === 1) continue;
    const side = arg.startsWith('--left=') ? 'left' : arg.startsWith('--right=') ? 'right' : null;
    if (!side || !arg.slice(side.length + 3) || arg.length >= 4105 || /[\x00-\x1f\x7f]/.test(arg))
      invalid();
    paths[side] = arg.slice(side.length + 3);
  }
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'LineageGuard saved-review comparison\n\nUse: node scripts/studio-compare.mjs --left=/path/left.json --right=/path/right.json [--json]\nRead-only offline comparison: both existing UTF-8 exports must pass inspection and be completed. Each file is bounded to4,000,000 bytes. No tool calls, stores, uploads, writes, resume or SQL execution.\nRecorded decisions and current embedded-evidence assessments are separate. Different requests are labelled alternative plans.\nExit0 means internally consistent exports could be compared, not authenticity or approval; exit2 means refusal. JSON success reports include supplied summaries/run identities; choose stdout destinations accordingly.',
    );
  } else {
    if (!paths.left || !paths.right) invalid();
    const report = await compareReviewBytes(
      readSide(paths.left, 'left'),
      readSide(paths.right, 'right'),
    );
    if (machine) console.log(JSON.stringify(report));
    else
      console.log(
        `INTERNALLY CONSISTENT EXPORTS — NOT AUTHENTICATED\nSame request: ${report.comparison.sameRequest} · same recipe: ${report.comparison.sameRecipe} · same source revision: ${report.comparison.sameSourceRevision}\nRecorded decisions: left ${report.comparison.left.decision} · right ${report.comparison.right.decision}\nCurrent embedded-evidence assessment (${report.inspectedAt}): left ${report.inspections.left.currentDecision} · right ${report.inspections.right.currentDecision}\nRemoved gaps: ${report.comparison.removedGaps.length} · added gaps: ${report.comparison.addedGaps.length}\nLeft file SHA-256: ${report.inspections.left.fileSha256}\nRight file SHA-256: ${report.inspections.right.fileSha256}\n${report.comparison.explanation}\n${report.scope}\nExecution authorized: false · tools called: 0 · resumable import: false`,
      );
  }
} catch (error) {
  const code =
    error instanceof StudioError && /^[A-Z_]+$/.test(error.code) ? error.code : 'COMPARISON_FAILED';
  const result = {
    schema: 'lineageguard.comparison-error/1',
    valid: false,
    code,
    side: ['left', 'right'].includes(error?.side) ? error.side : null,
    message:
      'The supplied exports could not be validated for comparison. No review was imported, resumed or executed.',
    sourceAuthenticated: false,
    executionAuthorized: false,
    toolCalls: 0,
    resumableImport: false,
  };
  console.log(
    machine
      ? JSON.stringify(result)
      : `COMPARISON REFUSED (${code}${result.side ? ', ' + result.side : ''})\n${result.message}`,
  );
  process.exitCode = 2;
}
