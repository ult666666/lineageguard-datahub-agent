import { StudioError, hash, identifier, requireThat, snapshot, sqlType } from './contract.js';
import { validateEvidence } from './evidence.js';

// dbt artifacts as an offline evidence source. A manifest records what a dbt project
// declares: nodes, their depends_on edges, owners, groups, exposures and tests. It does
// not record query history, column nullability or consumers outside the project, so
// those stay unknown or partial evidence and never clear a change.
// Formats: https://docs.getdbt.com/reference/artifacts/manifest-json and
// https://docs.getdbt.com/reference/artifacts/catalog-json
export const DBT_MANIFEST_SCHEMAS = Object.freeze({
  'https://schemas.getdbt.com/dbt/manifest/v12.json': 12,
});
export const DBT_CATALOG_SCHEMA = 'https://schemas.getdbt.com/dbt/catalog/v1.json';
export const DBT_PROFILE = 'dbt-manifest-v12/1';
export const DBT_LIMITS = Object.freeze({
  fileBytes: 128 * 1024 * 1024,
  resources: 250_000,
  edges: 4_000_000,
  columns: 5_000,
  lineageNodes: 200,
  lineageEdges: 500,
  checks: 250,
});
// Resource types that can be a review target: they are relations in the warehouse.
const RELATIONS = ['model', 'seed', 'snapshot', 'source'];
const EXPOSURE_TYPES = {
  dashboard: 'dashboard',
  notebook: 'notebook',
  analysis: 'analysis',
  ml: 'model',
  application: 'application',
};
// Sections that hold resources other nodes can depend on. Unknown sections that hold
// unique_id records are indexed too, so a newer v12 writer cannot hide edges from the
// consistency check by adding a section this reader does not know.
const SKIPPED = new Set(['metadata', 'parent_map', 'child_map', 'group_map', 'selectors']);
const NOT_RESOURCES = new Set(['macros', 'docs', 'groups', 'disabled']);

const isRecord = (x) =>
  x !== null &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  [null, Object.prototype].includes(Object.getPrototypeOf(x));
