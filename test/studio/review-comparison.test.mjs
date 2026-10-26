import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareReviewBytes } from '../../src/studio/review-comparison.mjs';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
import { createRun, executeRun } from '../../public/studio/core/runtime.js';
import { hash } from '../../public/studio/core/contract.js';

const encode = (run) => new TextEncoder().encode(JSON.stringify(run));
async function run(id = 'safe-add', profile = 'standard', options = {}) {
  const adapter = createFixtureAdapter(id);
  return executeRun(await createRun(scenario(id).request, makeRecipe(profile), adapter), {
    adapter,
    ...options,
  });
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('two inspected exports preserve recorded standard/strict comparison and file identities', async () => {
  const left = encode(await run()),
    right = encode(await run('safe-add', 'strict'));
  const report = await compareReviewBytes(left, right);
  assert.equal(report.schema, 'lineageguard.review-comparison/1');
  assert.equal(report.comparison.sameRequest, true);
  assert.equal(report.comparison.sameRecipe, false);
  assert.equal(report.comparison.sameSourceRevision, true);
  assert.equal(report.comparison.left.decision, 'proceed-with-checks');
  assert.equal(report.comparison.right.decision, 'review-required');
  assert.equal(report.comparison.left.calls, 5);
  assert.equal(report.comparison.right.calls, 6);
  assert.deepEqual(report.comparison.addedGaps, []);
  assert.equal(report.inspections.left.fileSha256, digest(left));
  assert.equal(report.inspections.right.fileSha256, digest(right));
  assert.equal(report.inspections.left.inspectedAt, report.inspections.right.inspectedAt);
  assert.equal(report.inspectedAt, report.inspections.left.inspectedAt);
  for (const scope of [report, report.inspections.left, report.inspections.right]) {
    assert.equal(scope.sourceAuthenticated, false);
    assert.equal(scope.executionAuthorized, false);
    assert.equal(scope.toolCalls, 0);
    assert.equal(scope.resumableImport, false);
  }
});

test('different requests stay explicit alternative plans rather than being rejected or relabelled', async () => {
  const report = await compareReviewBytes(encode(await run('rename')), encode(await run()));
  assert.equal(report.comparison.sameRequest, false);
  assert.equal(report.comparison.left.decision, 'review-required');
  assert.equal(report.comparison.right.decision, 'proceed-with-checks');
  assert.match(report.comparison.explanation, /alternative-plan comparison/);
});

test('current stale-evidence assessments never rewrite the recorded comparison decisions', async () => {
  const a = await run(),
    b = await run('safe-add', 'strict');
  const report = await compareReviewBytes(encode(a), encode(b), {
    now: Date.parse(b.updatedAt) + 3 * 86400000,
  });
  assert.equal(report.comparison.left.decision, 'proceed-with-checks');
  assert.equal(report.comparison.right.decision, 'review-required');
  assert.equal(report.inspections.left.currentDecision, 'needs-evidence');
  assert.equal(report.inspections.right.currentDecision, 'needs-evidence');
  assert.equal(report.inspections.left.evidenceReadyNow, false);
});

test('both byte inputs are owned before the first asynchronous inspection', async () => {
  const a = Buffer.from(encode(await run())),
    b = Buffer.from(encode(await run('safe-add', 'strict')));
  const aHash = digest(a),
    bHash = digest(b);
  const pending = compareReviewBytes(a, b);
  a.fill(0);
  b.fill(0);
  const report = await pending;
  assert.equal(report.inspections.left.fileSha256, aHash);
  assert.equal(report.inspections.right.fileSha256, bHash);
  assert.equal(report.comparison.sameRequest, true);
});

test('tampering on either side is refused including a rehashed semantic projection drift', async () => {
  const valid = await run(),
    changed = structuredClone(valid);
  changed.result.artifacts.sql = '-- SYNTHETIC_PRIVATE_CANARY';
  const body = { ...changed };
  delete body.checksum;
  changed.checksum = await hash(body);
  for (const side of ['left', 'right']) {
    const args =
      side === 'left' ? [encode(changed), encode(valid)] : [encode(valid), encode(changed)];
    await assert.rejects(compareReviewBytes(...args), { code: 'RESULT_PROJECTION_MISMATCH', side });
  }
});

test('malformed, ambiguous, oversized and nonbyte data fail with their input side', async () => {
  const good = encode(await run());
  for (const [value, code] of [
    [new Uint8Array([0xc3, 0x28]), 'INVALID_JSON'],
    [new TextEncoder().encode('{"id":1,"\\u0069d":2}'), 'DUPLICATE_JSON_KEY'],
    [new Uint8Array(4_000_001), 'DATA_LIMIT'],
    [new Uint8Array(), 'DATA_LIMIT'],
    ['not bytes', 'INVALID_INPUT'],
  ])
    for (const side of ['left', 'right']) {
      const args = side === 'left' ? [value, good] : [good, value];
      await assert.rejects(compareReviewBytes(...args), { code, side });
    }
});

test('internally consistent paused exports never become completed comparisons', async () => {
  const paused = encode(await run('safe-add', 'standard', { pauseBeforePolicy: true }));
  const good = encode(await run());
  for (const side of ['left', 'right']) {
    const args = side === 'left' ? [paused, good] : [good, paused];
    await assert.rejects(compareReviewBytes(...args), { code: 'COMPARISON_NOT_READY', side });
  }
});
