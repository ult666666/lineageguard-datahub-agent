import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { RunStore } from '../../src/studio/store.mjs';
import { RunService } from '../../src/studio/service.mjs';

test(
  'an interrupted child process leaves a recoverable SQLite checkpoint, not a false completed run',
  { timeout: 12000 },
  async (t) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-crash-proof-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = `
 import {RunStore} from './src/studio/store.mjs';
 import {createRun,executeRun} from './public/studio/core/runtime.js';
 import {createFixtureAdapter,scenario} from './public/studio/core/fixtures.js';
 import {makeRecipe} from './public/studio/core/recipe.js';
 const store=new RunStore(process.env.TEST_STORE,{leaseMs:1000});
 const adapter=createFixtureAdapter('rename');const run=await createRun(scenario('rename').request,makeRecipe('standard'),adapter);
 await store.create(run);await store.claim(run.id,'crash-test-child');let revision=0;
 await executeRun(run,{adapter,onCheckpoint:async state=>{
  revision=await store.save(state.id,state,revision,'crash-test-child');
  if(state.steps.resolve.status==='completed'){
   process.send({id:state.id,revision});setInterval(()=>{},1000);await new Promise(()=>{});
  }
 }});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../../', import.meta.url),
      env: { PATH: process.env.PATH, TEST_STORE: dir },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let errors = '';
    child.stderr.on('data', (data) => (errors += data));
    t.after(() => {
      if (child.exitCode === null && !child.killed) child.kill();
    });
    const ready = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('Child exited before checkpoint: ' + errors);
      }),
    ]);
    const id = ready[0].id;
    const stopped = once(child, 'exit');
    child.kill('SIGKILL');
    await stopped;
    const store = new RunStore(dir, { leaseMs: 1000 });
    const before = (await store.read(id)).run;
    assert.equal(before.status, 'running');
    assert.equal(before.result, null);
    assert.equal(before.steps.resolve.status, 'completed');
    await assert.rejects(store.claim(id, 'premature-writer'), /lease|busy/i);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const service = new RunService(store);
    t.after(() => service.close());
    await service.resume(id);
    await service.wait(id);
    const after = (await store.read(id)).run;
    assert.equal(after.status, 'completed');
    assert.equal(after.id, id);
    assert.equal(after.generation, 2);
    assert.equal(after.steps.resolve.reused, true);
    assert.equal(after.callsUsed, 5);
  },
);
