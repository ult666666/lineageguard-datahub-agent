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
const DBT = 'public/studio/dbt/saas-analytics-warehouse';
const dbtArgs = (dir, extra = []) => [
  `--dbt-manifest=${DBT}/manifest.json`,
  `--dbt-catalog=${DBT}/catalog.json`,
  '--request=examples/dbt/rename-mrr-usd.json',
  '--output=' + path.join(dir, 'dbt.json'),
  ...extra,
];
const temp = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-dbt-cli-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
test('CLI reviews a column rename against a dbt manifest and names consumers and owners', async (t) => {
  const dir = temp(t);
  const result = run(dbtArgs(dir));
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.source, 'dbt-manifest');
  assert.equal(summary.decision, 'needs-evidence');
  assert.deepEqual(summary.dbt.reasons, ['RENAME_CONTRACT']);
  assert.ok(summary.dbt.gaps.includes('usage:INCOMPLETE_EVIDENCE'));
  assert.deepEqual(
    summary.dbt.downstream.filter((n) => n.type === 'analysis').map((n) => n.owner),
    ['Finance Reporting (synthetic)', 'Revenue Analytics (synthetic)'],
  );
  assert.equal(summary.dbt.downstream.filter((n) => n.type === 'dataset').length, 5);
  assert.ok(summary.dbt.checks.some((c) => c.column === 'mrr_usd'));
  const review = JSON.parse(fs.readFileSync(path.join(dir, 'dbt.json'), 'utf8'));
  assert.equal(await verifyRun(review), true);
  assert.equal(review.sourceMode, 'dbt-manifest');
  const inspected = spawnSync(
    process.execPath,
    ['scripts/studio-inspect.mjs', '--file=' + path.join(dir, 'dbt.json')],
    { cwd: new URL('../../', import.meta.url), env: { PATH: process.env.PATH }, encoding: 'utf8' },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /INTERNALLY CONSISTENT/);
});
test('CLI lists dbt targets and runs the bundled dbt scenario without other inputs', (t) => {
  const listed = run([`--dbt-manifest=${DBT}/manifest.json`, '--list-dbt-targets']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.trim().split('\n').length, 30);
  const dir = temp(t);
  const scenario = run(['--scenario=dbt-manifest', '--output=' + path.join(dir, 's.json')]);
  assert.equal(scenario.status, 0, scenario.stderr);
  assert.equal(JSON.parse(scenario.stdout).source, 'dbt-manifest');
});
test('CLI refuses mixed sources, missing requests, linked, oversized and unsupported manifests', (t) => {
  const dir = temp(t);
  const code = (result) => JSON.parse(result.stderr).code;
  assert.notEqual(
    run([`--dbt-catalog=${DBT}/catalog.json`, '--output=' + dir + '/a.json']).status,
    0,
  );
  assert.notEqual(run(dbtArgs(dir, ['--scenario=rename'])).status, 0);
  assert.notEqual(run(dbtArgs(dir, ['--live-datahub'])).status, 0);
  assert.notEqual(
    run([`--dbt-manifest=${DBT}/manifest.json`, '--output=' + path.join(dir, 'b.json')]).status,
    0,
  );
  const old = JSON.parse(fs.readFileSync(`${DBT}/manifest.json`, 'utf8'));
  old.metadata.dbt_schema_version = 'https://schemas.getdbt.com/dbt/manifest/v11.json';
  fs.writeFileSync(path.join(dir, 'v11.json'), JSON.stringify(old));
  const refused = run([
    `--dbt-manifest=${path.join(dir, 'v11.json')}`,
    '--request=examples/dbt/rename-mrr-usd.json',
    '--output=' + path.join(dir, 'c.json'),
  ]);
  assert.equal(code(refused), 'UNSUPPORTED_MANIFEST_VERSION');
  assert.match(JSON.parse(refused.stderr).message, /v11/);
  fs.symlinkSync(path.resolve(`${DBT}/manifest.json`), path.join(dir, 'link.json'));
  const linked = run([
    `--dbt-manifest=${path.join(dir, 'link.json')}`,
    '--request=examples/dbt/rename-mrr-usd.json',
    '--output=' + path.join(dir, 'd.json'),
  ]);
  assert.equal(code(linked), 'FILE_UNREADABLE');
  // A sparse file over the 128 MB bound is refused from its size, without being read.
  const big = path.join(dir, 'big.json');
  fs.closeSync(fs.openSync(big, 'w'));
  fs.truncateSync(big, 128 * 1024 * 1024 + 1);
  const oversized = run([
    `--dbt-manifest=${big}`,
    '--request=examples/dbt/rename-mrr-usd.json',
    '--output=' + path.join(dir, 'e.json'),
  ]);
  assert.equal(code(oversized), 'FILE_UNREADABLE');
  assert.match(JSON.parse(oversized.stderr).message, /128 MB/);
  for (const name of ['a', 'b', 'c', 'd', 'e'])
    assert(!fs.existsSync(path.join(dir, name + '.json')));
});
