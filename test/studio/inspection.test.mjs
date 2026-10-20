import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectReview,
  inspectReviewBytes,
  MAX_REVIEW_BYTES,
} from '../../public/studio/core/inspection.js';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
import {
  createRun,
  executeRun,
  verifyRun,
  acknowledgeRun,
} from '../../public/studio/core/runtime.js';
import { hash } from '../../public/studio/core/contract.js';

async function completed(id = 'rename', profile = 'standard') {
  const adapter = createFixtureAdapter(id);
  return executeRun(await createRun(scenario(id).request, makeRecipe(profile), adapter), {
    adapter,
  });
}
async function reseal(run) {
  const body = { ...run };
  delete body.checksum;
  run.checksum = await hash(body);
  return run;
}
async function output(run, id, value) {
  run.steps[id].output = value;
  run.steps[id].outputDigest = await hash(value);
}
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2));

test('offline inspection checks actual exports without network or mutating input', async (t) => {
  const run = await completed();
  const original = JSON.stringify(run);
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('inspection must be offline');
  });
  const report = await inspectReviewBytes(bytes(run));
  assert.equal(report.schema, 'lineageguard.inspection/1');
  assert.equal(report.integrity, 'pass');
  assert.equal(report.consistency, 'pass');
  assert.equal(report.runId, run.id);
  assert.equal(report.completed, true);
  assert.equal(report.recordedDecision, 'review-required');
  assert.equal(report.currentDecision, 'review-required');
  assert.equal(report.sourceAuthenticated, false);
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.toolCalls, 0);
  assert.equal(report.resumableImport, false);
  assert.equal(report.fileSha256.length, 64);
  assert.equal(report.evidence.length, 5);
  assert.equal(JSON.stringify(run), original);
  assert(!JSON.stringify(report).includes('ALTER TABLE'));
  assert(!JSON.stringify(report).includes(run.request.datasetUrn));
});

test('a checksum-only accepted projection drift is refused by the semantic inspector', async () => {
  const run = await completed('safe-add');
  run.result.artifacts.sql = '-- SYNTHETIC CHANGED EXPORT';
  await reseal(run);
  assert.equal(await verifyRun(run), true);
  await assert.rejects(inspectReview(run), { code: 'RESULT_PROJECTION_MISMATCH' });
});

test('a rehashed step draft that matches its result still must regenerate from the bound request', async () => {
  const run = await completed('safe-add');
  const value = { ...run.steps.artifacts.output, sql: '-- SYNTHETIC DIFFERENT PLAN' };
  await output(run, 'artifacts', value);
  run.result.artifacts = structuredClone(value);
  await reseal(run);
  assert.equal(await verifyRun(run), true);
  await assert.rejects(inspectReview(run), { code: 'ARTIFACT_REPLAY_MISMATCH' });
});

test('policy decisions cannot change just by refreshing checksums', async () => {
  const run = await completed('narrowing');
  const value = {
    ...run.steps.policy.output,
    decision: 'proceed-with-checks',
    evidenceReady: true,
  };
  await output(run, 'policy', value);
  run.result.policy = structuredClone(value);
  await reseal(run);
  await assert.rejects(inspectReview(run), { code: 'POLICY_REPLAY_MISMATCH' });
});

test('completed evidence is validated beyond a matching output hash', async () => {
  const run = await completed();
  const value = structuredClone(run.steps.schema.output);
  value.target = 'urn:li:dataset:wrong-target';
  const raw = { ...value };
  delete raw.digest;
  value.digest = await hash(raw);
  await output(run, 'schema', value);
  run.result.evidence.schema = structuredClone(value);
  await reseal(run);
  await assert.rejects(inspectReview(run), { code: 'INVALID_EVIDENCE' });
});

test('evidence inner digest and source-mode mismatches are rejected', async () => {
  for (const mutate of [
    (e) => {
      e.digest = '0'.repeat(64);
    },
    (e) => {
      e.source.mode = 'datahub-mcp';
    },
  ]) {
    const run = await completed();
    const value = structuredClone(run.steps.usage.output);
    mutate(value);
    await output(run, 'usage', value);
    run.result.evidence.usage = structuredClone(value);
    await reseal(run);
    await assert.rejects(inspectReview(run), { code: 'EVIDENCE_BINDING_MISMATCH' });
  }
});

test('current freshness is distinct from the recorded valid decision', async () => {
  const run = await completed('safe-add');
  const now = Date.parse(run.updatedAt) + 2 * 86400000;
  const report = await inspectReview(run, { now });
  assert.equal(report.consistency, 'pass');
  assert.equal(report.recordedDecision, 'proceed-with-checks');
  assert.equal(report.currentDecision, 'needs-evidence');
  assert.equal(report.evidenceReadyNow, false);
  assert(report.evidence.every((e) => e.freshness === 'stale'));
  assert.equal(report.executionAuthorized, false);
});

test('partial and failed checkpoints stay incomplete rather than inventing a review', async () => {
  for (const id of ['rename', 'lineage-outage']) {
    const a = createFixtureAdapter(id);
    const run = await executeRun(await createRun(scenario(id).request, makeRecipe('standard'), a), {
      adapter: a,
      pauseBeforePolicy: id === 'rename',
    });
    const report = await inspectReview(run);
    assert.equal(report.completed, false);
    assert.equal(report.recordedDecision, null);
    assert.equal(report.currentDecision, null);
    assert.equal(report.evidenceReadyNow, false);
    assert.equal(report.runStatus, id === 'rename' ? 'paused' : 'failed');
  }
});

