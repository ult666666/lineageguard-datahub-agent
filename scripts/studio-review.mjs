#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DataHubMcpClient } from '../src/datahub-mcp-client.mjs';
import { captureDataHubSnapshot } from '../src/studio/datahub-snapshot.mjs';
import { dbtFixtureAdapter } from '../src/studio/dbt-fixture.mjs';
import { scenario, createFixtureAdapter } from '../public/studio/core/fixtures.js';
import { makeRecipe } from '../public/studio/core/recipe.js';
import { createRun, executeRun, verifyRun } from '../public/studio/core/runtime.js';
import { validateRequest } from '../public/studio/core/contract.js';
import {
  DBT_LIMITS,
  captureDbtManifest,
  listDbtTargets,
  parseDbtCatalog,
  parseDbtManifest,
  readDbtJson,
} from '../public/studio/core/dbt-manifest.js';
import { readLocalFile } from './lib/review-file.mjs';

function safeFile(name) {
  const file = path.resolve(name);
  let p = file;
  while (true) {
    try {
      if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Linked paths are not accepted');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return file;
}
function readRequest(name) {
  const file = safeFile(name);
  const info = fs.statSync(file);
  if (!info.isFile() || info.size > 40000)
    throw new Error('Request file is not a bounded JSON file');
  return validateRequest(JSON.parse(fs.readFileSync(file, 'utf8')));
}
// dbt artifacts are local, regular, unlinked files read once into memory.
function readDbt(name, label) {
  const bytes = readLocalFile(name, { maxBytes: DBT_LIMITS.fileBytes, label, limit: '128 MB' });
  return readDbtJson(bytes, { label });
}
/** What a reviewer needs from a dbt capture: consumers, owners, checks and evidence gaps. */
function dbtSummary(adapter, run) {
  const lineage = run.result?.evidence.lineage?.data;
  return {
    target: adapter.capture.target,
    manifest: adapter.capture.manifest,
    catalog: adapter.capture.catalog,
    downstream: (lineage?.nodes || [])
      .filter((n) => n.id !== 'target')
      .map(({ name, type, owner }) => ({ name, type, owner })),
    checks: (lineage?.checks || []).map(({ name, type, column }) => ({ name, type, column })),
    reasons: run.result?.policy.reasons.map((r) => r.code) || [],
    gaps: run.result?.policy.gaps.map((g) => `${g.kind}:${g.code}`) || [],
    notes: adapter.capture.notes,
  };
}
try {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) =>
        !['--live-datahub', '--pause', '--list-dbt-targets'].includes(arg) &&
        ![
          '--scenario=',
          '--request=',
          '--output=',
          '--profile=',
          '--dbt-manifest=',
          '--dbt-catalog=',
        ].some((prefix) => arg.startsWith(prefix)),
    )
  )
    throw new Error('Unsupported option. No execution or catalog-write capability exists.');
  const get = (name) =>
    args.find((arg) => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const live = args.includes('--live-datahub'),
    dbt = get('dbt-manifest');
  if (get('dbt-catalog') && !dbt) throw new Error('--dbt-catalog needs --dbt-manifest');
  if (dbt && (live || get('scenario')))
    throw new Error('Choose one evidence source: --dbt-manifest, --live-datahub or --scenario.');
  if (args.includes('--list-dbt-targets')) {
    if (!dbt) throw new Error('--list-dbt-targets needs --dbt-manifest');
    for (const target of listDbtTargets(parseDbtManifest(readDbt(dbt, 'dbt manifest'))))
      console.log(JSON.stringify(target));
    process.exit(0);
  }
  const output = get('output');
  if (!output)
    throw new Error(
      'Provide --output=./.lineageguard/review.json. Existing output files are never overwritten.',
    );
  const destination = safeFile(output);
  if (fs.existsSync(destination)) throw new Error('Output already exists');
  let request, adapter;
  if (dbt) {
    if (!get('request'))
      throw new Error('A dbt review needs --request=<file> naming the target and the change.');
    request = readRequest(get('request'));
    const index = parseDbtManifest(readDbt(dbt, 'dbt manifest'));
    const catalog = get('dbt-catalog')
      ? parseDbtCatalog(readDbt(get('dbt-catalog'), 'dbt catalog'))
      : null;
    adapter = await captureDbtManifest(index, request.datasetUrn, { catalog });
  } else if (live) {
    if (!get('request') || !process.env.DATAHUB_MCP_URL || !process.env.DATAHUB_MCP_TOKEN)
      throw new Error(
        'Live mode requires an explicit request file and locally configured DATAHUB_MCP_URL/TOKEN. No live connection was attempted.',
      );
    request = readRequest(get('request'));
    adapter = await captureDataHubSnapshot(
      new DataHubMcpClient({
        url: process.env.DATAHUB_MCP_URL,
        token: process.env.DATAHUB_MCP_TOKEN,
      }),
      request.datasetUrn,
    );
  } else {
    const id = get('scenario') || 'rename';
    request = scenario(id).request;
    if (get('request')) request = readRequest(get('request'));
    adapter =
      scenario(id).evidence === 'dbt-manifest'
        ? await dbtFixtureAdapter(request.datasetUrn)
        : createFixtureAdapter(id);
  }
  const run = await executeRun(
    await createRun(request, makeRecipe(get('profile') || 'standard'), adapter),
    { adapter, pauseBeforePolicy: args.includes('--pause') },
  );
  await verifyRun(run);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  safeFile(destination);
  fs.writeFileSync(destination, JSON.stringify(run, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({
      id: run.id,
      status: run.status,
      decision: run.result?.policy.decision || null,
      source: run.sourceMode,
      binding: run.binding,
      executionAuthorized: false,
      ...(adapter.mode === 'dbt-manifest' ? { dbt: dbtSummary(adapter, run) } : {}),
      privacy: live
        ? 'The export contains your catalog metadata. Keep it private.'
        : dbt
          ? 'The export contains metadata from your dbt project. Keep it private if the project is.'
          : 'Synthetic data only.',
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'REVIEW_NOT_COMPLETED',
      ...(typeof error?.code === 'string' && /^[A-Z_]{2,45}$/.test(error.code)
        ? { code: error.code }
        : {}),
      message:
        error?.name === 'McpError'
          ? 'The read-only MCP capture failed; no report was produced.'
          : String(error.message).slice(0, 300),
    }),
  );
  process.exitCode = 1;
}
