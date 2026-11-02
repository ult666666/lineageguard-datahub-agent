import { StudioError, requireThat, snapshot } from './core/contract.js';
import {
  DBT_FIXTURE,
  createDbtScenarioAdapter,
  createFixtureAdapter,
  scenario,
} from './core/fixtures.js';
import { readDbtJson } from './core/dbt-manifest.js';
export async function api(route, body, signal) {
  requireThat(
    typeof route === 'string' &&
      /^\/api\/(?:studio|runs(?:\/[a-f0-9-]{36}(?:\/(?:resume|cancel|acknowledge))?)?)$/.test(
        route,
      ),
    'INVALID_ROUTE',
  );
  const timeout = AbortSignal.timeout(25000),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: combined,
    redirect: 'error',
  });
  const raw = await response.text();
  requireThat(raw.length <= 2_500_000, 'RESPONSE_LIMIT', 'The local response exceeds the limit');
  let value;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new StudioError('INVALID_RESPONSE', 'The local API did not return JSON', { cause });
  }
  if (!response.ok)
    throw new StudioError(
      value?.error?.code || 'HTTP_ERROR',
      typeof value?.error?.message === 'string'
        ? value.error.message
        : `Local request failed (${response.status})`,
    );
  return snapshot(value, { maxBytes: 2_500_000, maxNodes: 120000, maxDepth: 30 });
}
// The bundled dbt files are static, same-origin and read once per page load.
let dbtFiles = null;
async function staticJson(file, label) {
  const response = await fetch(file, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new StudioError('FIXTURE_UNAVAILABLE', 'The bundled dbt manifest could not be loaded');
  return readDbtJson(new Uint8Array(await response.arrayBuffer()), { label, maxBytes: 4_000_000 });
}
/** The read-only adapter for a scenario. dbt evidence never goes through the tool API. */
export async function scenarioAdapter(id, { restored = false, target } = {}) {
  if (scenario(id).evidence !== 'dbt-manifest') return httpFixtureAdapter(id, { restored });
  dbtFiles ??= Promise.all([
    staticJson(DBT_FIXTURE.manifest, 'bundled dbt manifest'),
    staticJson(DBT_FIXTURE.catalog, 'bundled dbt catalog'),
  ]);
  try {
    const [manifest, catalog] = await dbtFiles;
    return await createDbtScenarioAdapter(manifest, catalog, target);
  } catch (error) {
    if (error.code === 'FIXTURE_UNAVAILABLE' || error.name === 'TimeoutError') dbtFiles = null;
    throw error;
  }
}
export function httpFixtureAdapter(id, { restored = false } = {}) {
  const source = createFixtureAdapter(id);
  return {
    ...source,
    async read(kind, request, { signal, attempt = 1 } = {}) {
      const requestId = crypto.randomUUID();
      const body = await api(
        '/api/studio',
        { action: 'read', scenarioId: id, kind, request, requestId, attempt, restored },
        signal,
      );
      requireThat(
        body.requestId === requestId,
        'RESPONSE_ID',
        'Synthetic tool response identity mismatch',
      );
      return body.evidence;
    },
  };
}
