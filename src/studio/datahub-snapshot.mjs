import {
  snapshot,
  requireThat,
  hash,
  identifier,
  sqlType,
  StudioError,
} from '../../public/studio/core/contract.js';
import { extractToolJson } from '../datahub-mcp-client.mjs';
import { validateEvidence } from '../../public/studio/core/evidence.js';
const ownerName = (e) =>
  e?.ownership?.owners?.[0]?.owner?.properties?.displayName ||
  e?.ownership?.owners?.[0]?.owner?.name ||
  null;
const type = (e) => {
  const value = String(e.type || 'dataset')
    .toLowerCase()
    .replaceAll('_', '');
  return value.includes('model')
    ? 'model'
    : value.includes('dashboard')
      ? 'dashboard'
      : value.includes('chart')
        ? 'chart'
        : value.includes('job') || value.includes('pipeline')
          ? 'pipeline'
          : 'dataset';
};
/** Explicit local capture, then deterministic analysis against one immutable revision.
 * Raw tenant payloads are not exported. No live calls occur in the public demo.
 */
export async function captureDataHubSnapshot(
  client,
  target,
  { signal, observedAt = new Date().toISOString() } = {},
) {
  requireThat(
    typeof target === 'string' && target.startsWith('urn:li:dataset:') && target.length <= 2048,
    'INVALID_TARGET',
  );
  signal?.throwIfAborted();
  const [entityResult, lineageResult] = await Promise.all([
    client.callTool('get_entities', { urns: [target] }, { signal }),
    client.callTool(
      'get_lineage',
      { urn: target, column: null, upstream: false, max_hops: 3, max_results: 100, offset: 0 },
      { signal },
    ),
  ]);
  const rawEntity = snapshot(extractToolJson(entityResult), { maxBytes: 500000 }),
    rawLineage = snapshot(extractToolJson(lineageResult), { maxBytes: 500000 });
  const entity = (Array.isArray(rawEntity) ? rawEntity : [rawEntity]).find(
    (e) => e?.urn === target && !e.error,
  );
  requireThat(entity, 'TARGET_MISMATCH', 'Requested target was not returned by DataHub');
  const name = entity.name || entity.properties?.name;
  requireThat(
    typeof name === 'string' && name.length <= 515,
    'INVALID_EVIDENCE',
    'Dataset name is missing',
  );
  for (const part of name.split('.')) identifier(part);
  const revision =
    'datahub-snapshot:' +
    (await hash({ target, entity: rawEntity, lineage: rawLineage, profile: '2025-11-25' }));
  const envelopes = {},
    fields = [];
  let schemaCoverage = Array.isArray(entity.schemaMetadata?.fields) ? 'complete' : 'unknown';
  for (const field of entity.schemaMetadata?.fields || []) {
    try {
      identifier(field.fieldPath);
      const value = sqlType(field.nativeDataType);
      requireThat(typeof field.nullable === 'boolean', 'INVALID_EVIDENCE');
      fields.push({ name: field.fieldPath, type: value, nullable: field.nullable });
    } catch {
      schemaCoverage = 'partial';
    }
  }
  const container = rawLineage?.downstreams || rawLineage?.downstream;
  const returned = Array.isArray(container?.searchResults)
    ? container.searchResults
        .map((r) => r.entity)
        .filter((e) => e && typeof e.urn === 'string' && e.urn !== target)
    : [];
  const unique = [...new Map(returned.map((e) => [e.urn, e])).values()];
  requireThat(unique.length <= 100, 'DATA_LIMIT', 'Lineage capture exceeds the supported profile');
  const nodes = [
    { id: 'target', urn: target, name, type: 'dataset', owner: ownerName(entity) },
    ...unique.map((e, i) => ({
      id: 'asset-' + i,
      urn: e.urn,
      name: e.name || e.properties?.name || e.urn.slice(-100),
      type: type(e),
      owner: ownerName(e),
    })),
  ];
  const total =
    Number.isSafeInteger(container?.total) && container.total >= 0
      ? container.total
      : unique.length;
  const lineageCoverage =
    Number.isSafeInteger(container?.total) && container.total === unique.length
      ? 'complete'
      : Array.isArray(container?.searchResults)
        ? 'partial'
        : 'unknown';
  const weekly =
    typeof entity.weeklyQueries === 'number' &&
    Number.isSafeInteger(entity.weeklyQueries) &&
    entity.weeklyQueries >= 0
      ? entity.weeklyQueries
      : null;
  const add = (kind, coverage, data) =>
    (envelopes[kind] = {
      kind,
      target,
      observedAt,
      source: { mode: 'datahub-mcp', revision },
      coverage,
      data,
    });
  add('resolve', 'complete', {
    urn: target,
    name,
    platform: typeof entity.platform?.name === 'string' ? entity.platform.name : 'DataHub',
  });
  add('schema', schemaCoverage, { fields });
  // Flat search results establish returned reachable assets, not their exact edge paths.
  add('lineage', lineageCoverage, { nodes, edges: [], total, level: 'table' });
  add('usage', weekly === null ? 'unknown' : 'complete', { weeklyQueries: weekly, windowDays: 7 });
  add('ownership', 'complete', {
    owners: nodes.filter((n) => n.owner).map((n) => ({ urn: n.urn, name: n.owner })),
    unassigned: nodes.filter((n) => !n.owner).map((n) => n.urn),
  });
  add('paths', 'unknown', { paths: [], level: 'column' });
  for (const [kind, evidence] of Object.entries(envelopes))
    await validateEvidence(evidence, kind, { datasetUrn: target }, revision);
  return {
    mode: 'datahub-mcp',
    revision,
    readOnly: true,
    scenarioId: null,
    capture: { mcpToolCalls: 2, profile: '2025-11-25', observedAt, rawPayloadsRetained: false },
    async read(kind, request, { signal } = {}) {
      signal?.throwIfAborted();
      requireThat(
        request.datasetUrn === target,
        'TARGET_MISMATCH',
        'Capture target differs from requested target',
      );
      requireThat(
        Object.hasOwn(envelopes, kind),
        'CAPABILITY_DENIED',
        'Read is not in the captured evidence profile',
      );
      return snapshot(envelopes[kind]);
    },
  };
}
