#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { inspectReviewBytes, MAX_REVIEW_BYTES } from '../public/studio/core/inspection.js';
import { StudioError } from '../public/studio/core/contract.js';

const args = process.argv.slice(2),
  machine = args.includes('--json');
const invalid = () => {
  throw new StudioError(
    'INVALID_ARGUMENT',
    'Use --file=/path/review.json with optional --json, or --help',
  );
};
function safePath(file) {
  for (let current = file; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      throw new StudioError('FILE_UNREADABLE', 'Linked paths are not accepted');
    if (path.dirname(current) === current) break;
  }
}
function readFile(name) {
  const file = path.resolve(name);
  safePath(file);
  const initial = fs.lstatSync(file);
  if (
    !initial.isFile() ||
    initial.nlink !== 1 ||
    initial.size < 1 ||
    initial.size > MAX_REVIEW_BYTES
  )
    throw new StudioError(
      'FILE_UNREADABLE',
      'Choose one regular unlinked review file, at most 4 MB',
    );
  let fd;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const opened = fs.fstatSync(fd);
    safePath(file);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== initial.ino ||
      opened.dev !== initial.dev ||
      opened.size !== initial.size
    )
      throw new StudioError('FILE_UNREADABLE', 'The review file changed while opening');
    const bytes = Buffer.alloc(opened.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = fs.readSync(fd, bytes, used, bytes.length - used, null);
      if (read === 0) break;
      used += read;
    }
    const after = fs.fstatSync(fd),
      final = fs.lstatSync(file);
    safePath(file);
    if (
      used !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      final.ino !== opened.ino ||
      final.dev !== opened.dev
    )
      throw new StudioError('FILE_UNREADABLE', 'The review file changed while being read');
    return new Uint8Array(bytes.subarray(0, used));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

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
      raw = readFile(file);
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
