#!/usr/bin/env node
import { readReviewFile } from './lib/review-file.mjs';
import { inspectReviewBytes } from '../public/studio/core/inspection.js';
import { StudioError } from '../public/studio/core/contract.js';

const args = process.argv.slice(2),
  machine = args.includes('--json');
const invalid = () => {
  throw new StudioError(
    'INVALID_ARGUMENT',
    'Use --file=/path/review.json with optional --json, or --help',
  );
};

try {
  const seen = new Set();
  let file;
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) invalid();
    seen.add(key);
    if (arg === '--json' || arg === '--help') continue;
    if (
      arg.startsWith('--file=') &&
      arg.length > 7 &&
      arg.length < 4105 &&
      !/[\x00-\x1f\x7f]/.test(arg)
    )
      file = arg.slice(7);
    else invalid();
  }
  if (args.includes('--help')) {
    if (file) invalid();
    console.log(
      'LineageGuard Review Inspector\n\nUse: npm run studio:verify -- --file=/path/review.json [--json]\nRead-only, offline file inspection. No upload, tool calls, database writes or resume.\nExit 0 means internally consistent, not authentic, current evidence or approval.\nExit 2 means the input or review could not be validated. No SQL is executed.',
    );
  } else {
    if (!file) invalid();
    let raw;
    try {
      raw = readReviewFile(file);
    } catch {
      throw new StudioError(
        'FILE_UNREADABLE',
        'The review file could not be safely read; its contents were not changed',
      );
    }
    const report = await inspectReviewBytes(raw);
    if (machine) console.log(JSON.stringify(report));
    else
      console.log(
        `INTERNALLY CONSISTENT — NOT AUTHENTICATED\nRun: ${report.runId} · ${report.runStatus}\nRecorded decision: ${report.recordedDecision || 'No completed review'}\nCurrent embedded-evidence assessment: ${report.currentDecision || 'Not evaluated'}\nFile SHA-256: ${report.fileSha256}\n${report.scope}\nExecution authorized: false · tools called: 0 · resumable import: false`,
      );
  }
} catch (error) {
  const code =
    error instanceof StudioError && /^[A-Z_]+$/.test(error.code) ? error.code : 'INSPECTION_FAILED';
  const result = {
    schema: 'lineageguard.inspection-error/1',
    valid: false,
    code,
    message: 'The file could not be validated. No review was imported, resumed or executed.',
    sourceAuthenticated: false,
    executionAuthorized: false,
    toolCalls: 0,
  };
  console.log(machine ? JSON.stringify(result) : `INSPECTION REFUSED (${code})\n${result.message}`);
  process.exitCode = 2;
}
