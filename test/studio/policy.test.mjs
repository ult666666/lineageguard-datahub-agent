import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../../public/studio/core/contract.js';
import { assessCompatibility, fieldIndex } from '../../public/studio/core/policy.js';
import { buildArtifacts } from '../../public/studio/core/artifacts.js';
import { TARGET } from '../../public/studio/core/fixtures.js';

const schema = (fields) => ({ data: { fields }, digest: 'synthetic-schema-digest' });
const ORDERS = schema([
  { name: 'order_id', type: 'BIGINT', nullable: false },
  { name: 'order_total', type: 'DECIMAL(12,2)', nullable: false },
  { name: 'quantity', type: 'INT', nullable: false },
  { name: 'status', type: 'VARCHAR(32)', nullable: true },
]);
const request = (...changes) =>
  validateRequest({ datasetUrn: TARGET, changeRequest: { summary: 'Policy check', changes } });
const codes = (result) => result.reasons.map((r) => r.code).sort();

test('field lookup is case-insensitive and reports names that differ only by case', () => {
  const lookup = fieldIndex([
    { name: 'status', type: 'VARCHAR(32)', nullable: true },
    { name: 'Region', type: 'VARCHAR(8)', nullable: true },
    { name: 'REGION', type: 'VARCHAR(8)', nullable: true },
  ]);
  assert.equal(lookup('STATUS').name, 'status');
  assert.equal(lookup('region'), null, 'two observed spellings are ambiguous');
  assert.equal(lookup('missing'), undefined);
});

test('a case variant of an existing column is a collision, never an additive change', () => {
  const added = assessCompatibility(
    request({ kind: 'add', field: 'ORDER_ID', type: 'BIGINT', required: false }),
    ORDERS,
  );
  assert.deepEqual(codes(added), ['FIELD_EXISTS']);
  assert.equal(added.hasBlockingChange, true);
  assert.match(added.reasons[0].detail, /ORDER_ID matches existing field order_id/);
  const renamed = assessCompatibility(
    request({ kind: 'rename', field: 'status', to: 'Order_Total' }),
    ORDERS,
  );
  assert.deepEqual(codes(renamed), ['FIELD_EXISTS']);
});

test('case variants of existing columns are judged as those columns', () => {
  assert.deepEqual(codes(assessCompatibility(request({ kind: 'drop', field: 'STATUS' }), ORDERS)), [
    'DESTRUCTIVE_CHANGE',
  ]);
  assert.deepEqual(
    codes(
      assessCompatibility(
        request({ kind: 'type_change', field: 'QUANTITY', from: 'INT', to: 'BIGINT' }),
        ORDERS,
      ),
    ),
    ['TYPE_WIDENING'],
  );
  const ambiguous = schema([
    { name: 'Region', type: 'VARCHAR(8)', nullable: true },
    { name: 'REGION', type: 'VARCHAR(8)', nullable: true },
  ]);
  const result = assessCompatibility(request({ kind: 'drop', field: 'region' }), ambiguous);
  assert.deepEqual(codes(result), ['SCHEMA_MISMATCH']);
  assert.match(result.reasons[0].detail, /more than one observed field/);
});

test('exact-case results keep their recorded wording so earlier exports still replay', () => {
  const result = assessCompatibility(
    request({ kind: 'add', field: 'status', type: 'VARCHAR(64)', required: false }),
    ORDERS,
  );
  assert.equal(result.reasons[0].detail, 'status already exists');
});

test('a rename that declares a different type is judged like a type change', () => {
  const lossy = assessCompatibility(
    request({ kind: 'rename', field: 'order_total', to: 'gross_amount', type: 'VARCHAR(5)' }),
    ORDERS,
  );
  assert.deepEqual(codes(lossy), ['NARROWING_TYPE', 'RENAME_CONTRACT']);
  assert.equal(lossy.hasBlockingChange, true);
  const wider = assessCompatibility(
    request({ kind: 'rename', field: 'quantity', to: 'item_count', type: 'BIGINT' }),
    ORDERS,
  );
  assert.deepEqual(codes(wider), ['RENAME_CONTRACT', 'TYPE_WIDENING']);
  assert.equal(wider.hasBlockingChange, false);
  for (const type of [undefined, 'DECIMAL(12,2)', 'NUMERIC(12,2)']) {
    const change = { kind: 'rename', field: 'order_total', to: 'gross_amount' };
    if (type) change.type = type;
    assert.deepEqual(codes(assessCompatibility(request(change), ORDERS)), ['RENAME_CONTRACT']);
  }
});

test('the SQL draft for a case-variant rename keeps the observed column type', () => {
  const checked = request({ kind: 'rename', field: 'ORDER_TOTAL', to: 'gross_amount' });
  const outputs = {
    resolve: { data: { name: 'prod.analytics.orders' } },
    schema: ORDERS,
    policy: {
      decision: 'review-required',
      evidenceReady: true,
      reasons: [],
      gaps: [],
      version: '2.0.0',
      evidenceIds: [],
    },
  };
  const { sql } = buildArtifacts(checked, outputs, 'binding');
  assert.match(sql, /ADD COLUMN gross_amount DECIMAL\(12,2\);/);
});
