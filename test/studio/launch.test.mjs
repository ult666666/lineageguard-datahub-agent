import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../../src/studio/http.mjs';

const entry = fileURLToPath(new URL('../../scripts/studio-server.mjs', import.meta.url));
function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-launch-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: cwd },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('test-owned CLI exceeded 7s'));
    }, 7000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}
async function app(t, previewOnly = false) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lg-launch-app-')));
  const server = createStudioServer({ storeDirectory: path.join(dir, 'original'), previewOnly });
  await server.listen(0);
  t.after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { ...server, dir, port: server.server.address().port };
}
async function fake(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}
const metadata = {
  schema: 'lineageguard.studio/2',
  version: '2.0.0',
  runtime: 'durable-local',
  modelInference: false,
  catalogWrites: false,
  sqlExecution: false,
};

// Red baseline: the original CLI throws EADDRINUSE and creates an unused database.
test('repeat local launch identifies the running Studio without creating storage or disturbing a paused run', async (t) => {
  const original = await app(t);
  const run = await original.service.start({ scenarioId: 'rename', pauseBeforePolicy: true });
  await original.service.wait(run.id);
  const before = await original.service.read(run.id);
  const cwd = fs.mkdtempSync(path.join(original.dir, 'second-'));
  const result = await cli(['--port=' + original.port], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already running/i);
  assert.doesNotMatch(result.stderr, /EADDRINUSE|node:net|at Server/);
  assert.equal(fs.existsSync(path.join(cwd, '.lineageguard')), false);
  assert.deepEqual(await original.service.read(run.id), before);
  assert.equal((await fetch(`http://127.0.0.1:${original.port}/api/health`)).status, 200);
});

test('read-only status reports the local runtime without opening a database', async (t) => {
  const original = await app(t);
  const cwd = fs.mkdtempSync(path.join(original.dir, 'status-'));
  const result = await cli(['--status', '--json', '--port=' + original.port], cwd);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.state, 'running');
  assert.equal(body.runtime, 'durable-local');
  assert.equal(body.version, '2.0.0');
  assert.equal(body.storeVerified, false);
  assert.equal(body.processStarted, false);
  assert.equal(fs.existsSync(path.join(cwd, '.lineageguard')), false);
});

test('an occupied port never silently substitutes an explicitly requested store', async (t) => {
  const original = await app(t);
  const requested = path.join(original.dir, 'different-store');
  const result = await cli(
    ['--json', '--port=' + original.port, '--store=' + requested],
    original.dir,
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, 'STORE_NOT_VERIFIED');
  assert.equal(fs.existsSync(requested), false);
  assert.equal((await fetch(`http://127.0.0.1:${original.port}/api/health`)).status, 200);
});

test('preview and durable runtime modes cannot be confused on repeat launch', async (t) => {
  const original = await app(t, true);
  const result = await cli(['--json', '--port=' + original.port], original.dir);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, 'RUNTIME_CONFLICT');
  const matched = await cli(['--json', '--preview', '--port=' + original.port], original.dir);
  assert.equal(matched.status, 0, matched.stderr);
  assert.equal(JSON.parse(matched.stdout).runtime, 'browser-session');
});

for (const [label, handler, code] of [
  ['unrelated service', (_req, res) => res.end('not Studio'), 'PORT_OCCUPIED'],
  [
    'redirect',
    (_req, res) => {
      res.writeHead(302, { Location: 'https://example.invalid' });
      res.end();
    },
    'PORT_OCCUPIED',
  ],
  [
    'different version',
    (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...metadata, version: '9.0.0' }));
    },
    'VERSION_CONFLICT',
  ],
  [
    'unsafe capability flags',
    (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...metadata, sqlExecution: true }));
    },
    'PORT_OCCUPIED',
  ],
  [
    'oversized metadata',
    (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...metadata, padding: 'x'.repeat(70000) }));
    },
    'PORT_OCCUPIED',
  ],
  [
    'unfinished body',
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
    },
    'PROBE_TIMEOUT',
  ],
]) {
  test(`launch safely refuses ${label}, does not create a store or expose response text`, async (t) => {
    const cwd = temporary(t);
    const port = await fake(t, handler);
    const result = await cli(['--json', '--port=' + port], cwd);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).code, code);
    assert.equal(fs.existsSync(path.join(cwd, '.lineageguard')), false);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /node:net|at Server|https:\/\/example.invalid/,
    );
  });
}

