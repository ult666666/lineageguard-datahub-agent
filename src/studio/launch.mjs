import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { STUDIO_VERSION } from '../../public/studio/core/contract.js';

export class LaunchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LaunchError';
    this.code = code;
  }
}
const fail = (message) => {
  throw new LaunchError('INVALID_ARGUMENT', message);
};
export function parseLaunchArgs(args, cwd = process.cwd()) {
  const options = {
    port: 4183,
    storeDirectory: path.resolve(cwd, '.lineageguard'),
    explicitStore: false,
    preview: false,
    status: false,
    open: false,
    json: false,
    help: false,
  };
  const seen = new Set();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) fail('Each option may appear only once. Use --help for supported options.');
    seen.add(key);
    if (['--preview', '--status', '--open', '--json', '--help'].includes(arg))
      options[arg.slice(2)] = true;
    else if (key === '--port' && /^--port=[0-9]{1,5}$/.test(arg)) {
      options.port = Number(arg.slice(7));
      if (options.port < 1 || options.port > 65535) fail('Use a port from 1 through 65535.');
    } else if (
      key === '--store' &&
      arg.startsWith('--store=') &&
      arg.slice(8).length > 0 &&
      arg.length < 4105 &&
      !/[\x00-\x1f\x7f]/.test(arg)
    ) {
      options.storeDirectory = path.resolve(cwd, arg.slice(8));
      options.explicitStore = true;
    } else
      fail('Unsupported or invalid option. Use --help; no execution or remote-host option exists.');
  }
  if (options.status && options.explicitStore) fail('Status is read-only; do not supply --store.');
  return options;
}
export function supportedNode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return (
    !!match &&
    Number(match[1]) >= 22 &&
    Number(match[1]) < 25 &&
    (Number(match[1]) !== 22 || Number(match[2]) >= 13)
  );
}
export function localUrl(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid loopback port.');
  return `http://127.0.0.1:${port}`;
}

// One bounded unauthenticated GET. No redirects, proxy destinations, cookies,
// environment credentials, caller-supplied URL, body logging or SQLite imports.
export function inspectStudio(port) {
  const url = localUrl(port);
  return new Promise((resolve) => {
    let finished = false,
      request,
      response,
      connected = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      response?.destroy();
      request?.destroy();
      resolve({ url, ...value });
    };
    const occupied = () => finish({ state: 'occupied', code: 'PORT_OCCUPIED' });
    const timer = setTimeout(() => finish({ state: 'unresponsive', code: 'PROBE_TIMEOUT' }), 1500);
    request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/studio',
        method: 'GET',
        agent: false,
        maxHeaderSize: 8192,
        headers: { Accept: 'application/json', Connection: 'close' },
      },
      (res) => {
        response = res;
        if (
          res.statusCode !== 200 ||
          !/^application\/json(?:;|$)/i.test(res.headers['content-type'] || '')
        )
          return occupied();
        const announced = res.headers['content-length'];
        if (announced !== undefined && (!/^[0-9]+$/.test(announced) || Number(announced) > 65000))
          return occupied();
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 65000) occupied();
          else chunks.push(chunk);
        });
        res.once('error', occupied);
        res.once('aborted', occupied);
        res.once('end', () => {
          if (finished) return;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              !body ||
              body.schema !== 'lineageguard.studio/2' ||
              !['durable-local', 'browser-session'].includes(body.runtime) ||
              typeof body.version !== 'string' ||
              !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.version) ||
              !['sqlExecution', 'catalogWrites', 'modelInference'].every(
                (key) => body[key] === false,
              )
            )
              return occupied();
            finish({
              state: 'running',
              code: 'READY',
              version: body.version,
              runtime: body.runtime,
            });
          } catch {
            occupied();
          }
        });
      },
    );
    request.once('socket', (socket) =>
      socket.once('connect', () => {
        connected = true;
      }),
    );
    request.once('error', (error) => {
      if (error.code === 'ECONNREFUSED' && !connected)
        finish({ state: 'stopped', code: 'NOT_RUNNING' });
      else if (connected) occupied();
      else finish({ state: 'unavailable', code: 'PROBE_FAILED' });
    });
  });
}

