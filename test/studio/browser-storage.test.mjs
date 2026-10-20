import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCheckpoints } from '../../public/studio/storage.js';
import { createRun } from '../../public/studio/core/runtime.js';
import { scenario, createFixtureAdapter } from '../../public/studio/core/fixtures.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
const fresh = () =>
  createRun(scenario('rename').request, makeRecipe('standard'), createFixtureAdapter('rename'));
function memory() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}
test('browser checkpoints preserve the last verified state on quota failure', async () => {
  const storage = memory(),
    checkpoints = new BrowserCheckpoints(storage);
  await checkpoints.load();
  const run = await fresh();
  await checkpoints.save(run);
  storage.setItem = () => {
    throw new Error('quota');
  };
  await assert.rejects(checkpoints.save(await fresh()), /checkpoint|storage/i);
  assert.deepEqual((await new BrowserCheckpoints(storage).load()).current, run);
});
test('browser rejects corrupt state without silently erasing it', async () => {
  const storage = memory();
  storage.setItem('lineageguard.studio.v2', '{broken');
  await assert.rejects(new BrowserCheckpoints(storage).load(), /checkpoint|storage/i);
  assert.equal(storage.getItem('lineageguard.studio.v2'), '{broken');
});
test('another tab changing the checkpoint causes conflict instead of lost updates', async () => {
  const storage = memory(),
    first = new BrowserCheckpoints(storage),
    second = new BrowserCheckpoints(storage);
  await first.load();
  await second.load();
  await first.save(await fresh());
  await assert.rejects(second.save(await fresh()), /conflict|another/i);
});
test('history is bounded and a repeated run updates rather than duplicates it', async () => {
  const storage = memory(),
    checkpoints = new BrowserCheckpoints(storage);
  await checkpoints.load();
  const r = await fresh();
  await checkpoints.save(r);
  await checkpoints.save(r);
  assert.equal(checkpoints.history.length, 1);
  for (let i = 0; i < 8; i++) await checkpoints.save(await fresh());
  assert.equal(checkpoints.history.length, 6);
});
