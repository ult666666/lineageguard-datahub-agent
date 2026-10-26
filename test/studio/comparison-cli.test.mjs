import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
import { createRun, executeRun } from '../../public/studio/core/runtime.js';

const entry = fileURLToPath(new URL('../../scripts/studio-compare.mjs', import.meta.url));
const call = (args, cwd) =>
  spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      DATAHUB_MCP_URL: 'https://must-not-be-contacted.invalid',
    },
  });
function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-compare-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function sample(dir, name, profile = 'standard', id = 'safe-add') {
  const adapter = createFixtureAdapter(id);
  const run = await executeRun(
    await createRun(scenario(id).request, makeRecipe(profile), adapter),
    { adapter },
  );
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(run));
  return { file, run };
}
const options = (a, b) => ['--left=' + a, '--right=' + b, '--json'];
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('two-file CLI validates actual exports and leaves files and working directory unchanged', async (t) => {
  const dir = temporary(t),
    a = await sample(dir, 'standard.json'),
    b = await sample(dir, 'strict.json', 'strict');
  const names = fs.readdirSync(dir).sort(),
    hashes = [sha(a.file), sha(b.file)];
  const r = call(options(a.file, b.file), dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const report = JSON.parse(r.stdout);
  assert.equal(report.comparison.sameRequest, true);
  assert.equal(report.comparison.left.decision, 'proceed-with-checks');
  assert.equal(report.comparison.right.decision, 'review-required');
  assert.equal(report.inspections.left.fileSha256, hashes[0]);
  assert.equal(report.inspections.right.fileSha256, hashes[1]);
  assert.equal(report.sourceAuthenticated, false);
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.toolCalls, 0);
  assert.equal(report.resumableImport, false);
  assert.deepEqual(fs.readdirSync(dir).sort(), names);
  assert.deepEqual([sha(a.file), sha(b.file)], hashes);
});

test('human output distinguishes recorded decisions/current evidence and identical files may be compared', async (t) => {
  const dir = temporary(t),
    a = await sample(dir, 'review.json');
  const r = call(['--left=' + a.file, '--right=' + a.file], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Recorded decisions/i);
  assert.match(r.stdout, /Current embedded-evidence/i);
  assert.match(r.stdout, /not authenticated/i);
  assert(!r.stdout.includes(dir));
  const j = call(options(a.file, a.file), dir);
  assert.equal(j.status, 0);
  const report = JSON.parse(j.stdout);
  assert.equal(report.comparison.sameRequest, true);
  assert.equal(report.comparison.sameRecipe, true);
  assert.equal(report.comparison.sameSourceRevision, true);
});

test('different saved requests retain alternative-plan comparison semantics', async (t) => {
  const dir = temporary(t),
    a = await sample(dir, 'rename.json', 'standard', 'rename'),
    b = await sample(dir, 'add.json');
  const r = call(options(a.file, b.file), dir);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.comparison.sameRequest, false);
  assert.match(report.comparison.explanation, /alternative-plan comparison/);
});

test('failed input identifies either side without exposing supplied private text or paths', async (t) => {
  const dir = temporary(t),
    good = await sample(dir, 'good.json'),
    bad = await sample(dir, 'bad.json');
  bad.run.request.changeRequest.summary = 'SYNTHETIC_PRIVATE_CANARY';
  fs.writeFileSync(bad.file, JSON.stringify(bad.run));
  const before = fs.readFileSync(bad.file);
  for (const side of ['left', 'right']) {
    const r = call(
      side === 'left' ? options(bad.file, good.file) : options(good.file, bad.file),
      dir,
    );
    assert.equal(r.status, 2, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.valid, false);
    assert.equal(report.side, side);
    assert.equal(report.executionAuthorized, false);
    assert(!('comparison' in report));
    assert(!r.stdout.includes('SYNTHETIC_PRIVATE_CANARY'));
    assert(!r.stdout.includes(dir));
    assert.equal(r.stderr, '');
  }
  assert.deepEqual(fs.readFileSync(bad.file), before);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['bad.json', 'good.json']);
});

test('two-file command rejects linked/special/empty/oversized files on either side before opening stores', async (t) => {
  const dir = temporary(t),
    good = await sample(dir, 'good.json');
  fs.symlinkSync(good.file, path.join(dir, 'linked.json'));
  fs.symlinkSync(dir, path.join(dir, 'alias'), 'dir');
  fs.copyFileSync(good.file, path.join(dir, 'hard-origin.json'));
  fs.linkSync(path.join(dir, 'hard-origin.json'), path.join(dir, 'hard.json'));
  fs.writeFileSync(path.join(dir, 'huge.json'), Buffer.alloc(4_000_001));
  fs.writeFileSync(path.join(dir, 'empty.json'), '');
  const bad = [
    dir,
    path.join(dir, 'linked.json'),
    path.join(dir, 'alias/good.json'),
    path.join(dir, 'hard.json'),
    path.join(dir, 'huge.json'),
    path.join(dir, 'empty.json'),
    path.join(dir, 'missing.json'),
  ];
  if (process.platform !== 'win32') {
    const fifo = path.join(dir, 'pipe.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    bad.push(fifo);
  }
  const names = fs.readdirSync(dir).sort(),
    hash = sha(good.file);
  for (const candidate of bad)
    for (const side of ['left', 'right']) {
      const r = call(
        side === 'left' ? options(candidate, good.file) : options(good.file, candidate),
        dir,
      );
      assert.equal(r.status, 2, r.stderr);
      const report = JSON.parse(r.stdout);
      assert.equal(report.code, 'FILE_UNREADABLE');
      assert.equal(report.side, side);
      assert(!r.stdout.includes(dir));
      assert.equal(r.stderr, '');
    }
  assert.deepEqual(fs.readdirSync(dir).sort(), names);
  assert.equal(sha(good.file), hash);
});

test('CLI rejects ambiguous/unsupported arguments and documents no execution authority', (t) => {
  const dir = temporary(t);
  for (const args of [
    [],
    ['--left=a'],
    ['--right=b'],
    ['--left=a', '--right=b', '--left=c'],
    ['--left=a', '--right=b', '--execute'],
    ['--left=a', '--right=b', '--json', '--json'],
    ['--left=', '--right=b'],
    ['--left=a\nsecret', '--right=b'],
    ['--help', '--left=a'],
    ['--left=a', '--right=b', '--output=out.json'],
  ]) {
    const r = call(args.includes('--json') ? args : [...args, '--json'], dir);
    assert.equal(r.status, 2, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.code, 'INVALID_ARGUMENT');
    assert.equal(report.side, null);
  }
  const help = call(['--help'], dir);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not.*approval|no.*approval/i);
  assert.match(help.stdout, /recorded/i);
  assert.deepEqual(fs.readdirSync(dir), []);
});