/** Read an own data property only: accessors and inherited keys are never consulted. */
function own(record, key) {
  if (record === null || typeof record !== 'object') return undefined;
  const d = Object.getOwnPropertyDescriptor(record, key);
  return d && Object.hasOwn(d, 'value') ? d.value : undefined;
}
// Display text never decides a review. Long text is shortened and non-text is ignored.
const clip = (value, max) => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut) + '…';
};
const optionalText = (record, key, max, label) => {
  const value = own(record, key);
  if (value === undefined || value === null) return null;
  requireThat(
    typeof value === 'string' && value.length <= max,
    'INVALID_MANIFEST',
    `${label} must be text of at most ${max} characters`,
  );
  return value;
};
const isoTime = (value, label, code = 'INVALID_MANIFEST') => {
  requireThat(
    typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)),
    code,
    `${label} must be an ISO 8601 timestamp`,
  );
  return new Date(Date.parse(value)).toISOString();
};
const ID = /^[a-z][a-z_]*\.[^\s\u0000-\u001f\u007f]{1,1024}$/;
// Messages name a node only when its ID is well formed, and never at full length.
const named = (id) => (typeof id === 'string' && ID.test(id) ? id.slice(0, 200) : 'an invalid ID');
function idList(value, label) {
  if (value === undefined || value === null) return [];
  requireThat(
    Array.isArray(value) && value.length <= DBT_LIMITS.resources,
    'INVALID_MANIFEST',
    `${label} must be a list of unique IDs`,
  );
  for (const id of value)
    requireThat(typeof id === 'string' && ID.test(id), 'INVALID_MANIFEST', `${label} is invalid`);
  return [...new Set(value)].sort();
}
/** An owner is text, or a list of text, as dbt allows for owner.email. */
function ownerText(value) {
  if (typeof value === 'string') return clip(value, 160);
  if (Array.isArray(value) && value.length <= 50)
    return clip(value.filter((x) => typeof x === 'string' && x.trim()).join(', '), 160);
  return null;
}
const ownerOf = (owner) => ownerText(own(owner, 'name')) ?? ownerText(own(owner, 'email'));
function metaOwner(record) {
  for (const meta of [own(own(record, 'config'), 'meta'), own(record, 'meta')]) {
    const owner = ownerText(own(meta, 'owner'));
    if (owner) return owner;
  }
  // Sources also inherit meta from their source block.
  return ownerText(own(own(record, 'source_meta'), 'owner'));
}
function testCheck(record, resourceType) {
  if (resourceType === 'unit_test')
    return {
      type: 'unit',
      column: null,
      attachedTo:
        idList(own(own(record, 'depends_on'), 'nodes'), 'Unit test depends_on')[0] ?? null,
      severity: null,
    };
  const meta = own(record, 'test_metadata');
  const name = clip(own(meta, 'name'), 80),
    namespace = clip(own(meta, 'namespace'), 80);
  const severity = String(own(own(record, 'config'), 'severity') ?? '').toLowerCase();
  const attached = own(record, 'attached_node');
  return {
    type: name ? (namespace ? `${namespace}.${name}` : name) : 'singular',
    column:
      clip(own(record, 'column_name'), 256) ?? clip(own(own(meta, 'kwargs'), 'column_name'), 256),
    attachedTo: typeof attached === 'string' && ID.test(attached) ? attached : null,
    severity: ['error', 'warn'].includes(severity) ? severity : null,
  };
}
function columnsOf(record) {
  const columns = own(record, 'columns');
  if (columns === undefined || columns === null) return [];
  requireThat(isRecord(columns), 'INVALID_MANIFEST', 'Node columns must be a mapping');
  // JSON objects are unordered (RFC 8259), so declared columns are sorted by key.
  const keys = Object.keys(columns).sort();
  requireThat(keys.length <= DBT_LIMITS.columns, 'DATA_LIMIT', 'A node has too many columns');
  return keys.map((key) => {
    const column = own(columns, key);
    requireThat(isRecord(column), 'INVALID_MANIFEST', 'Column entries must be records');
    const name = own(column, 'name') ?? key;
    requireThat(
      typeof name === 'string' && name.length <= 1024,
      'INVALID_MANIFEST',
      'Column names must be text',
    );
    const dataType = own(column, 'data_type');
    return { name, dataType: typeof dataType === 'string' ? dataType : null };
  });
}

/**
 * Validate a parsed manifest.json and index what the review reads. Only manifest schema
 * v12 is accepted. parent_map, child_map and every depends_on list must describe the same
 * graph, and the graph must be acyclic, or the file is refused as inconsistent.
 */
