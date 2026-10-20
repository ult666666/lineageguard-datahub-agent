import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runMockMcpSmoke } from '../scripts/mock-mcp-smoke.mjs';
import { DataHubMcpCatalogAdapter } from '../src/catalog-adapter.mjs';

const probes = [
  ['malformed JSON', { method: 'POST', body: 'SYNTHETIC_DIAGNOSTIC_CANARY' }],
  ['missing request body', { method: 'GET' }],
  ['invalid authorization', { method: 'POST', headers: { authorization: 'SYNTHETIC_DIAGNOSTIC_CANARY' }, body: JSON.stringify({ method: 'boundary-probe' }) }],
];

for (const [name, request] of probes) {
  test(`local mock rejects ${name} without disclosing internals`, { concurrency: false, timeout: 10000 }, async t => {
    // Capture the real server created by the smoke flow, then probe its actual HTTP handler.
    // No substitute error handler, external service, real credential, or production endpoint.
    const createServer = http.createServer;
    const getDataset = DataHubMcpCatalogAdapter.prototype.getDataset;
    let server;
    let failureResponse;
    t.mock.method(http, 'createServer', (...args) => {
      server = createServer(...args);
      return server;
    });
    t.mock.method(DataHubMcpCatalogAdapter.prototype, 'getDataset', async function (...args) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`,
        { ...request, signal: AbortSignal.timeout(3000) });
      failureResponse = { status: response.status, text: await response.text() };
      return getDataset.apply(this, args);
    });
    const result = await runMockMcpSmoke();
    assert.equal(result.ok, true, 'normal MCP behavior must still succeed');
    assert.equal(failureResponse.status, 500);
    assert.equal(failureResponse.text, 'Mock MCP request failed');
    assert.doesNotMatch(failureResponse.text, /SYNTHETIC_DIAGNOSTIC_CANARY|\.mjs:\d+|AssertionError|SyntaxError|file:\/\//);
    assert.equal(server.listening, false, 'the smoke server must shut down');
  });
}