function report(probe, code, message, state = probe.state) {
  return {
    app: 'LineageGuard Studio',
    state,
    code,
    message,
    url: probe.url,
    ...(probe.version ? { version: probe.version, runtime: probe.runtime } : {}),
    processStarted: false,
    storeVerified: false,
    executionAuthorized: false,
  };
}
function occupiedResult(probe, options) {
  if (probe.state === 'running') {
    if (probe.version !== STUDIO_VERSION)
      return {
        exitCode: 1,
        report: report(
          probe,
          'VERSION_CONFLICT',
          'Another Studio version is already running. It was left untouched; use its original terminal to manage it.',
        ),
      };
    if (options.status)
      return {
        exitCode: 0,
        report: report(
          probe,
          'READY',
          'Studio is running. This read-only check does not verify its storage path or process ownership.',
        ),
      };
    if (probe.runtime !== (options.preview ? 'browser-session' : 'durable-local'))
      return {
        exitCode: 1,
        report: report(
          probe,
          'RUNTIME_CONFLICT',
          'A different Studio runtime mode is already running. No new process was started.',
        ),
      };
    if (options.explicitStore)
      return {
        exitCode: 1,
        report: report(
          probe,
          'STORE_NOT_VERIFIED',
          'Studio is already running, but its storage path is not exposed. The requested --store was not opened or substituted. Use studio:status to inspect the existing service.',
        ),
      };
    return {
      exitCode: 0,
      report: report(
        probe,
        'ALREADY_RUNNING',
        'Studio is already running. Open the URL below; keep its original terminal open. No new process or database was started. Its storage path has not been verified.',
        'already-running',
      ),
    };
  }
  return {
    exitCode: 1,
    report: report(
      probe,
      probe.code,
      probe.code === 'NOT_RUNNING'
        ? 'Studio is not running at this port. Start it with npm run studio:local, keeping that terminal open.'
        : probe.code === 'PROBE_FAILED'
          ? 'The local connection could not be checked. No service or database was started, and no existing process was stopped.'
          : probe.code === 'PROBE_TIMEOUT'
            ? 'This address did not return a complete Studio response within 1.5 seconds. No process was stopped or replaced.'
            : 'This port is occupied, but a compatible read-only Studio could not be verified. No process was stopped or replaced.',
    ),
  };
}

export async function launchStudio(options, { probe = inspectStudio, createApp } = {}) {
  const initial = await probe(options.port);
  if (initial.state !== 'stopped' || options.status) return occupiedResult(initial, options);
  let app;
  try {
    const factory = createApp || (await import('./http.mjs')).createStudioServer;
    app = factory({ storeDirectory: options.storeDirectory, previewOnly: options.preview });
    await app.listen(options.port);
  } catch (error) {
    if (app) {
      try {
        await app.close();
      } catch {
        throw new LaunchError(
          'CLEANUP_FAILED',
          'The failed startup could not finish closing its own resources. Existing services were not stopped.',
        );
      }
    }
    if (error.code === 'EADDRINUSE') {
      const checked = await probe(options.port);
      if (checked.state === 'stopped')
        return {
          exitCode: 1,
          report: report(
            checked,
            'PORT_RACE',
            'The port changed while starting. No server is running from this attempt; retry the status check.',
          ),
        };
      const result = occupiedResult(checked, options);
      result.report.message = result.report.message.replace(
        'No new process or database was started.',
        'No replacement server was started.',
      );
      result.report.message +=
        ' A bind race was detected; only this attempt’s resources were closed. Its requested store may have been initialized before that race.';
      result.report.startupRace = true;
      return result;
    }
    throw new LaunchError(
      'START_FAILED',
      'Studio could not open its local store or listener. Check the requested directory and permissions. Existing processes were not stopped.',
    );
  }
  return {
    exitCode: 0,
    app,
    report: {
      app: 'LineageGuard Studio',
      state: 'started',
      code: 'STARTED',
      version: STUDIO_VERSION,
      url: localUrl(options.port),
      runtime: options.preview ? 'browser-session' : 'durable-local',
      message:
        'Studio is ready. Open the URL below. Keep this terminal open; Ctrl+C stops this foreground server.',
      processStarted: true,
      storeVerified: true,
      catalog: 'synthetic-fixture',
      sqlExecution: false,
      modelInference: false,
      catalogWrites: false,
      executionAuthorized: false,
    },
  };
}

// The URL is generated from a validated numeric loopback port; never use shell interpolation.
export async function openStudio(port, { platform = process.platform, execute = execFile } = {}) {
  const url = localUrl(port);
  const command =
    platform === 'darwin'
      ? '/usr/bin/open'
      : platform === 'linux'
        ? 'xdg-open'
        : platform === 'win32'
          ? 'rundll32.exe'
          : null;
  if (!command) return false;
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve) => {
    try {
      execute(
        command,
        args,
        { timeout: 3000, windowsHide: true, maxBuffer: 4096, shell: false },
        (error) => resolve(!error),
      );
    } catch {
      resolve(false);
    }
  });
}
