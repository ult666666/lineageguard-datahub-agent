import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from '../../src/studio/store.mjs';
import { RunService } from '../../src/studio/service.mjs';
import { createRun, executeRun } from '../../public/studio/core/runtime.js';
import { createFixtureAdapter, scenario } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
const temporary = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-store-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const fresh = async () =>
  createRun(scenario('rename').request, makeRecipe('standard'), createFixtureAdapter('rename'));

test('SQLite checkpoints survive close and reopen with exact run state', async (t) => {
  const dir = temporary(t);
  let store = new RunStore(dir);
  const run = await fresh();
  await store.create(run);
  store.close();
  store = new RunStore(dir);
  t.after(() => store.close());
  const saved = await store.read(run.id);
  assert.deepEqual(saved.run, run);
  assert.equal(saved.revision, 0);
  assert.equal((await store.list()).length, 1);
});
test('run store uses compare-and-swap revisions and excludes concurrent writers', async (t) => {
  const dir = temporary(t),
    store = new RunStore(dir);
  t.after(() => store.close());
  const run = await fresh();
  await store.create(run);
  await store.claim(run.id, 'writer-a');
  await assert.rejects(store.claim(run.id, 'writer-b'), /busy|lease/i);
  assert.equal(await store.save(run.id, run, 0, 'writer-a'), 1);
  await assert.rejects(store.save(run.id, run, 0, 'writer-a'), /revision|conflict/i);
  await store.release(run.id, 'writer-a');
  await store.claim(run.id, 'writer-b');
  await assert.rejects(store.save(run.id, run, 1, 'writer-a'), /lease|conflict/i);
});
test('expired lease takeover rejects writes from the stale owner', async (t) => {
  let now = 100000;
  const store = new RunStore(temporary(t), { now: () => now, leaseMs: 1000 });
  t.after(() => store.close());
  const run = await fresh();
  await store.create(run);
  await store.claim(run.id, 'old');
  now += 1001;
  await store.claim(run.id, 'new');
  await assert.rejects(store.save(run.id, run, 0, 'old'), /lease|conflict/i);
  assert.equal(await store.save(run.id, run, 0, 'new'), 1);
});
test('checkpoint corruption, traversal and linked DB files are refused', async (t) => {
  const dir = temporary(t),
    store = new RunStore(dir);
  const run = await fresh();
  await store.create(run);
  store.db.prepare('UPDATE runs SET payload=? WHERE id=?').run('{}', run.id);
  await assert.rejects(store.read(run.id), /checkpoint|checksum|schema/i);
  await assert.rejects(store.read('../outside'));
  store.close();
  fs.renameSync(path.join(dir, 'runs.sqlite'), path.join(dir, 'original.sqlite'));
  fs.symlinkSync(path.join(dir, 'original.sqlite'), path.join(dir, 'runs.sqlite'));
  assert.throws(() => new RunStore(dir), /link|file/i);
});
test('local service can pause, restart and resume without rereading valid evidence', async (t) => {
  const dir = temporary(t);
  let store = new RunStore(dir);
  let service = new RunService(store);
  const initial = await service.start({ scenarioId: 'rename', pauseBeforePolicy: true });
  await service.wait(initial.id);
  const paused = (await store.read(initial.id)).run;
  assert.equal(paused.status, 'paused');
  const calls = paused.callsUsed;
  await service.close();
  store = new RunStore(dir);
  service = new RunService(store);
  t.after(() => service.close());
  await service.resume(initial.id, { restored: false });
  await service.wait(initial.id);
  const resumed = (await store.read(initial.id)).run;
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.id, initial.id);
  assert.equal(resumed.callsUsed, calls);
  assert.equal(resumed.generation, 2);
});
test('local service cancellation records a terminal state and releases its writer lease', async (t) => {
  const store = new RunStore(temporary(t));
  const service = new RunService(store, {
    adapterFactory: (id) => createFixtureAdapter(id, { delayMs: 75 }),
  });
  t.after(() => service.close());
  const run = await service.start({ scenarioId: 'rename' });
  await service.cancel(run.id);
  await service.wait(run.id);
  const saved = await store.read(run.id);
  assert.equal(saved.run.status, 'cancelled');
  assert.equal(saved.leaseActive, false);
});
