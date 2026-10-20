import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from '../../src/studio/store.mjs';
import { RunService } from '../../src/studio/service.mjs';
import { sqlType, validateRequest } from '../../public/studio/core/contract.js';
import { createFixtureAdapter, scenario } from '../../public/studio/core/fixtures.js';
import { createRun, executeRun, acknowledgeRun } from '../../public/studio/core/runtime.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
import { evaluateSuite } from '../../public/studio/core/evaluations.js';
const temp = (t) => {
  const p = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-adversarial-')));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  return p;
};
test('SQLite rejects a dangling database symlink before creating its target', (t) => {
  const dir = temp(t),
    target = path.join(dir, 'unexpected.sqlite');
  fs.symlinkSync(target, path.join(dir, 'runs.sqlite'));
  assert.throws(() => new RunStore(dir), /link|file|path/i);
  assert.equal(fs.existsSync(target), false);
});
test('SQLite rejects a symlink directory even when its target does not exist', (t) => {
  const dir = temp(t),
    target = path.join(dir, 'missing');
  const alias = path.join(dir, 'alias');
  fs.symlinkSync(target, alias);
  assert.throws(() => new RunStore(alias), /link|path/i);
  assert.equal(fs.existsSync(target), false);
});
test('simultaneous HTTP-style starts cannot exceed the declared active-run budget', async (t) => {
  const store = new RunStore(temp(t));
  const service = new RunService(store, {
    maxActive: 1,
    adapterFactory: (id) => createFixtureAdapter(id, { delayMs: 100 }),
  });
  t.after(() => service.close());
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => service.start({ scenarioId: 'rename' })),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(service.active.size, 1);
  const rows = await store.list();
  assert.equal(rows.length, 1, 'Rejected starts must not leave phantom created runs');
});
test('Snowflake-style decimal drafts reject scale greater than precision', () => {
  assert.throws(() => sqlType('DECIMAL(2,9)'), /type|scale|precision/i);
  assert.throws(() => sqlType('DECIMAL(39,1)'), /type|scale|precision/i);
  assert.equal(sqlType('DECIMAL(12,2)'), 'DECIMAL(12,2)');
});
test('cancellation after tool completion but before its checkpoint does not create a false success', async () => {
  const a = createFixtureAdapter('rename'),
    run = await createRun(scenario('rename').request, makeRecipe('standard'), a),
    controller = new AbortController();
  const final = await executeRun(run, {
    adapter: a,
    signal: controller.signal,
    onCheckpoint: (state) => {
      if (state.steps.resolve.status === 'completed') controller.abort();
    },
  });
  assert.equal(final.status, 'cancelled');
  assert.equal(final.result, null);
  assert.equal(final.steps.resolve.status, 'completed');
  assert.equal(final.callsUsed, 1);
});
test('blocked and incomplete evidence cannot acquire an acknowledgement', async () => {
  for (const id of ['narrowing', 'missing-usage']) {
    const a = createFixtureAdapter(id);
    const r = await executeRun(await createRun(scenario(id).request, makeRecipe('standard'), a), {
      adapter: a,
    });
    await assert.rejects(acknowledgeRun(r, 'Synthetic reviewer', 'Not an authorization'));
  }
});
test('named evaluation suite computes all outcomes with the shared interpreter', async () => {
  const result = await evaluateSuite();
  assert.equal(result.total, 19);
  assert.equal(result.failed, 0);
  assert.equal(result.passed, 19);
  assert.equal(new Set(result.checks.map((c) => c.name)).size, 19);
  assert(result.checks.every((c) => c.actual === c.expected));
});

test('a review note binds actual result evidence, run identity and generation', async () => {
  const a = createFixtureAdapter('rename');
  const run = await executeRun(
    await createRun(scenario('rename').request, makeRecipe('standard'), a),
    { adapter: a },
  );
  const reviewed = await acknowledgeRun(run, 'Synthetic reviewer', 'Inspected exact evidence');
  assert.match(reviewed.review.resultDigest, /^[a-f0-9]{64}$/);
  assert.equal(reviewed.review.runId, run.id);
  assert.equal(reviewed.review.generation, run.generation);
});
test('a formerly ready review cannot be acknowledged after its evidence expires', async (t) => {
  const a = createFixtureAdapter('rename');
  const run = await executeRun(
    await createRun(scenario('rename').request, makeRecipe('standard'), a),
    { adapter: a },
  );
  const later = Date.now() + 172800000;
  t.mock.method(Date, 'now', () => later);
  await assert.rejects(
    acknowledgeRun(run, 'Synthetic reviewer', 'Old evidence'),
    /fresh|stale|current/i,
  );
});

test('a batch cannot contain conflicting operations or duplicate output fields', () => {
  const request = scenario('safe-add').request;
  request.changeRequest.changes.push({ ...request.changeRequest.changes[0] });
  assert.throws(() => validateRequest(request), /duplicate|conflict|field/i);
  const rename = scenario('rename').request;
  rename.changeRequest.changes.push({
    kind: 'add',
    field: 'gross_amount',
    type: 'VARCHAR',
    required: false,
  });
  assert.throws(() => validateRequest(rename), /duplicate|conflict|field/i);
});
