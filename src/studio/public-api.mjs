import {
  STUDIO_VERSION,
  POLICY_VERSION,
  snapshot,
  exact,
  requireThat,
  integer,
  text,
  validateRequest,
  StudioError,
} from '../../public/studio/core/contract.js';
import {
  SCENARIOS,
  scenario,
  createFixtureAdapter,
  FIXTURE_REVISION,
} from '../../public/studio/core/fixtures.js';
import { makeRecipe, compileRecipe } from '../../public/studio/core/recipe.js';
import { evaluateSuite } from '../../public/studio/core/evaluations.js';
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cache-control': 'no-store',
};
export async function dispatchPublic(method, raw) {
  if (method === 'GET')
    return {
      schema: 'lineageguard.studio/2',
      version: STUDIO_VERSION,
      policyVersion: POLICY_VERSION,
      fixtureRevision: FIXTURE_REVISION,
      runtime: 'browser-session',
      modelInference: false,
      catalogWrites: false,
      sqlExecution: false,
      scenarios: SCENARIOS.map((s) => scenario(s.id)),
      recipes: ['standard', 'strict', 'sequential'].map((id) => ({ id, recipe: makeRecipe(id) })),
    };
  requireThat(method === 'POST', 'METHOD_NOT_ALLOWED', 'Use GET or POST');
  const body = snapshot(raw, { maxBytes: 65000, maxNodes: 2500, maxDepth: 16 });
  requireThat(typeof body?.action === 'string', 'INVALID_INPUT', 'An action is required');
  if (body.action === 'read') {
    exact(body, ['action', 'scenarioId', 'kind', 'request', 'requestId', 'attempt', 'restored']);
    text(body.requestId, 80, 'Request identifier');
    integer(body.attempt, 1, 3, 'Attempt');
    requireThat(typeof body.restored === 'boolean', 'INVALID_INPUT');
    scenario(body.scenarioId);
    const request = validateRequest(body.request);
    requireThat(
      ['resolve', 'schema', 'lineage', 'usage', 'ownership', 'paths'].includes(body.kind),
      'CAPABILITY_DENIED',
      'Only registered synthetic read tools are allowed',
    );
    const adapter = createFixtureAdapter(body.scenarioId, { restored: body.restored });
    return {
      requestId: body.requestId,
      evidence: await adapter.read(body.kind, request, { attempt: body.attempt }),
    };
  }
  if (body.action === 'compile') {
    exact(body, ['action', 'recipe']);
    return compileRecipe(body.recipe);
  }
  if (body.action === 'evaluate') {
    exact(body, ['action']);
    return evaluateSuite();
  }
  throw new StudioError('CAPABILITY_DENIED', 'Unsupported public operation');
}
export function parseInput(raw) {
  if (Buffer.isBuffer(raw)) {
    requireThat(raw.byteLength <= 65000, 'DATA_LIMIT');
    return JSON.parse(raw.toString('utf8'));
  }
  if (typeof raw === 'string') {
    requireThat(Buffer.byteLength(raw) <= 65000, 'DATA_LIMIT');
    return JSON.parse(raw);
  }
  return snapshot(raw, { maxBytes: 65000 });
}
export function errorResponse(error) {
  const code = error instanceof StudioError ? error.code : 'INVALID_INPUT';
  const status =
    {
      NOT_FOUND: 404,
      METHOD_NOT_ALLOWED: 405,
      CAPABILITY_DENIED: 403,
      RUN_BUSY: 409,
      RUN_COMPLETE: 409,
      RUN_NOT_ACTIVE: 409,
      REVISION_CONFLICT: 409,
      DATA_LIMIT: 413,
      STORE_LIMIT: 429,
      SERVICE_BUSY: 429,
      TOOL_UNAVAILABLE: 503,
    }[code] || 400;
  return {
    status,
    body: {
      error: {
        code,
        message:
          error instanceof StudioError ? error.message : 'The request could not be validated',
      },
    },
  };
}