export function parseDbtManifest(raw, { maxResources = DBT_LIMITS.resources } = {}) {
  requireThat(isRecord(raw), 'NOT_A_MANIFEST', 'Expected a dbt manifest.json object');
  const metadata = own(raw, 'metadata');
  requireThat(isRecord(metadata), 'NOT_A_MANIFEST', 'Expected a dbt manifest.json object');
  const schema = own(metadata, 'dbt_schema_version');
  requireThat(
    typeof schema === 'string' && schema.length <= 200,
    'NOT_A_MANIFEST',
    'The file has no dbt_schema_version',
  );
  const version = schema.match(/^https:\/\/schemas\.getdbt\.com\/dbt\/([a-z_-]+)\/v(\d+)\.json$/);
  requireThat(
    version?.[1] === 'manifest',
    'NOT_A_MANIFEST',
    `Expected a dbt manifest.json, found ${version ? `a ${version[1]} artifact` : 'another file'}`,
  );
  requireThat(
    Object.hasOwn(DBT_MANIFEST_SCHEMAS, schema),
    'UNSUPPORTED_MANIFEST_VERSION',
    `dbt manifest schema v${version[2]} is not supported. This release reads v12 (dbt Core 1.8 and later).`,
  );
  const info = {
    schemaVersion: DBT_MANIFEST_SCHEMAS[schema],
    dbtVersion: optionalText(metadata, 'dbt_version', 40, 'dbt_version'),
    generatedAt: isoTime(own(metadata, 'generated_at'), 'Manifest generated_at'),
    projectName: optionalText(metadata, 'project_name', 200, 'project_name'),
    adapterType: optionalText(metadata, 'adapter_type', 80, 'adapter_type'),
  };
  for (const key of ['nodes', 'sources', 'parent_map', 'child_map'])
    requireThat(isRecord(own(raw, key)), 'INVALID_MANIFEST', `The manifest has no ${key} mapping`);
  const groups = new Map();
  const rawGroups = own(raw, 'groups') ?? {};
  requireThat(isRecord(rawGroups), 'INVALID_MANIFEST', 'groups must be a mapping');
  for (const [key, group] of Object.entries(rawGroups)) {
    requireThat(
      isRecord(group) && own(group, 'unique_id') === key && typeof own(group, 'name') === 'string',
      'INVALID_MANIFEST',
      'Group entries must carry their own unique_id and name',
    );
    groups.set(key, {
      name: own(group, 'name'),
      package: own(group, 'package_name'),
      owner: ownerOf(own(group, 'owner')),
    });
  }
  // A group named from another package resolves only when its name is unique. The index
  // keeps the lookup linear: scanning every group for every node is quadratic.
  const byName = new Map();
  for (const g of groups.values()) byName.set(g.name, byName.has(g.name) ? null : g);
  const groupOwner = (record) => {
    const name = own(record, 'group') ?? own(own(record, 'config'), 'group');
    if (typeof name !== 'string') return null;
    const exact = groups.get(`group.${own(record, 'package_name')}.${name}`);
    if (exact) return exact.owner;
    return byName.get(name)?.owner ?? null;
  };
  const resources = new Map();
  for (const [section, value] of Object.entries(raw)) {
    if (SKIPPED.has(section) || NOT_RESOURCES.has(section) || !isRecord(value)) continue;
    for (const [key, record] of Object.entries(value)) {
      requireThat(
        resources.size < maxResources,
        'DATA_LIMIT',
        `The manifest has more than ${maxResources} resources`,
      );
      if (!isRecord(record) || own(record, 'unique_id') === undefined) {
        // Only the known resource sections must hold resources.
        requireThat(
          !['nodes', 'sources', 'exposures', 'unit_tests'].includes(section),
          'INVALID_MANIFEST',
          `${section} entries must be dbt resources`,
        );
        continue;
      }
      const type = own(record, 'resource_type');
      requireThat(
        own(record, 'unique_id') === key &&
          typeof type === 'string' &&
          ID.test(key) &&
          key.startsWith(type + '.') &&
          typeof own(record, 'name') === 'string' &&
          own(record, 'name').length <= 1024,
        'INVALID_MANIFEST',
        'Each resource needs a unique_id that matches its key, a resource_type and a name',
      );
      requireThat(!resources.has(key), 'INVALID_MANIFEST', `Duplicate unique_id ${named(key)}`);
      const materialized = own(own(record, 'config'), 'materialized');
      // An ephemeral model is inlined into its consumers and has no relation to change.
      const relation =
        RELATIONS.includes(type) && materialized !== 'ephemeral'
          ? [
              optionalText(record, 'database', 1024, 'database'),
              optionalText(record, 'schema', 1024, 'schema'),
              optionalText(record, type === 'source' ? 'identifier' : 'alias', 1024, 'alias') ??
                own(record, 'name'),
            ]
              .filter((part) => part !== null && part !== '')
              .join('.')
          : null;
      const exposure = type === 'exposure';
      resources.set(key, {
        id: key,
        type,
        name: own(record, 'name'),
        label: exposure ? clip(own(record, 'label'), 160) : null,
        sourceName: type === 'source' ? clip(own(record, 'source_name'), 160) : null,
        exposureType: exposure ? own(record, 'type') : null,
        relation,
        dependsOn: idList(own(own(record, 'depends_on'), 'nodes'), `${key} depends_on`),
        owner:
          (exposure ? ownerOf(own(record, 'owner')) : null) ??
          metaOwner(record) ??
          groupOwner(record),
        columns: RELATIONS.includes(type) ? columnsOf(record) : [],
        check: type === 'test' || type === 'unit_test' ? testCheck(record, type) : null,
      });
    }
  }
  const parents = new Map(),
    children = new Map();
  let edges = 0;
  for (const [mapName, target] of [
    ['parent_map', parents],
    ['child_map', children],
  ])
    for (const [key, list] of Object.entries(own(raw, mapName))) {
      requireThat(
        resources.has(key),
        'MANIFEST_INCONSISTENT',
        `${mapName} names ${named(key)}, which is not a resource in this manifest`,
      );
      const ids = idList(list, mapName);
      edges += ids.length;
      requireThat(edges <= DBT_LIMITS.edges, 'DATA_LIMIT', 'The manifest has too many edges');
      for (const id of ids)
        requireThat(
          resources.has(id) && id !== key,
          'MANIFEST_INCONSISTENT',
          `${mapName} links ${named(key)} to an unknown node or to itself`,
        );
      target.set(key, ids);
    }
  // parent_map must restate every depends_on list, and child_map must be its inverse.
  for (const [id, resource] of resources) {
    const declared = parents.get(id) ?? [];
    requireThat(
      declared.length === resource.dependsOn.length &&
        declared.every((x, i) => x === resource.dependsOn[i]),
      'MANIFEST_INCONSISTENT',
      `parent_map and depends_on disagree for ${named(id)}`,
    );
  }
  const inverse = new Map();
  for (const [child, list] of parents)
    for (const parent of list) {
      if (!inverse.has(parent)) inverse.set(parent, []);
      inverse.get(parent).push(child);
    }
  for (const id of new Set([...children.keys(), ...inverse.keys()])) {
    const a = children.get(id) ?? [],
      b = (inverse.get(id) ?? []).sort();
    requireThat(
      a.length === b.length && a.every((x, i) => x === b[i]),
      'MANIFEST_INCONSISTENT',
      `child_map is not the inverse of parent_map for ${named(id)}`,
    );
  }
  // dbt refuses cyclic projects, so a cycle here means the file was changed afterwards.
  const pending = new Map([...resources.keys()].map((id) => [id, (parents.get(id) ?? []).length]));
  const ready = [...pending].filter(([, n]) => n === 0).map(([id]) => id);
  let ordered = 0;
  while (ready.length) {
    const id = ready.pop();
    ordered++;
    for (const child of children.get(id) ?? []) {
      pending.set(child, pending.get(child) - 1);
      if (pending.get(child) === 0) ready.push(child);
    }
  }
  requireThat(
    ordered === resources.size,
    'MANIFEST_INCONSISTENT',
    'The manifest dependency graph contains a cycle',
  );
  return Object.freeze({ kind: 'dbt-manifest', info, resources, children, parents });
}