test('status on a stopped port exits promptly without starting or creating anything', async (t) => {
  const cwd = temporary(t);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const result = await cli(['--status', '--json', '--port=' + port], cwd);
  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.equal(body.code, 'NOT_RUNNING');
  assert.equal(body.processStarted, false);
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('argument failures are concise, validate duplicate values and never create storage', async (t) => {
  const cwd = temporary(t);
  for (const args of [
    ['--port=1e3'],
    ['--port=0'],
    ['--port=65536'],
    ['--port=4183', '--port=4184'],
    ['--store='],
    ['--store=a', '--store=b'],
    ['--status', '--store=x'],
    ['--execute-sql'],
  ]) {
    const result = await cli([...args, '--json'], cwd);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(JSON.parse(result.stdout).code, 'INVALID_ARGUMENT');
    assert.doesNotMatch(result.stderr, /at |node:/);
  }
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('help works without binding a port or opening SQLite', async (t) => {
  const cwd = temporary(t);
  const result = await cli(['--help'], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /studio:status/);
  assert.match(result.stdout, /studio:open/);
  assert.deepEqual(fs.readdirSync(cwd), []);
});

// Boundary helpers are tested without invoking a real desktop browser.
test('Node-version floor and browser opener remain bounded and shell-free', async () => {
  const { supportedNode, openStudio } = await import('../../src/studio/launch.mjs');
  for (const version of ['20.0.0', '22.12.0', '25.0.0', 'not-a-version'])
    assert.equal(supportedNode(version), false);
  for (const version of ['22.13.0', '22.22.0', '23.0.0', '24.18.0'])
    assert.equal(supportedNode(version), true);
  const calls = [];
  const execute = (...args) => {
    calls.push(args.slice(0, 3));
    args[3](null);
  };
  assert.equal(await openStudio(4183, { platform: 'darwin', execute }), true);
  assert.deepEqual(calls[0].slice(0, 2), ['/usr/bin/open', ['http://127.0.0.1:4183']]);
  assert.equal(calls[0][2].timeout, 3000);
  assert.notEqual(calls[0][2].shell, true);
  assert.equal(
    await openStudio(4183, {
      platform: 'linux',
      execute: (...args) => args[3](new Error('not installed')),
    }),
    false,
  );
  assert.equal(
    await openStudio(4183, {
      platform: 'darwin',
      execute: () => {
        throw new Error('opener failed');
      },
    }),
    false,
  );
  await assert.rejects(openStudio('4183; arbitrary-shell'), /port/i);
});

test('a competing bind closes only this attempt and rechecks instead of killing the winner', async () => {
  const { launchStudio, parseLaunchArgs } = await import('../../src/studio/launch.mjs');
  let probes = 0,
    closed = 0;
  const options = parseLaunchArgs(['--port=4183']);
  const value = await launchStudio(options, {
    probe: async () =>
      ++probes === 1
        ? { state: 'stopped', code: 'NOT_RUNNING', url: 'http://127.0.0.1:4183' }
        : {
            state: 'running',
            code: 'READY',
            url: 'http://127.0.0.1:4183',
            version: '2.0.0',
            runtime: 'durable-local',
          },
    createApp: () => ({
      listen: async () => {
        const error = new Error('synthetic race');
        error.code = 'EADDRINUSE';
        throw error;
      },
      close: async () => {
        closed += 1;
      },
    }),
  });
  assert.equal(closed, 1);
  assert.equal(probes, 2);
  assert.equal(value.exitCode, 0);
  assert.equal(value.report.code, 'ALREADY_RUNNING');
  assert.equal(value.report.startupRace, true);
  assert.equal(value.report.processStarted, false);
  assert.equal(value.report.storeVerified, false);
  assert.doesNotMatch(value.report.message, /No new process or database was started/);
});

test(
  'fresh foreground launch stops cleanly and restart preserves its own exact paused checkpoint',
  { timeout: 12000 },
  async (t) => {
    const dir = temporary(t);
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    async function start() {
      const child = spawn(process.execPath, [entry, '--json', '--port=' + port], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '',
        errors = '';
      child.stderr.on('data', (chunk) => (errors += chunk));
      const exited = new Promise((resolve) =>
        child.once('close', (code, signal) => resolve({ code, signal })),
      );
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await exited;
      });
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('child startup timed out: ' + errors)),
          4000,
        );
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('\n')) {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(output.split('\n')[0]));
            } catch (error) {
              reject(error);
            }
          }
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      assert.equal(ready.state, 'started');
      assert.equal(ready.processStarted, true);
      return { child, exited };
    }
    const first = await start();
    const base = `http://127.0.0.1:${port}`;
    const created = await fetch(base + '/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'rename', pauseBeforePolicy: true }),
    });
    assert.equal(created.status, 202);
    const run = (await created.json()).run;
    let before;
    for (let i = 0; i < 100; i++) {
      before = await (await fetch(base + '/api/runs/' + run.id)).json();
      // A paused checkpoint can be observed just before its finally block releases the lease.
      if (before.run.status === 'paused' && before.leaseActive === false) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(before.run.status, 'paused');
    first.child.kill('SIGINT');
    assert.equal((await first.exited).code, 0);
    assert.equal(fs.existsSync(path.join(dir, '.lineageguard/runs.sqlite')), true);
    const second = await start();
    const after = await (await fetch(base + '/api/runs/' + run.id)).json();
    assert.deepEqual(after, before);
    second.child.kill('SIGINT');
    assert.equal((await second.exited).code, 0);
  },
);

test('an inconclusive connection failure is not called an occupied or free port', async () => {
  const { launchStudio, parseLaunchArgs } = await import('../../src/studio/launch.mjs');
  let created = false;
  const result = await launchStudio(parseLaunchArgs(['--port=4183']), {
    probe: async () => ({
      state: 'unavailable',
      code: 'PROBE_FAILED',
      url: 'http://127.0.0.1:4183',
    }),
    createApp: () => {
      created = true;
      throw new Error('must not initialize');
    },
  });
  assert.equal(created, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.code, 'PROBE_FAILED');
  assert.doesNotMatch(result.report.message, /port is occupied|not running/i);
});
