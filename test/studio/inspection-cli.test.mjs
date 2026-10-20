import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
import { createRun, executeRun } from '../../public/studio/core/runtime.js';
const entry = fileURLToPath(new URL('../../scripts/studio-inspect.mjs', import.meta.url));
function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-inspect-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
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
async function sample(dir) {
  const a = createFixtureAdapter('safe-add');
  const run = await executeRun(
    await createRun(scenario('safe-add').request, makeRecipe('standard'), a),
    { adapter: a },
  );
  const file = path.join(dir, 'review.json');
  fs.writeFileSync(file, JSON.stringify(run));
  return { run, file };
}

test('inspection CLI produces a bounded report without opening stores or changing the file', async (t) => {
  const dir = temporary(t),
    { file } = await sample(dir),
    before = fs.readFileSync(file);
  const r = call(['--file=' + file, '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.consistency, 'pass');
  assert.equal(report.sourceAuthenticated, false);
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.toolCalls, 0);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(dir), ['review.json']);
  assert.equal(r.stderr, '');
});

test('inspection CLI refuses corruption and does not print supplied sensitive content', async (t) => {
  const dir = temporary(t),
    { run, file } = await sample(dir);
  run.request.changeRequest.summary = 'SYNTHETIC_PRIVATE_CANARY';
  fs.writeFileSync(file, JSON.stringify(run));
  const r = call(['--file=' + file, '--json'], dir);
  assert.equal(r.status, 2);
  const report = JSON.parse(r.stdout);
  assert.equal(report.valid, false);
  assert.equal(report.executionAuthorized, false);
  assert(!r.stdout.includes('SYNTHETIC_PRIVATE_CANARY'));
  assert(!r.stdout.includes(dir));
  assert.equal(r.stderr, '');
});

test('inspection CLI refuses linked paths, nonregular files and oversized input before parsing', async (t) => {
  const dir = temporary(t),
    { file } = await sample(dir);
  fs.symlinkSync(file, path.join(dir, 'linked.json'));
  fs.symlinkSync(dir, path.join(dir, 'alias'), 'dir');
  const huge = path.join(dir, 'huge.json');
  fs.writeFileSync(huge, Buffer.alloc(4_000_001));
  const candidates = [
    path.join(dir, 'linked.json'),
    path.join(dir, 'alias/review.json'),
    dir,
    huge,
    path.join(dir, 'absent'),
  ];
  if (process.platform !== 'win32') {
    const fifo = path.join(dir, 'pipe.json');
    const make = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.equal(make.status, 0);
    candidates.push(fifo);
  }
  for (const target of candidates) {
    const r = call(['--file=' + target, '--json'], dir);
    assert.equal(r.status, 2, target + ': ' + r.stderr);
    assert.equal(JSON.parse(r.stdout).valid, false);
  }
  assert.equal(fs.existsSync(path.join(dir, '.lineageguard')), false);
});

test('inspection CLI validates arguments and documents consistency is not approval', (t) => {
  const dir = temporary(t);
  for (const args of [
    [],
    ['--file='],
    ['--file=a', '--file=b'],
    ['--file=a', '--execute'],
    ['--file=a', '--json', '--json'],
  ]) {
    const r = call(args.includes('--json') ? args : [...args, '--json'], dir);
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).code, 'INVALID_ARGUMENT');
  }
  const help = call(['--help'], dir);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not.*approval|no.*approval/i);
  assert.deepEqual(fs.readdirSync(dir), []);
});
