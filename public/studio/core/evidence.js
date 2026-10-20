import { snapshot, exact, requireThat, identifier, sqlType, hash } from './contract.js';
const list = (x, max = 250) => Array.isArray(x) && x.length <= max;
const bounded = (x, max = 2048) => typeof x === 'string' && x.length > 0 && x.length <= max;
export async function validateEvidence(raw, kind, request, revision) {
  const e = snapshot(raw, { maxBytes: 200000, maxNodes: 8000, maxDepth: 14 });
  exact(e, ['kind', 'target', 'observedAt', 'source', 'coverage', 'data']);
  requireThat(
    e.kind === kind && e.target === request.datasetUrn,
    'INVALID_EVIDENCE',
    'Evidence target or kind mismatch',
  );
  exact(e.source, ['mode', 'revision']);
  requireThat(
    ['synthetic-fixture', 'datahub-mcp'].includes(e.source.mode) && e.source.revision === revision,
    'INVALID_EVIDENCE',
    'Evidence source revision mismatch',
  );
  requireThat(
    ['complete', 'partial', 'unknown'].includes(e.coverage) &&
      bounded(e.observedAt, 40) &&
      Number.isFinite(Date.parse(e.observedAt)),
    'INVALID_EVIDENCE',
    'Invalid evidence metadata',
  );
  const d = e.data;
  if (kind === 'resolve') {
    exact(d, ['urn', 'name', 'platform']);
    requireThat(
      d.urn === request.datasetUrn && bounded(d.name, 515) && bounded(d.platform, 80),
      'INVALID_EVIDENCE',
    );
    requireThat(d.name.split('.').length <= 4, 'INVALID_EVIDENCE');
    for (const part of d.name.split('.')) identifier(part);
  } else if (kind === 'schema') {
    exact(d, ['fields']);
    requireThat(list(d.fields), 'INVALID_EVIDENCE');
    const names = new Set();
    for (const field of d.fields) {
      exact(field, ['name', 'type', 'nullable']);
      identifier(field.name);
      sqlType(field.type);
      requireThat(
        !names.has(field.name) && typeof field.nullable === 'boolean',
        'INVALID_EVIDENCE',
      );
      names.add(field.name);
    }
  } else if (kind === 'lineage') {
    exact(d, ['nodes', 'edges', 'total', 'level']);
    requireThat(
      list(d.nodes) &&
        list(d.edges, 500) &&
        Number.isInteger(d.total) &&
        d.total >= 0 &&
        ['table', 'column'].includes(d.level),
      'INVALID_EVIDENCE',
    );
    const ids = new Set();
    for (const n of d.nodes) {
      exact(n, ['id', 'urn', 'name', 'type', 'owner']);
      requireThat(
        bounded(n.id, 128) &&
          !ids.has(n.id) &&
          bounded(n.urn) &&
          bounded(n.name, 160) &&
          ['dataset', 'dashboard', 'pipeline', 'model', 'chart'].includes(n.type) &&
          (n.owner === null || bounded(n.owner, 160)),
        'INVALID_EVIDENCE',
      );
      ids.add(n.id);
    }
    for (const edge of d.edges) {
      exact(edge, ['from', 'to', 'level']);
      requireThat(
        ids.has(edge.from) && ids.has(edge.to) && ['table', 'column'].includes(edge.level),
        'INVALID_EVIDENCE',
      );
    }
    requireThat(
      d.nodes.some((n) => n.urn === request.datasetUrn),
      'INVALID_EVIDENCE',
      'Lineage root is missing',
    );
    if (e.coverage === 'complete')
      requireThat(
        d.total === d.nodes.filter((n) => n.urn !== request.datasetUrn).length,
        'INVALID_EVIDENCE',
        'Complete lineage count does not reconcile',
      );
  } else if (kind === 'usage') {
    exact(d, ['weeklyQueries', 'windowDays']);
    requireThat(
      d.windowDays === 7 &&
        (d.weeklyQueries === null ||
          (Number.isSafeInteger(d.weeklyQueries) && d.weeklyQueries >= 0)),
      'INVALID_EVIDENCE',
    );
    requireThat(
      e.coverage !== 'complete' || d.weeklyQueries !== null,
      'INVALID_EVIDENCE',
      'Unknown usage cannot be marked complete',
    );
  } else if (kind === 'ownership') {
    exact(d, ['owners', 'unassigned']);
    requireThat(list(d.owners) && list(d.unassigned), 'INVALID_EVIDENCE');
    for (const o of d.owners) {
      exact(o, ['urn', 'name']);
      requireThat(bounded(o.urn) && bounded(o.name, 160), 'INVALID_EVIDENCE');
    }
    requireThat(
      d.unassigned.every((x) => bounded(x)),
      'INVALID_EVIDENCE',
    );
  } else if (kind === 'paths') {
    exact(d, ['paths', 'level']);
    requireThat(d.level === 'column' && list(d.paths), 'INVALID_EVIDENCE');
    for (const p of d.paths) {
      exact(p, ['from', 'to', 'level', 'hops']);
      requireThat(
        p.level === 'column' &&
          bounded(p.from) &&
          bounded(p.to) &&
          list(p.hops, 20) &&
          p.hops.length >= 2 &&
          p.hops.every((x) => bounded(x)) &&
          p.hops[0] === p.from &&
          p.hops.at(-1) === p.to,
        'INVALID_EVIDENCE',
      );
    }
  } else requireThat(false, 'INVALID_EVIDENCE', 'Unknown evidence kind');
  return { ...e, digest: await hash(e) };
}
export function evidenceFreshness(e, now = Date.now(), maxAgeMs = 86400000) {
  const age = now - Date.parse(e.observedAt);
  return age < -300000 ? 'future' : age > maxAgeMs ? 'stale' : 'current';
}
