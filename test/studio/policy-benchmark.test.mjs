import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical } from '../../public/studio/core/contract.js';
import {
  CASES_FILE,
  REPORT_FILE,
  codeMetrics,
  decisionMetrics,
  direction,
  formatReport,
  loadCases,
  replaceBlock,
  runCase,
} from '../../src/studio/policy-benchmark.mjs';

const cases = () => JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
const row = (expected, observed, reasons = [[], []]) => ({
  expected: { decision: expected, reasons: reasons[0], gaps: [] },
  observed: { decision: observed, reasons: reasons[1], gaps: [] },
});

test('decision metrics match a hand-computed confusion matrix', () => {
  const rows = [
    row('block', 'block'),
    row('block', 'block'),
    row('review-required', 'block'),
    row('review-required', 'review-required'),
    row('proceed-with-checks', 'review-required'),
  ];
  const m = decisionMetrics(rows);
  assert.equal(m.confusion.block.block, 2);
  assert.equal(m.confusion['review-required'].block, 1);
  assert.deepEqual(m.perOutcome.block, {
    labelled: 2,
    predicted: 3,
    precision: 0.6667,
    recall: 1,
    f1: 0.8,
  });
  assert.deepEqual(m.perOutcome['review-required'], {
    labelled: 2,
    predicted: 2,
    precision: 0.5,
    recall: 0.5,
    f1: 0.5,
  });
  assert.equal(m.perOutcome['proceed-with-checks'].precision, null, 'never predicted');
  assert.equal(m.perOutcome['proceed-with-checks'].recall, 0);
  assert.equal(m.perOutcome.failed.recall, null, 'never labelled');
});

test('reason metrics count repeated codes as a multiset', () => {
  const rows = [
    row('block', 'block', [['ADDITIVE_CHANGE', 'ADDITIVE_CHANGE'], ['ADDITIVE_CHANGE']]),
    row('block', 'block', [['NARROWING_TYPE'], ['NARROWING_TYPE', 'TYPE_WIDENING']]),
  ];
  const m = codeMetrics(rows, 'reasons');
  assert.deepEqual(m.perCode.ADDITIVE_CHANGE, {
    labelled: 2,
    predicted: 1,
    precision: 1,
    recall: 0.5,
    f1: 0.6667,
  });
  assert.equal(m.perCode.TYPE_WIDENING.precision, 0);
  assert.deepEqual(
    [m.micro.labelled, m.micro.predicted, m.micro.precision, m.micro.recall],
    [3, 3, 0.6667, 0.6667],
  );
});

test('direction orders outcomes by how firmly they stop a change', () => {
  assert.equal(direction('block', 'proceed-with-checks'), 'more-permissive');
  assert.equal(direction('review-required', 'block'), 'stricter');
  assert.equal(direction('needs-evidence', 'failed'), 'different-stop');
  assert.equal(direction('failed', 'failed'), 'match');
});

test('the case file is validated strictly so a typo cannot drop a check', () => {
  assert.equal(loadCases(cases()).cases.length > 80, true);
  const broken = [
    (f) => (f.cases[0].expectd = f.cases[0].expected),
    (f) => (f.cases[1].id = f.cases[0].id),
    (f) => (f.cases[0].expected.reasons = ['ADDITIVE']),
    (f) => (f.cases[0].expected.gaps = ['usage:STALE']),
    (f) => (f.cases[0].expected.decision = 'approve'),
    (f) => (f.cases[0].expected.failedStep = 'usage'),
    (f) => (f.cases[0].twin = 'no-such-case'),
    (f) => (f.cases[0].evidence = { ownerless: ['ghost'] }),
    (f) => (f.cases[0].evidence = { coverage: { audit: 'partial' } }),
    (f) => (f.cases[0].evidence = { owners: [] }),
    (f) => (f.cases[0].rationale = ''),
  ];
  for (const mutate of broken) {
    const file = cases();
    mutate(file);
    assert.throws(() => loadCases(file), /INVALID|Missing or unsupported|Case /);
  }
});

test('cases run through the interpreter, including evidence that breaks its contract', async () => {
  const file = loadCases(cases());
  const get = (id) => file.cases.find((c) => c.id === id);
  assert.deepEqual(await runCase(file.world, get('add-optional-column')), {
    decision: 'proceed-with-checks',
    reasons: ['ADDITIVE_CHANGE'],
    gaps: [],
  });
  assert.deepEqual(await runCase(file.world, get('lineage-count-does-not-reconcile')), {
    decision: 'failed',
    reasons: [],
    gaps: [],
    failedStep: 'lineage',
  });
  const strict = await runCase(file.world, get('strict-evidence-70min-old'));
  assert.equal(strict.decision, 'needs-evidence');
  assert.equal(strict.gaps.length, 6);
});

test('the pinned report belongs to the committed cases and has no permissive misses', () => {
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  const digest = createHash('sha256').update(canonical(cases())).digest('hex');
  assert.equal(report.casesSha256, digest, 'run npm run studio:benchmark -- --write');
  assert.equal(report.summary.morePermissive, 0);
  assert.equal(report.results.length, report.summary.cases);
  assert.equal(formatReport(report), fs.readFileSync(REPORT_FILE, 'utf8'));
});

test('generated document blocks are replaced only between one pair of markers', () => {
  const text = 'a\n<!-- x:start -->\nold\n<!-- x:end -->\nb';
  assert.equal(replaceBlock(text, 'x', 'new'), 'a\n<!-- x:start -->\nnew\n<!-- x:end -->\nb');
  assert.throws(() => replaceBlock('no markers', 'x', 'new'), /markers/);
  assert.throws(() => replaceBlock(`${text}\n<!-- x:start -->`, 'x', 'new'), /markers/);
});
