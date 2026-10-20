import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash, validateRequest, snapshot } from '../../public/studio/core/contract.js';
import { makeRecipe, compileRecipe } from '../../public/studio/core/recipe.js';
import { scenario, createFixtureAdapter, SCENARIOS } from '../../public/studio/core/fixtures.js';
import {
  createRun,
  executeRun,
  verifyRun,
  acknowledgeRun,
} from '../../public/studio/core/runtime.js';
import { compareRuns } from '../../public/studio/core/comparison.js';

const runCase = async (id, options = {}) => {
  const spec = scenario(id),
    adapter = createFixtureAdapter(id, options.adapterOptions);
  const run = await createRun(spec.request, options.recipe || makeRecipe('standard'), adapter);
  return executeRun(run, { adapter, ...options });
};

test('canonical snapshots reject getters, cycles, symbols, poison keys and nonfinite numbers', () => {
  let calls = 0;
  assert.throws(() =>
    snapshot({
      get data() {
        calls++;
        return 1;
      },
    }),
  );
  assert.equal(calls, 0);
  const a = {};
  a.a = a;
  assert.throws(() => snapshot(a));
  for (const x of [NaN, Infinity, { [Symbol('x')]: 1 }, JSON.parse('{"__proto__":{}}')])
    assert.throws(() => snapshot(x));
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
});
test('request validation snapshots inputs and rejects unsupported capability fields', () => {
  const input = scenario('rename').request;
  const valid = validateRequest(input);
  input.changeRequest.summary = 'changed';
  assert.notEqual(valid.changeRequest.summary, input.changeRequest.summary);
  assert.throws(() => validateRequest({ ...valid, executeSql: true }));
  assert.throws(() => validateRequest({ ...valid, datasetUrn: 'https://arbitrary.example' }));
});
test('recipe compiler validates dependencies, cycles, uniqueness and bounded budgets', () => {
  for (const profile of ['standard', 'strict', 'sequential'])
    assert.equal(compileRecipe(makeRecipe(profile)).order.at(-1), 'artifacts');
  const mutate = (fn) => {
    const r = makeRecipe('standard');
    fn(r);
    assert.throws(() => compileRecipe(r));
  };
  mutate((r) => r.nodes.push({ ...r.nodes[0] }));
  mutate((r) => (r.nodes[0].dependsOn = ['artifacts']));
  mutate((r) => (r.nodes.find((n) => n.id === 'policy').dependsOn = []));
  mutate((r) => (r.nodes[0].operation = 'execute_sql'));
  mutate((r) => (r.budget.maxCalls = Infinity));
  mutate((r) => (r.budget.maxConcurrency = 9));
  mutate((r) => r.nodes[1].dependsOn.push('missing'));
});
test('complete safe additions pass checks while narrowing is blocked', async () => {
  const safe = await runCase('safe-add');
  assert.equal(safe.status, 'completed');
  assert.equal(safe.result.policy.decision, 'proceed-with-checks');
  assert.equal(safe.result.policy.evidenceReady, true);
  assert.equal(await verifyRun(safe), true);
  const narrow = await runCase('narrowing');
  assert.equal(narrow.result.policy.decision, 'block');
  assert(narrow.result.policy.reasons.some((r) => r.code === 'NARROWING_TYPE'));
});
test('unknown, truncated and stale evidence never becomes a favorable decision', async () => {
  for (const id of ['missing-usage', 'partial-lineage', 'stale-evidence']) {
    const run = await runCase(id);
    assert.equal(run.result.policy.evidenceReady, false, id);
    assert.equal(run.result.policy.decision, 'needs-evidence', id);
  }
});
test('workflow uses actual concurrency and exact dependency ordering', async () => {
  let active = 0,
    peak = 0;
  const adapter = createFixtureAdapter('rename', { delayMs: 12 });
  const read = adapter.read;
  adapter.read = async (...args) => {
    active++;
    peak = Math.max(peak, active);
    try {
      return await read(...args);
    } finally {
      active--;
    }
  };
  const run = await createRun(scenario('rename').request, makeRecipe('standard'), adapter);
  const result = await executeRun(run, { adapter });
  assert.equal(result.status, 'completed');
  assert(peak > 1);
  assert(peak <= 3);
  const events = result.events;
  assert(
    events.findIndex((e) => e.type === 'step.completed' && e.step === 'resolve') <
      events.findIndex((e) => e.type === 'step.started' && e.step === 'schema'),
  );
});
test('tool failures remain failures; retries are bounded and counted', async () => {
  const recipe = makeRecipe('standard');
  recipe.budget.retries = 0;
  const failed = await runCase('lineage-outage', { recipe });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.steps.lineage.status, 'failed');
  assert.equal(failed.result, null);
  const recovered = await runCase('transient-tool');
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.steps.lineage.attempts, 2);
  assert.equal(recovered.callsUsed, 6);
});
test('cancellation stops dispatch and never commits late evidence as complete', async () => {
  const controller = new AbortController();
  const adapter = createFixtureAdapter('rename', { delayMs: 40 });
  const run = await createRun(scenario('rename').request, makeRecipe('standard'), adapter);
  const resultPromise = executeRun(run, { adapter, signal: controller.signal });
  setTimeout(() => controller.abort(), 8);
  const result = await resultPromise;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.result, null);
  assert(!Object.values(result.steps).some((s) => s.status === 'running'));
  assert.equal(await verifyRun(result), true);
});
test('pause and resume reuses only checked complete evidence and increments generation', async () => {
  const adapter = createFixtureAdapter('rename');
  const run = await createRun(scenario('rename').request, makeRecipe('standard'), adapter);
  const paused = await executeRun(run, { adapter, pauseBeforePolicy: true });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.steps.policy.status, 'pending');
  const resumed = await executeRun(paused, { adapter });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.generation, 2);
  assert.equal(resumed.steps.schema.reused, true);
  assert.equal(resumed.callsUsed, paused.callsUsed);
  assert.equal(await verifyRun(resumed), true);
});
test('recovery refuses changed source revision and corrupted output or event history', async () => {
  const adapter = createFixtureAdapter('rename');
  const run = await createRun(scenario('rename').request, makeRecipe('standard'), adapter);
  const paused = await executeRun(run, { adapter, pauseBeforePolicy: true });
  await assert.rejects(
    executeRun(paused, { adapter: { ...adapter, revision: 'changed' } }),
    /binding|revision/i,
  );
  const damaged = structuredClone(paused);
  damaged.steps.schema.output.data.fields[0].name = 'tampered';
  await assert.rejects(verifyRun(damaged));
  const history = structuredClone(paused);
  history.events[0].type = 'tampered';
  await assert.rejects(verifyRun(history));
});
test('checkpoint persistence failure aborts the workflow instead of reporting success', async () => {
  const adapter = createFixtureAdapter('safe-add');
  const run = await createRun(scenario('safe-add').request, makeRecipe('standard'), adapter);
  await assert.rejects(
    executeRun(run, {
      adapter,
      onCheckpoint: () => {
        throw new Error('synthetic write failure');
      },
    }),
    /checkpoint/i,
  );
});
test('call budget and deadlines stop unbounded tool work', async () => {
  const recipe = makeRecipe('standard');
  recipe.budget.maxCalls = 2;
  const stopped = await runCase('safe-add', { recipe });
  assert.equal(stopped.status, 'failed');
  assert(stopped.callsUsed <= 2);
  const adapter = createFixtureAdapter('rename');
  adapter.read = () => new Promise(() => {});
  recipe.budget.maxCalls = 12;
  recipe.budget.stepTimeoutMs = 50;
  recipe.budget.retries = 0;
  const run = await createRun(scenario('rename').request, recipe, adapter);
  const result = await executeRun(run, { adapter });
  assert.equal(result.status, 'failed');
});
test('review acknowledgement is bound to the exact completed review, never execution authority', async () => {
  const run = await runCase('rename');
  const acknowledged = await acknowledgeRun(run, 'Charles', 'Reviewed synthetic evidence');
  assert.equal(acknowledged.review.executionAuthorized, false);
  assert.equal(acknowledged.review.binding, run.binding);
  const changed = structuredClone(acknowledged);
  changed.request.changeRequest.summary = 'different';
  await assert.rejects(verifyRun(changed));
});
test('comparisons identify changed requests rather than pretending identical baselines', async () => {
  const a = await runCase('rename'),
    b = await runCase('safe-add');
  const diff = compareRuns(a, b);
  assert.equal(diff.sameRequest, false);
  assert.notEqual(diff.left.decision, diff.right.decision);
});
