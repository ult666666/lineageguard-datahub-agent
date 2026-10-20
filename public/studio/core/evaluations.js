import { POLICY_VERSION, STUDIO_VERSION } from './contract.js';
import { makeRecipe } from './recipe.js';
import { scenario, createFixtureAdapter, FIXTURE_REVISION } from './fixtures.js';
import { createRun, executeRun, verifyRun } from './runtime.js';
export async function evaluateSuite({ onResult = () => {}, signal } = {}) {
  const checks = [];
  const start = performance.now();
  const add = async (name, expected, actual) => {
    const row = { name, expected, actual, pass: expected === actual };
    checks.push(row);
    await onResult(row);
  };
  for (const [id, expected] of [
    ['safe-add', 'proceed-with-checks'],
    ['rename', 'review-required'],
    ['narrowing', 'block'],
    ['missing-usage', 'needs-evidence'],
    ['partial-lineage', 'needs-evidence'],
    ['stale-evidence', 'needs-evidence'],
  ]) {
    signal?.throwIfAborted();
    const a = createFixtureAdapter(id);
    const run = await executeRun(await createRun(scenario(id).request, makeRecipe('standard'), a), {
      adapter: a,
      signal,
    });
    await add(scenario(id).label, expected, run.result?.policy.decision || run.status);
    await add(`${id}: checkpoint integrity`, true, await verifyRun(run));
  }
  const retry = createFixtureAdapter('transient-tool'),
    request = scenario('transient-tool').request;
  const retried = await executeRun(await createRun(request, makeRecipe('standard'), retry), {
    adapter: retry,
    signal,
  });
  await add('Read retry preserves two attempts', 2, retried.steps.lineage.attempts);
  const outage = createFixtureAdapter('lineage-outage');
  const failed = await executeRun(
    await createRun(scenario('lineage-outage').request, makeRecipe('standard'), outage),
    { adapter: outage, signal },
  );
  await add('Source outage is not a successful report', 'failed', failed.status);
  const restored = await executeRun(failed, {
    adapter: createFixtureAdapter('lineage-outage', { restored: true }),
    signal,
  });
  await add('Resume after source recovery', 'completed', restored.status);
  await add('Recovery retains the exact run identity', failed.id, restored.id);
  const adapter = createFixtureAdapter('rename');
  const paused = await executeRun(
    await createRun(scenario('rename').request, makeRecipe('standard'), adapter),
    { adapter, signal, pauseBeforePolicy: true },
  );
  await add('Pause before policy', 'paused', paused.status);
  const resumed = await executeRun(paused, { adapter, signal });
  await add(
    'No duplicate successful source calls after pause',
    paused.callsUsed,
    resumed.callsUsed,
  );
  const broken = structuredClone(resumed);
  broken.events[0].type = 'modified';
  let rejected = false;
  try {
    await verifyRun(broken);
  } catch {
    rejected = true;
  }
  await add('Changed event chain is rejected', true, rejected);
  return {
    schema: 'lineageguard.evaluations/2',
    version: STUDIO_VERSION,
    policyVersion: POLICY_VERSION,
    fixtureRevision: FIXTURE_REVISION,
    observedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - start),
    total: checks.length,
    passed: checks.filter((r) => r.pass).length,
    failed: checks.filter((r) => !r.pass).length,
    checks,
    scope:
      'Executed deterministic synthetic scenarios. Not live-tenant, model-quality or production migration validation.',
  };
}
