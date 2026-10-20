import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyRun } from '../../public/studio/core/runtime.js';
const run = (args) =>
  spawnSync(process.execPath, ['scripts/studio-review.mjs', ...args], {
    cwd: new URL('../../', import.meta.url),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 10000,
  });
test('CLI produces an inspectable synthetic review without configured credentials', async (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-cli-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'run.json');
  const result = run(['--scenario=safe-add', '--output=' + file]);
  assert.equal(result.status, 0, result.stderr);
  const review = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(await verifyRun(review), true);
  assert.equal(review.result.policy.decision, 'proceed-with-checks');
  const repeated = run(['--scenario=rename', '--output=' + file]);
  assert.notEqual(repeated.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), review);
});
test('CLI refuses implicit live data access and arbitrary flags', () => {
  assert.notEqual(run(['--live-datahub']).status, 0);
  assert.notEqual(run(['--execute-sql']).status, 0);
});