test('normal, blocked, incomplete, stale and strict-profile outputs all replay consistently', async () => {
  for (const id of [
    'safe-add',
    'rename',
    'narrowing',
    'missing-usage',
    'partial-lineage',
    'stale-evidence',
  ]) {
    const run = await completed(id);
    const report = await inspectReview(run);
    assert.equal(report.recordedDecision, run.result.policy.decision, id);
    assert.equal(report.consistency, 'pass', id);
  }
  assert.equal((await inspectReview(await completed('rename', 'strict'))).consistency, 'pass');
});

test('an acknowledgement stays explicitly unauthenticated and is never execution permission', async () => {
  const run = await acknowledgeRun(
    await completed('safe-add'),
    'Synthetic reviewer',
    'Synthetic inspection',
  );
  const report = await inspectReview(run);
  assert.equal(report.acknowledgement, 'local-unverified');
  assert.equal(report.executionAuthorized, false);
  assert(!JSON.stringify(report).includes('Synthetic reviewer'));
});

test('corruption, unsupported fields and invented result on partial state are refused', async () => {
  const changed = await completed();
  changed.events[0].type = 'changed';
  await assert.rejects(inspectReview(changed));
  const extra = await completed();
  extra.unexpected = true;
  await reseal(extra);
  await assert.rejects(inspectReview(extra), { code: 'INVALID_FIELDS' });
  const a = createFixtureAdapter('rename');
  const incomplete = await createRun(scenario('rename').request, makeRecipe('standard'), a);
  incomplete.result = { policy: { executionAuthorized: false } };
  await reseal(incomplete);
  await assert.rejects(inspectReview(incomplete), { code: 'INCOMPLETE_RESULT' });
});

test('file inspection rejects ambiguous duplicate keys, poison keys, invalid UTF-8 and oversize data', async () => {
  await assert.rejects(inspectReviewBytes(new TextEncoder().encode('{"id":1,"\\u0069d":2}')), {
    code: 'DUPLICATE_JSON_KEY',
  });
  await assert.rejects(inspectReviewBytes(new TextEncoder().encode('{"__proto__":{}}')), {
    code: 'INVALID_DATA',
  });
  await assert.rejects(inspectReviewBytes(new Uint8Array([0xc3, 0x28])), { code: 'INVALID_JSON' });
  await assert.rejects(inspectReviewBytes(new Uint8Array(MAX_REVIEW_BYTES + 1)), {
    code: 'DATA_LIMIT',
  });
  await assert.rejects(inspectReviewBytes(new TextEncoder().encode('not a review')), {
    code: 'INVALID_JSON',
  });
});

test('escaped strings and whitespace survive JSON ambiguity checks without being executed', async () => {
  const run = await completed();
  const report = await inspectReviewBytes(
    new TextEncoder().encode('\n\t' + JSON.stringify(run, null, '\t') + '\n'),
  );
  assert.equal(report.integrity, 'pass');
});

test('policy replay checks interior freshness transitions, not just time-window endpoints', async () => {
  const { assessCompatibility, evaluatePolicy } =
    await import('../../public/studio/core/policy.js');
  const { buildArtifacts } = await import('../../public/studio/core/artifacts.js');
  const run = await completed('safe-add');
  const start = Date.now(),
    middle = start + 6,
    end = start + 20;
  const data = {};
  for (const id of ['resolve', 'schema', 'lineage', 'usage', 'ownership']) {
    const e = structuredClone(run.steps[id].output);
    e.observedAt = new Date(
      id === 'schema' ? start + 300005 : id === 'usage' ? start - 86400000 + 9 : start,
    ).toISOString();
    const raw = { ...e };
    delete raw.digest;
    e.digest = await hash(raw);
    await output(run, id, e);
    data[id] = e;
  }
  data.compatibility = assessCompatibility(run.request, data.schema);
  await output(run, 'compatibility', data.compatibility);
  data.policy = evaluatePolicy(run.request, run.recipe, data, middle);
  assert.equal(data.policy.decision, 'proceed-with-checks');
  assert.equal(evaluatePolicy(run.request, run.recipe, data, start).decision, 'needs-evidence');
  assert.equal(evaluatePolicy(run.request, run.recipe, data, end).decision, 'needs-evidence');
  await output(run, 'policy', data.policy);
  run.steps.policy.startedAt = new Date(start).toISOString();
  run.steps.policy.endedAt = new Date(end).toISOString();
  data.artifacts = buildArtifacts(run.request, data, run.binding);
  await output(run, 'artifacts', data.artifacts);
  run.result = {
    policy: data.policy,
    artifacts: data.artifacts,
    evidence: Object.fromEntries(
      ['resolve', 'schema', 'lineage', 'usage', 'ownership'].map((id) => [id, data[id]]),
    ),
  };
  await reseal(run);
  assert.equal((await inspectReview(run, { now: middle })).consistency, 'pass');
});

test('inspection rejects executable accessors without invoking them and keeps source authentication false', async () => {
  let called = false;
  const raw = {};
  Object.defineProperty(raw, 'schema', {
    enumerable: true,
    get() {
      called = true;
      return 'lineageguard.run/2';
    },
  });
  await assert.rejects(inspectReview(raw), { code: 'INVALID_DATA' });
  assert.equal(called, false);
  const a = createFixtureAdapter('rename');
  const request = scenario('rename').request;
  request.changeRequest.summary =
    'Quoted "field": { braces }, slash \\ and newline\nremain plain text';
  const run = await executeRun(await createRun(request, makeRecipe('standard'), a), { adapter: a });
  const report = await inspectReviewBytes(bytes(run));
  assert.equal(report.sourceAuthenticated, false);
  assert.equal(report.executionAuthorized, false);
});
