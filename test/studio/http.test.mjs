import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStudioServer } from '../../src/studio/http.mjs';
import { dispatchPublic } from '../../src/studio/public-api.mjs';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';

async function setup(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-http-')));
  const app = createStudioServer({ storeDirectory: dir });
  await app.listen(0);
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}
test('local HTTP creates an actual durable run and exposes its terminal checkpoint', async (t) => {
  const app = await setup(t);
  const post = await fetch(app.base + '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: 'rename', pauseBeforePolicy: true }),
  });
  assert.equal(post.status, 202);
  const initial = (await post.json()).run;
  await app.service.wait(initial.id);
  let saved = await (await fetch(app.base + '/api/runs/' + initial.id)).json();
  assert.equal(saved.run.status, 'paused');
  const resume = await fetch(app.base + '/api/runs/' + initial.id + '/resume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(resume.status, 202);
  await app.service.wait(initial.id);
  saved = await (await fetch(app.base + '/api/runs/' + initial.id)).json();
  assert.equal(saved.run.status, 'completed');
  assert.equal(saved.run.result.policy.executionAuthorized, false);
  assert.equal(saved.run.generation, 2);
});
test('local HTTP blocks cross-origin writes, unsupported bodies, paths and methods', async (t) => {
  const app = await setup(t);
  const cross = await fetch(app.base + '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' },
    body: '{}',
  });
  assert.equal(cross.status, 403);
  const plain = await fetch(app.base + '/api/runs', { method: 'POST', body: '{}' });
  assert.equal(plain.status, 415);
  const bad = await fetch(app.base + '/api/runs/not-a-run');
  assert.equal(bad.status, 400);
  const secret = await fetch(app.base + '/.lineageguard/runs.sqlite');
  assert.equal(secret.status, 404);
  const metadata = await fetch(app.base + '/api/studio');
  assert.equal(metadata.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await metadata.json()).runtime, 'durable-local');
});
test('public fixture API cannot choose network destinations or mutation tools', async () => {
  const meta = await dispatchPublic('GET');
  assert.equal(meta.runtime, 'browser-session');
  await assert.rejects(
    dispatchPublic('POST', {
      action: 'read',
      scenarioId: 'rename',
      kind: 'execute_sql',
      request: scenario('rename').request,
      requestId: 'request-1',
      attempt: 1,
      restored: false,
    }),
  );
  await assert.rejects(
    dispatchPublic('POST', {
      action: 'read',
      scenarioId: 'rename',
      kind: 'schema',
      url: 'https://elsewhere.example',
      request: scenario('rename').request,
      requestId: 'request-1',
      attempt: 1,
      restored: false,
    }),
  );
  const result = await dispatchPublic('POST', {
    action: 'read',
    scenarioId: 'rename',
    kind: 'schema',
    request: scenario('rename').request,
    requestId: 'request-1',
    attempt: 1,
    restored: false,
  });
  assert.equal(result.requestId, 'request-1');
  assert.equal(result.evidence.kind, 'schema');
  assert.equal(result.evidence.source.mode, 'synthetic-fixture');
});
