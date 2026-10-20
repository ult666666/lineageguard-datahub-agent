import { snapshot, requireThat, StudioError } from './contract.js';
export const FIXTURE_REVISION = 'orders-lab-2.0.0';
export const TARGET = 'urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.analytics.orders,PROD)';
const CATALOG = {
  name: 'prod.analytics.orders',
  platform: 'snowflake',
  fields: [
    { name: 'order_id', type: 'BIGINT', nullable: false },
    { name: 'order_total', type: 'DECIMAL(12,2)', nullable: false },
    { name: 'customer_id', type: 'BIGINT', nullable: true },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false },
  ],
  nodes: [
    { id: 'orders', urn: TARGET, name: 'orders', type: 'dataset', owner: 'Commerce Data' },
    {
      id: 'revenue',
      urn: 'urn:li:dataset:synthetic_revenue',
      name: 'fct_revenue',
      type: 'dataset',
      owner: 'Finance Analytics',
    },
    {
      id: 'dashboard',
      urn: 'urn:li:dashboard:synthetic_revenue',
      name: 'Revenue dashboard',
      type: 'dashboard',
      owner: 'Finance Analytics',
    },
    {
      id: 'close',
      urn: 'urn:li:dataJob:synthetic_close',
      name: 'Monthly close',
      type: 'pipeline',
      owner: 'Finance Operations',
    },
    {
      id: 'model',
      urn: 'urn:li:mlModel:synthetic_forecast',
      name: 'Demand forecast',
      type: 'model',
      owner: 'Applied ML',
    },
  ],
  edges: [
    { from: 'orders', to: 'revenue', level: 'table' },
    { from: 'revenue', to: 'dashboard', level: 'table' },
    { from: 'revenue', to: 'close', level: 'table' },
    { from: 'orders', to: 'model', level: 'table' },
  ],
  paths: [
    {
      from: 'orders.order_total',
      to: 'revenue.gross_amount',
      level: 'column',
      hops: ['orders.order_total', 'revenue.gross_amount'],
    },
    {
      from: 'revenue.gross_amount',
      to: 'dashboard.revenue',
      level: 'column',
      hops: ['revenue.gross_amount', 'dashboard.revenue'],
    },
  ],
};
export const SCENARIOS = [
  {
    id: 'rename',
    label: 'Revenue field rename',
    detail: 'Known consumers. An additive rollout needs human review.',
    change: 'rename',
    evidence: 'complete',
  },
  {
    id: 'safe-add',
    label: 'Optional field addition',
    detail: 'Complete evidence, no destructive change.',
    change: 'add',
    evidence: 'complete',
  },
  {
    id: 'narrowing',
    label: 'Numeric narrowing',
    detail: 'BIGINT → SMALLINT is not safe because both are numeric.',
    change: 'narrow',
    evidence: 'complete',
  },
  {
    id: 'missing-usage',
    label: 'Missing usage evidence',
    detail: 'Unknown activity must never be interpreted as zero.',
    change: 'add',
    evidence: 'missing-usage',
  },
  {
    id: 'partial-lineage',
    label: 'Truncated lineage',
    detail: 'Two returned consumers do not prove the graph is complete.',
    change: 'add',
    evidence: 'partial-lineage',
  },
  {
    id: 'stale-evidence',
    label: 'Stale catalog observation',
    detail: 'Old evidence is visible, but cannot support readiness.',
    change: 'add',
    evidence: 'stale',
  },
  {
    id: 'lineage-outage',
    label: 'Evidence-source outage',
    detail: 'Fail, restore the synthetic source, then resume the same run.',
    change: 'rename',
    evidence: 'complete',
    fault: 'outage',
  },
  {
    id: 'transient-tool',
    label: 'Transient tool failure',
    detail: 'One retry repairs a read; the trace preserves both attempts.',
    change: 'rename',
    evidence: 'complete',
    fault: 'transient',
  },
];
export function scenario(id) {
  const row = SCENARIOS.find((s) => s.id === id);
  requireThat(row, 'UNKNOWN_SCENARIO', 'Unknown synthetic scenario');
  const change =
    row.change === 'add'
      ? { kind: 'add', field: 'campaign_id', type: 'VARCHAR(64)', required: false }
      : row.change === 'narrow'
        ? { kind: 'type_change', field: 'order_id', from: 'BIGINT', to: 'SMALLINT' }
        : { kind: 'rename', field: 'order_total', to: 'gross_amount', type: 'DECIMAL(12,2)' };
  return {
    ...snapshot(row),
    request: { datasetUrn: TARGET, changeRequest: { summary: row.label, changes: [change] } },
  };
}
export function createFixtureAdapter(
  id,
  { delayMs = 0, restored = false, now = () => new Date().toISOString() } = {},
) {
  const spec = scenario(id);
  const revision = `${FIXTURE_REVISION}:${spec.evidence}`;
  let lineageCalls = 0;
  return {
    mode: 'synthetic-fixture',
    revision,
    scenarioId: id,
    readOnly: true,
    async read(kind, request, { signal, attempt = 1 } = {}) {
      signal?.throwIfAborted();
      requireThat(
        request.datasetUrn === TARGET,
        'TARGET_MISMATCH',
        'Fixture target does not match the request',
      );
      requireThat(
        ['resolve', 'schema', 'lineage', 'usage', 'ownership', 'paths'].includes(kind),
        'CAPABILITY_DENIED',
        'Unknown read-only fixture tool',
      );
      if (delayMs > 0)
        await new Promise((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(new StudioError('CANCELLED', 'Read cancelled'));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', stop);
            resolve();
          }, delayMs);
          signal?.addEventListener('abort', stop, { once: true });
        });
      signal?.throwIfAborted();
      if (kind === 'lineage') {
        lineageCalls++;
        if (
          !restored &&
          (spec.fault === 'outage' ||
            (spec.fault === 'transient' && lineageCalls === 1 && attempt === 1))
        )
          throw new StudioError('TOOL_UNAVAILABLE', 'Synthetic evidence source unavailable');
      }
      const observedAt =
        spec.evidence === 'stale' ? new Date(Date.parse(now()) - 172800000).toISOString() : now();
      let coverage = 'complete',
        data;
      if (kind === 'resolve')
        data = { urn: TARGET, name: CATALOG.name, platform: CATALOG.platform };
      if (kind === 'schema') data = { fields: CATALOG.fields };
      if (kind === 'lineage') {
        const partial = spec.evidence === 'partial-lineage';
        coverage = partial ? 'partial' : 'complete';
        data = {
          nodes: partial ? CATALOG.nodes.slice(0, 3) : CATALOG.nodes,
          edges: partial ? CATALOG.edges.slice(0, 2) : CATALOG.edges,
          total: CATALOG.nodes.length - 1,
          level: 'table',
        };
      }
      if (kind === 'usage') {
        coverage = spec.evidence === 'missing-usage' ? 'unknown' : 'complete';
        data = { weeklyQueries: coverage === 'unknown' ? null : 69, windowDays: 7 };
      }
      if (kind === 'ownership')
        data = {
          owners: CATALOG.nodes.map((n) => ({ urn: n.urn, name: n.owner })),
          unassigned: [],
        };
      if (kind === 'paths') data = { paths: CATALOG.paths, level: 'column' };
      return snapshot({
        kind,
        target: TARGET,
        observedAt,
        source: { mode: 'synthetic-fixture', revision },
        coverage,
        data,
      });
    },
  };
}
