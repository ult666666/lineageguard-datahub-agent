import { StudioError, requireThat, snapshot } from './core/contract.js';
import { createFixtureAdapter } from './core/fixtures.js';
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
