import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunStore } from './store.mjs';
import { RunService } from './service.mjs';
import { dispatchPublic, parseInput, errorResponse, SECURITY_HEADERS } from './public-api.mjs';
import { StudioError, exact, snapshot } from '../../public/studio/core/contract.js';
import { MockCatalogAdapter } from '../catalog-adapter.mjs';
import { runLineageGuard } from '../agent.mjs';
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const EXAMPLE = new URL('../../examples/risky-change.json', import.meta.url);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0,
      done = false;
    const chunks = [];
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeListener('data', data);
      error ? reject(error) : resolve(value);
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > 65000) {
        finish(new StudioError('DATA_LIMIT', 'Request body exceeds 65 KB'));
        req.resume();
      } else chunks.push(chunk);
    };
    const timer = setTimeout(() => {
      finish(new StudioError('BODY_TIMEOUT', 'Request body timed out'));
      req.resume();
    }, 3000);
    req.on('data', data);
    req.once('error', (error) => finish(error));
    req.once('aborted', () => finish(new Error('aborted')));
    req.once('end', () => {
      try {
        finish(null, parseInput(Buffer.concat(chunks)));
      } catch (error) {
        finish(error);
      }
    });
  });
}
export function createStudioServer({ storeDirectory, adapterFactory, previewOnly = false } = {}) {
  const store = new RunStore(storeDirectory || path.resolve('.lineageguard'));
  const service = new RunService(store, { ...(adapterFactory ? { adapterFactory } : {}) });
  const classic = new MockCatalogAdapter();
  const server = http.createServer(async (req, res) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host))
      return json(res, 421, { error: { code: 'HOST_DENIED', message: 'Use the loopback host' } });
    if (req.headers.origin && !allowedHosts.some((host) => req.headers.origin === `http://${host}`))
      return json(res, 403, {
        error: { code: 'ORIGIN_DENIED', message: 'Cross-origin access is not allowed' },
      });
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      if (
        req.method === 'POST' &&
        !String(req.headers['content-type'] || '')
          .toLowerCase()
          .startsWith('application/json')
      )
        return json(res, 415, { error: { code: 'CONTENT_TYPE', message: 'Use application/json' } });
      if (pathname === '/api/studio') {
        const value = await dispatchPublic(
          req.method,
          req.method === 'POST' ? await readBody(req) : undefined,
        );
        if (req.method === 'GET' && !previewOnly) value.runtime = 'durable-local';
        return json(res, 200, value);
      }
      if (previewOnly && pathname.startsWith('/api/runs'))
        return json(res, 404, {
          error: { code: 'NOT_FOUND', message: 'Durable runs belong to the local service' },
        });
      if (pathname === '/api/runs') {
        if (req.method === 'GET') return json(res, 200, { runs: await store.list() });
        if (req.method === 'POST')
          return json(res, 202, { run: await service.start(await readBody(req)) });
        return json(res, 405, {
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST' },
        });
      }
      if (pathname.startsWith('/api/runs/')) {
        const parts = pathname.slice('/api/runs/'.length).split('/');
        if (parts.length === 1 && req.method === 'GET')
          return json(res, 200, await service.read(parts[0]));
        if (parts.length === 2 && req.method === 'POST') {
          const body = snapshot(await readBody(req));
          if (parts[1] === 'cancel') {
            exact(body, []);
            return json(res, 202, await service.cancel(parts[0]));
          }
          if (parts[1] === 'resume')
            return json(res, 202, { run: await service.resume(parts[0], body) });
          if (parts[1] === 'acknowledge') {
            exact(body, ['reviewer', 'note']);
            return json(res, 200, {
              run: await service.acknowledge(parts[0], body.reviewer, body.note),
            });
          }
        }
        return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Run operation not found' } });
      }
      if (req.method === 'GET' && pathname === '/api/health')
        return json(res, 200, {
          ok: true,
          mode: 'mock-datahub-snapshot',
          studioRuntime: 'durable-local',
        });
      if (req.method === 'GET' && pathname === '/api/demo')
        return json(res, 200, JSON.parse(await fs.readFile(EXAMPLE, 'utf8')));
      if (req.method === 'POST' && pathname === '/api/analyze') {
        const body = await readBody(req);
        return json(
          res,
          200,
          await runLineageGuard({
            datasetUrn: body.datasetUrn,
            changeRequest: body.changeRequest,
            catalog: classic,
          }),
        );
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (
          relative.split('/').some((part) => !part || part.startsWith('.') || part.includes('\\'))
        )
          return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
        const target = path.resolve(PUBLIC, relative),
          type = MIME[path.extname(target)];
        if (type && target.startsWith(PUBLIC)) {
          let current = target;
          while (current !== path.resolve(PUBLIC)) {
            try {
              if ((await fs.lstat(current)).isSymbolicLink())
                throw new StudioError('NOT_FOUND', 'Not found');
            } catch (error) {
              if (error instanceof StudioError) throw error;
              break;
            }
            current = path.dirname(current);
          }
          try {
            const stat = await fs.stat(target);
            if (stat.isFile() && stat.size <= 5_000_000) {
              const bytes = await fs.readFile(target);
              res.writeHead(200, { 'content-type': type, ...SECURITY_HEADERS });
              res.end(req.method === 'HEAD' ? undefined : bytes);
              return;
            }
          } catch (error) {
            if (error instanceof StudioError) throw error;
          }
        }
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    } catch (error) {
      const reply = errorResponse(error);
      if (!res.headersSent) json(res, reply.status, reply.body);
      else res.end();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 4000;
  return {
    server,
    service,
    store,
    listen(port = 4183) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    },
    async close() {
      await service.close();
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
  };
}
