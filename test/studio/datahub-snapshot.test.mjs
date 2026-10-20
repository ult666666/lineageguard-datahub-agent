import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDataHubSnapshot } from '../../src/studio/datahub-snapshot.mjs';
import { TARGET, scenario } from '../../public/studio/core/fixtures.js';
import { createRun, executeRun } from '../../public/studio/core/runtime.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
function fixture() {
  return {
    entity: {
      urn: TARGET,
      name: 'prod.analytics.orders',
      platform: { name: 'snowflake' },
      weeklyQueries: 0,
      schemaMetadata: {
        fields: [
          { fieldPath: 'order_id', nativeDataType: 'BIGINT', nullable: false },
          { fieldPath: 'order_total', nativeDataType: 'DECIMAL(12,2)', nullable: false },
        ],
      },
      ownership: {
        owners: [
          {
            owner: {
              urn: 'urn:li:corpuser:synthetic-owner',
              properties: { displayName: 'Synthetic owner' },
            },
          },
        ],
      },
    },
    lineage: { downstreams: { total: 0, searchResults: [] } },
  };
}
function clientFor(data) {
  const calls = [];
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      return {
        isError: false,
        structuredContent: name === 'get_entities' ? [data.entity] : data.lineage,
      };
    },
  };
}
test('DataHub snapshot bridge calls only two read tools and binds exact returned evidence', async () => {
  const client = clientFor(fixture()),
    adapter = await captureDataHubSnapshot(client, TARGET);
  assert.deepEqual(client.calls.map((c) => c.name).sort(), ['get_entities', 'get_lineage']);
  assert.equal(adapter.mode, 'datahub-mcp');
  assert.equal(adapter.readOnly, true);
  const run = await executeRun(
    await createRun(scenario('safe-add').request, makeRecipe('standard'), adapter),
    { adapter },
  );
  assert.equal(run.result.policy.evidenceReady, true);
  assert.equal(run.result.policy.decision, 'proceed-with-checks');
  assert.equal(
    client.calls.length,
    2,
    'DAG uses the frozen capture, not hidden extra network reads',
  );
});
test('DataHub 30-day usage is not mislabeled as exact seven-day activity', async () => {
  const data = fixture();
  delete data.entity.weeklyQueries;
  data.entity.statsSummary = { queryCountLast30Days: 300 };
  const adapter = await captureDataHubSnapshot(clientFor(data), TARGET);
  const evidence = await adapter.read('usage', scenario('rename').request);
  assert.equal(evidence.coverage, 'unknown');
  assert.equal(evidence.data.weeklyQueries, null);
});
test('partial and structurally unknown DataHub metadata stays incomplete', async () => {
  const data = fixture();
  delete data.entity.schemaMetadata;
  data.lineage.downstreams.total = 5;
  const adapter = await captureDataHubSnapshot(clientFor(data), TARGET);
  assert.equal((await adapter.read('schema', scenario('rename').request)).coverage, 'unknown');
  assert.equal((await adapter.read('lineage', scenario('rename').request)).coverage, 'partial');
  assert.equal((await adapter.read('paths', scenario('rename').request)).coverage, 'unknown');
});
test('DataHub bridge rejects a wrong target or error-marked result instead of relabeling it', async () => {
  const data = fixture();
  data.entity.urn = 'urn:li:dataset:wrong';
  await assert.rejects(captureDataHubSnapshot(clientFor(data), TARGET), /target/i);
  await assert.rejects(
    captureDataHubSnapshot(
      { callTool: async () => ({ isError: true, structuredContent: fixture().entity }) },
      TARGET,
    ),
    /tool/i,
  );
});
test('DataHub evidence revision changes when captured metadata changes', async () => {
  const a = fixture(),
    b = fixture();
  b.entity.weeklyQueries = 100;
  const first = await captureDataHubSnapshot(clientFor(a), TARGET),
    second = await captureDataHubSnapshot(clientFor(b), TARGET);
  assert.notEqual(first.revision, second.revision);
});