/** Validate catalog.json from dbt docs generate: the observed column names and types. */
export function parseDbtCatalog(raw) {
  requireThat(isRecord(raw), 'NOT_A_CATALOG', 'Expected a dbt catalog.json object');
  const metadata = own(raw, 'metadata');
  const schema = own(metadata, 'dbt_schema_version');
  requireThat(
    typeof schema === 'string' && /^https:\/\/schemas\.getdbt\.com\/dbt\/catalog\//.test(schema),
    'NOT_A_CATALOG',
    'Expected a dbt catalog.json from dbt docs generate',
  );
  requireThat(
    schema === DBT_CATALOG_SCHEMA,
    'UNSUPPORTED_CATALOG_VERSION',
    'This release reads dbt catalog schema v1',
  );
  const tables = new Map();
  for (const section of ['nodes', 'sources']) {
    const value = own(raw, section);
    requireThat(isRecord(value), 'INVALID_CATALOG', `The catalog has no ${section} mapping`);
    for (const [key, table] of Object.entries(value)) {
      requireThat(tables.size < DBT_LIMITS.resources, 'DATA_LIMIT', 'The catalog is too large');
      requireThat(
        isRecord(table) && own(table, 'unique_id') === key && ID.test(key),
        'INVALID_CATALOG',
        'Catalog entries must carry their own unique_id',
      );
      const columns = own(table, 'columns');
      requireThat(isRecord(columns), 'INVALID_CATALOG', 'Catalog columns must be a mapping');
      const keys = Object.keys(columns);
      requireThat(keys.length <= DBT_LIMITS.columns, 'DATA_LIMIT', 'A table has too many columns');
      // dbt keys catalog columns by name. A repeated name would let JSON key order choose
      // which type the review sees, so the file is refused instead.
      const names = new Set();
      const rows = keys.map((name) => {
        const column = own(columns, name);
        requireThat(
          isRecord(column) &&
            typeof own(column, 'name') === 'string' &&
            typeof own(column, 'type') === 'string' &&
            Number.isSafeInteger(own(column, 'index')),
          'INVALID_CATALOG',
          'Catalog columns need a name, type and index',
        );
        requireThat(
          !names.has(own(column, 'name')),
          'INVALID_CATALOG',
          'A catalog table lists the same column name twice',
        );
        names.add(own(column, 'name'));
        return {
          name: own(column, 'name'),
          type: own(column, 'type'),
          index: own(column, 'index'),
        };
      });
      tables.set(
        key,
        rows.sort((a, b) => a.index - b.index || (a.name < b.name ? -1 : 1)),
      );
    }
  }
  return Object.freeze({
    kind: 'dbt-catalog',
    generatedAt: isoTime(own(metadata, 'generated_at'), 'Catalog generated_at', 'INVALID_CATALOG'),
    tables,
  });
}

