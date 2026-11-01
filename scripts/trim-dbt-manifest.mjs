#!/usr/bin/env node
// Trim a dbt manifest.json and catalog.json to the fields LineageGuard reads, so a real
// project's artifacts can be committed as a small fixture. dbt itself cannot load the
// result. --compare proves the trim is lossless for LineageGuard: every target must give
// the same evidence revision from the full and the trimmed files.
//
//   node scripts/trim-dbt-manifest.mjs --manifest=<full> --catalog=<full> --out=<dir>
//   node scripts/trim-dbt-manifest.mjs --compare --manifest=<full> --catalog=<full> --trimmed=<dir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureDbtManifest,
  listDbtTargets,
  parseDbtCatalog,
  parseDbtManifest,
  readDbtJson,
} from '../public/studio/core/dbt-manifest.js';

const pick = (record, keys) =>
  Object.fromEntries(keys.filter((k) => Object.hasOwn(record, k)).map((k) => [k, record[k]]));
const ownerOnly = (meta) =>
  meta && typeof meta === 'object' && Object.hasOwn(meta, 'owner') ? { owner: meta.owner } : {};
const RELATIONS = ['model', 'seed', 'snapshot', 'source'];

function trimResource(r) {
  const out = pick(r, ['unique_id', 'resource_type', 'name', 'package_name']);
  if (RELATIONS.includes(r.resource_type)) {
    Object.assign(
      out,
      pick(r, ['database', 'schema', r.resource_type === 'source' ? 'identifier' : 'alias']),
    );
    if (r.resource_type === 'source') Object.assign(out, pick(r, ['source_name']));
    out.columns = Object.fromEntries(
      Object.entries(r.columns || {}).map(([key, c]) => [
        key,
        { name: c.name, data_type: c.data_type ?? null },
      ]),
    );
  }
  if (r.resource_type === 'exposure') {
    Object.assign(out, pick(r, ['type', 'label']));
    out.owner = pick(r.owner || {}, ['name', 'email']);
  }
  if (r.resource_type === 'test') {
    Object.assign(out, pick(r, ['column_name', 'attached_node']));
    if (r.test_metadata)
      out.test_metadata = {
        ...pick(r.test_metadata, ['name', 'namespace']),
        kwargs: pick(r.test_metadata.kwargs || {}, ['column_name']),
      };
  }
  if (r.depends_on) out.depends_on = { nodes: r.depends_on.nodes || [] };
  if (Object.hasOwn(r, 'group')) out.group = r.group;
  if (r.meta) out.meta = ownerOnly(r.meta);
  if (r.source_meta) out.source_meta = ownerOnly(r.source_meta);
  if (r.config) {
    out.config = pick(r.config, ['materialized', 'group', 'severity']);
    if (r.config.meta) out.config.meta = ownerOnly(r.config.meta);
  }
  return out;
}

export function trimManifest(raw) {
  const sections = {};
  for (const [section, value] of Object.entries(raw)) {
    if (['metadata', 'parent_map', 'child_map', 'macros', 'docs', 'groups'].includes(section))
      continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entries = Object.entries(value).filter(
      ([, r]) => r && typeof r === 'object' && typeof r.unique_id === 'string',
    );
    if (entries.length || ['nodes', 'sources', 'exposures', 'unit_tests'].includes(section))
      sections[section] = Object.fromEntries(entries.map(([k, r]) => [k, trimResource(r)]));
  }
  return {
    metadata: pick(raw.metadata, [
      'dbt_schema_version',
      'dbt_version',
      'generated_at',
      'project_name',
      'adapter_type',
    ]),
    ...sections,
    groups: Object.fromEntries(
      Object.entries(raw.groups || {}).map(([k, g]) => [
        k,
        {
          ...pick(g, ['unique_id', 'name', 'package_name']),
          owner: pick(g.owner || {}, ['name', 'email']),
        },
      ]),
    ),
    parent_map: raw.parent_map,
    child_map: raw.child_map,
  };
}

export function trimCatalog(raw) {
  const tables = (section) =>
    Object.fromEntries(
      Object.entries(raw[section] || {}).map(([k, t]) => [
        k,
        {
          unique_id: t.unique_id,
          columns: Object.fromEntries(
            Object.entries(t.columns || {}).map(([name, c]) => [
              name,
              pick(c, ['name', 'type', 'index']),
            ]),
          ),
        },
      ]),
    );
  return {
    metadata: pick(raw.metadata, ['dbt_schema_version', 'dbt_version', 'generated_at']),
    nodes: tables('nodes'),
    sources: tables('sources'),
  };
}

/** One resource or map entry per line, so a regenerated fixture diffs one line per change. */
export function formatCompact(value) {
  const keys = Object.keys(value);
  const lines = ['{'];
  keys.forEach((key, i) => {
    const v = value[key],
      comma = i < keys.length - 1 ? ',' : '';
    const entries = v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : [];
    if (key === 'metadata' || entries.length === 0)
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(v)}${comma}`);
    else {
      lines.push(`  ${JSON.stringify(key)}: {`);
      entries.forEach(([k, x], j) =>
        lines.push(
          `    ${JSON.stringify(k)}: ${JSON.stringify(x)}${j < entries.length - 1 ? ',' : ''}`,
        ),
      );
      lines.push(`  }${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

const read = (file, label) => readDbtJson(new Uint8Array(fs.readFileSync(file)), { label });

export async function compareTrim(manifestFile, catalogFile, trimmedDir) {
  const full = parseDbtManifest(read(manifestFile, 'manifest'));
  const fullCatalog = parseDbtCatalog(read(catalogFile, 'catalog'));
  const small = parseDbtManifest(read(path.join(trimmedDir, 'manifest.json'), 'manifest'));
  const smallCatalog = parseDbtCatalog(read(path.join(trimmedDir, 'catalog.json'), 'catalog'));
  const targets = listDbtTargets(full);
  let identical = 0;
  for (const t of targets) {
    for (const withCatalog of [true, false]) {
      const a = await captureDbtManifest(full, t.urn, {
        catalog: withCatalog ? fullCatalog : null,
      });
      const b = await captureDbtManifest(small, t.urn, {
        catalog: withCatalog ? smallCatalog : null,
      });
      if (a.revision !== b.revision)
        throw new Error(`Trimmed evidence differs for ${t.uniqueId} (catalog: ${withCatalog})`);
    }
    identical++;
  }
  return { targets: targets.length, identical };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  try {
    if (!get('manifest') || !get('catalog')) throw new Error('Pass --manifest= and --catalog=');
    if (args.includes('--compare')) {
      if (!get('trimmed')) throw new Error('Pass --trimmed=<dir>');
      console.log(
        JSON.stringify(await compareTrim(get('manifest'), get('catalog'), get('trimmed'))),
      );
    } else {
      const out = get('out');
      if (!out) throw new Error('Pass --out=<dir>');
      fs.mkdirSync(out, { recursive: true });
      const write = (name, value) =>
        fs.writeFileSync(path.join(out, name), formatCompact(value), { flag: 'wx' });
      write('manifest.json', trimManifest(JSON.parse(fs.readFileSync(get('manifest'), 'utf8'))));
      write('catalog.json', trimCatalog(JSON.parse(fs.readFileSync(get('catalog'), 'utf8'))));
      console.log(JSON.stringify({ written: ['manifest.json', 'catalog.json'], out }));
    }
  } catch (error) {
    console.error(String(error.message).slice(0, 300));
    process.exitCode = 1;
  }
}
