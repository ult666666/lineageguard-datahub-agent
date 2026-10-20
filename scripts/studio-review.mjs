#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DataHubMcpClient } from '../src/datahub-mcp-client.mjs';
import { captureDataHubSnapshot } from '../src/studio/datahub-snapshot.mjs';
import { scenario, createFixtureAdapter } from '../public/studio/core/fixtures.js';
import { makeRecipe } from '../public/studio/core/recipe.js';
import { createRun, executeRun, verifyRun } from '../public/studio/core/runtime.js';
import { validateRequest } from '../public/studio/core/contract.js';

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
try {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) =>
        !['--live-datahub', '--pause'].includes(arg) &&
        !['--scenario=', '--request=', '--output=', '--profile='].some((prefix) =>
          arg.startsWith(prefix),
        ),
    )
  )
    throw new Error('Unsupported option. No execution or catalog-write capability exists.');
  const get = (name) =>
    args.find((arg) => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const output = get('output');
  if (!output)
    throw new Error(
      'Provide --output=./.lineageguard/review.json. Existing output files are never overwritten.',
    );
  const destination = safeFile(output);
  if (fs.existsSync(destination)) throw new Error('Output already exists');
  const live = args.includes('--live-datahub');
  let request, adapter;
  if (live) {
    if (!get('request') || !process.env.DATAHUB_MCP_URL || !process.env.DATAHUB_MCP_TOKEN)
      throw new Error(
        'Live mode requires an explicit request file and locally configured DATAHUB_MCP_URL/TOKEN. No live connection was attempted.',
      );
    const file = safeFile(get('request'));
    const info = fs.statSync(file);
    if (!info.isFile() || info.size > 40000)
      throw new Error('Request file is not a bounded JSON file');
    request = validateRequest(JSON.parse(fs.readFileSync(file, 'utf8')));
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
    if (get('request')) {
      const file = safeFile(get('request'));
      if (fs.statSync(file).size > 40000) throw new Error('Request file exceeds limit');
      request = validateRequest(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    adapter = createFixtureAdapter(id);
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
      privacy: live
        ? 'The export contains your catalog metadata. Keep it private.'
        : 'Synthetic data only.',
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'REVIEW_NOT_COMPLETED',
      message:
        error?.name === 'McpError'
          ? 'The read-only MCP capture failed; no report was produced.'
          : String(error.message).slice(0, 300),
    }),
  );
  process.exitCode = 1;
}