export const byteSize = (n) =>
  n >= 1048576
    ? `${Math.floor(n / 1048576)} MB`
    : n >= 1024
      ? `${Math.floor(n / 1024)} KB`
      : `${n} bytes`;
/** Decode UTF-8 bytes and parse JSON, with errors that never echo file content. */
export function readDbtJson(
  bytes,
  { label = 'dbt artifact', maxBytes = DBT_LIMITS.fileBytes } = {},
) {
  requireThat(bytes instanceof Uint8Array, 'INVALID_INPUT', `Provide the ${label} bytes`);
  requireThat(
    bytes.byteLength > 0 && bytes.byteLength <= maxBytes,
    'DATA_LIMIT',
    `The ${label} must be nonempty and at most ${byteSize(maxBytes)}`,
  );
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new StudioError('INVALID_JSON', `The ${label} is not valid UTF-8 JSON`);
  }
}

export const dbtDatasetUrn = (relation) =>
  `urn:li:dataset:(urn:li:dataPlatform:dbt,${relation},PROD)`;

/** Models, seeds, snapshots and sources that a request can name, with their dataset URNs. */
export function listDbtTargets(index) {
  return [...index.resources.values()]
    .filter((r) => r.relation !== null)
    .map((r) => ({
      uniqueId: r.id,
      resourceType: r.type,
      relation: r.relation,
      urn: dbtDatasetUrn(r.relation),
    }))
    .sort((a, b) => (a.uniqueId < b.uniqueId ? -1 : 1));
}

function resolveTarget(index, datasetUrn) {
  const match =
    typeof datasetUrn === 'string' &&
    datasetUrn.match(/^urn:li:dataset:\(urn:li:dataPlatform:dbt,([^,()\s]{1,1024}),[A-Z]{1,16}\)$/);
  requireThat(
    match,
    'TARGET_NOT_FOUND',
    'Name the target as urn:li:dataset:(urn:li:dataPlatform:dbt,<database>.<schema>.<relation>,PROD)',
  );
  const wanted = match[1].toUpperCase();
  const found = [...index.resources.values()].filter(
    (r) => r.relation !== null && r.relation.toUpperCase() === wanted,
  );
  requireThat(
    found.length > 0,
    'TARGET_NOT_FOUND',
    'No model, seed, snapshot or source in the manifest has that relation',
  );
  requireThat(found.length === 1, 'TARGET_AMBIGUOUS', 'More than one dbt node has that relation');
  // The relation becomes the table name in the SQL review draft, so it must be simple.
  const parts = found[0].relation.split('.');
  requireThat(
    parts.length <= 4 && parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(part)),
    'UNSUPPORTED_RELATION',
    'The relation must be at most four simple unquoted identifiers',
  );
  return found[0];
}

