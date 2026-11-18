import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/trim-dbt-manifest.mjs', import.meta.url));
const bundled = fileURLToPath(
  new URL('../../public/studio/dbt/saas-analytics-warehouse/', import.meta.url),
);
function trim(out, catalog = path.join(bundled, 'catalog.json')) {
  return spawnSync(
    process.execPath,
    [
      script,
      '--manifest=' + path.join(bundled, 'manifest.json'),
      '--catalog=' + catalog,
      '--out=' + out,
    ],
    { encoding: 'utf8' },
  );
}

test('a pre-existing catalog is preserved and a failed trim leaves no manifest', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-trim-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const catalog = path.join(out, 'catalog.json');
  fs.writeFileSync(catalog, 'user catalog');
  assert.notEqual(trim(out).status, 0);
  assert.deepEqual(fs.readdirSync(out), ['catalog.json']);
  assert.equal(fs.readFileSync(catalog, 'utf8'), 'user catalog');
});

test('a malformed catalog can be corrected and retried at the same destination', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-trim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'result');
  const badCatalog = path.join(root, 'bad-catalog.json');
  fs.writeFileSync(badCatalog, 'incomplete JSON');
  assert.notEqual(trim(out, badCatalog).status, 0);
  assert.equal(fs.existsSync(path.join(out, 'manifest.json')), false);
  const retry = trim(out);
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(fs.readdirSync(out).sort(), ['catalog.json', 'manifest.json']);
});

test('comparison reports an extra relation present only in the trimmed fixture', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-trim-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const manifest = JSON.parse(fs.readFileSync(path.join(bundled, 'manifest.json'), 'utf8'));
  const model = Object.values(manifest.nodes).find((node) => node.resource_type === 'model');
  const extra = 'model.tallyloom.extra';
  manifest.nodes[extra] = {
    ...model,
    unique_id: extra,
    name: 'extra',
    alias: 'extra',
    depends_on: { nodes: [] },
  };
  manifest.parent_map[extra] = [];
  manifest.child_map[extra] = [];
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  fs.copyFileSync(path.join(bundled, 'catalog.json'), path.join(out, 'catalog.json'));
  const comparison = spawnSync(
    process.execPath,
    [
      script,
      '--compare',
      '--manifest=' + path.join(bundled, 'manifest.json'),
      '--catalog=' + path.join(bundled, 'catalog.json'),
      '--trimmed=' + out,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(comparison.status, 0);
  assert.match(comparison.stderr, /target/i);
});

test('a manifest passed as the catalog leaves the output available for a corrected retry', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-trim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'trimmed');
  const wrongFile = trim(out, path.join(bundled, 'manifest.json'));
  assert.notEqual(wrongFile.status, 0);
  assert.match(wrongFile.stderr, /expected a dbt catalog/i);
  assert.equal(fs.existsSync(path.join(out, 'manifest.json')), false);
  assert.equal(trim(out).status, 0);
});