const nodeType = (r) =>
  RELATIONS.includes(r.type)
    ? 'dataset'
    : r.type === 'exposure'
      ? Object.hasOwn(EXPOSURE_TYPES, r.exposureType)
        ? EXPOSURE_TYPES[r.exposureType]
        : null
      : r.type === 'analysis'
        ? 'analysis'
        : ['metric', 'semantic_model', 'saved_query'].includes(r.type)
          ? 'metric'
          : null;
const displayName = (r) =>
  r.type === 'exposure'
    ? (r.label ?? clip(r.name, 160))
    : r.type === 'source' && r.sourceName
      ? clip(`${r.sourceName}.${r.name}`, 160)
      : clip(r.name, 160);
/** Observed types win over declared ones; columns that do not parse are left out. */
function schemaFields(target, catalog) {
  const observed = catalog?.tables.get(target.id);
  const rows = observed
    ? observed.map((c) => ({ name: c.name, type: c.type }))
    : target.columns.map((c) => ({ name: c.name, type: c.dataType }));
  const fields = [],
    names = new Set();
  let skipped = 0;
  for (const row of rows) {
    try {
      identifier(row.name);
      requireThat(!names.has(row.name), 'INVALID_EVIDENCE');
      fields.push({ name: row.name, type: sqlType(row.type), nullable: true });
      names.add(row.name);
    } catch {
      skipped++;
    }
  }
  return { fields, skipped, source: observed ? 'catalog' : 'manifest', declared: rows.length };
}

/**
 * Build an immutable, hash-bound capture for one target. The returned adapter has the same
 * shape as the DataHub capture: reads never touch the files again.
 */
export async function captureDbtManifest(index, datasetUrn, { catalog = null } = {}) {
  requireThat(index?.kind === 'dbt-manifest', 'INVALID_INPUT', 'Parse the manifest first');
  requireThat(catalog === null || catalog?.kind === 'dbt-catalog', 'INVALID_INPUT');
  const target = resolveTarget(index, datasetUrn);
  // Breadth-first over the verified child_map. Tests are quality checks, not consumers.
  const seen = new Set([target.id]),
    queue = [target.id],
    downstream = [],
    checks = [];
  let unrepresented = 0;
  for (let i = 0; i < queue.length; i++)
    for (const id of index.children.get(queue[i]) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const r = index.resources.get(id);
      if (r.check) {
        if (queue[i] === target.id) checks.push(r);
        continue;
      }
      queue.push(id);
      if (nodeType(r) === null) unrepresented++;
      else downstream.push(r);
    }
  const kept = downstream.slice(0, DBT_LIMITS.lineageNodes);
  const ids = new Map([[target.id, 'target'], ...kept.map((r, i) => [r.id, `node-${i + 1}`])]);
  const nodes = [target, ...kept].map((r) => ({
    id: ids.get(r.id),
    urn: r === target ? datasetUrn : r.id,
    name: displayName(r) ?? r.id.slice(-100),
    type: r === target ? 'dataset' : nodeType(r),
    owner: r.owner,
  }));
  const edges = [];
  for (const r of kept)
    for (const parent of index.parents.get(r.id) ?? [])
      if (ids.has(parent)) edges.push({ from: ids.get(parent), to: ids.get(r.id), level: 'table' });
  const schema = schemaFields(target, catalog);
  const observedAt = index.info.generatedAt;
  const data = {
    resolve: {
      urn: datasetUrn,
      name: target.relation,
      platform: clip(index.info.adapterType, 80) ?? 'dbt',
    },
    schema: { fields: schema.fields },
    // Model-level edges only: a manifest has no column lineage, and it cannot see
    // consumers outside the project, so lineage is never complete.
    lineage: {
      nodes,
      edges: edges.slice(0, DBT_LIMITS.lineageEdges),
      total: downstream.length,
      level: 'table',
      checks: checks.slice(0, DBT_LIMITS.checks).map((r) => ({
        id: r.id,
        name: clip(r.name, 160),
        ...r.check,
      })),
    },
    usage: { weeklyQueries: null, windowDays: 7 },
    ownership: {
      owners: nodes.filter((n) => n.owner).map((n) => ({ urn: n.urn, name: n.owner })),
      unassigned: nodes.filter((n) => !n.owner).map((n) => n.urn),
    },
    paths: { paths: [], level: 'column' },
  };
  const coverage = {
    resolve: 'complete',
    // Nullability is never recorded in dbt artifacts, so every field is assumed
    // nullable and the schema is at best partial.
    schema: schema.fields.length ? 'partial' : 'unknown',
    lineage: 'partial',
    usage: 'unknown',
    ownership: 'complete',
    paths: 'unknown',
  };
  const times = {
    schema: schema.source === 'catalog' ? catalog.generatedAt : observedAt,
  };
  const body = Object.fromEntries(
    Object.keys(data).map((kind) => [
      kind,
      {
        kind,
        target: datasetUrn,
        observedAt: times[kind] ?? observedAt,
        coverage: coverage[kind],
        data: data[kind],
      },
    ]),
  );
  const revision =
    'dbt-manifest:' +
    (await hash({
      profile: DBT_PROFILE,
      manifest: index.info,
      catalog: catalog ? { generatedAt: catalog.generatedAt } : null,
      target: target.id,
      evidence: body,
    }));
  const envelopes = {};
  for (const [kind, e] of Object.entries(body)) {
    envelopes[kind] = snapshot({ ...e, source: { mode: 'dbt-manifest', revision } });
    await validateEvidence(envelopes[kind], kind, { datasetUrn }, revision);
  }
  const notes = [
    'Lineage is model-level, from depends_on, parent_map and child_map. It lists consumers declared in this manifest only.',
    'A dbt manifest has no column-level lineage, so column paths are unknown.',
    schema.source === 'catalog'
      ? 'Column names and types come from catalog.json.'
      : 'Column types come from data_type declarations. Run dbt docs generate and pass catalog.json for observed types.',
    'dbt artifacts do not record nullability, so every column is treated as nullable.',
    'dbt artifacts carry no query history, so usage is unknown.',
  ];
  if (schema.skipped)
    notes.push(`${schema.skipped} column(s) had a name or type outside the supported vocabulary.`);
  if (target.type !== 'source')
    notes.push(
      `dbt builds ${target.relation}, so make the change in the project files. The SQL draft only shows the effect in the warehouse.`,
    );
  if (downstream.length > kept.length)
    notes.push(`Lineage was truncated to the nearest ${kept.length} downstream nodes.`);
  if (edges.length > DBT_LIMITS.lineageEdges)
    notes.push(`Only ${DBT_LIMITS.lineageEdges} of ${edges.length} lineage edges are listed.`);
  if (unrepresented)
    notes.push(`${unrepresented} downstream node(s) of other types are not shown.`);
  if (checks.length > DBT_LIMITS.checks) notes.push(`Only ${DBT_LIMITS.checks} checks are listed.`);
  return {
    mode: 'dbt-manifest',
    revision,
    readOnly: true,
    scenarioId: null,
    capture: snapshot({
      profile: DBT_PROFILE,
      manifest: index.info,
      catalog: catalog ? { generatedAt: catalog.generatedAt } : null,
      target: { uniqueId: target.id, resourceType: target.type, relation: target.relation },
      schemaSource: schema.source,
      notes,
    }),
    async read(kind, request, { signal } = {}) {
      signal?.throwIfAborted();
      requireThat(
        request.datasetUrn === datasetUrn,
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
