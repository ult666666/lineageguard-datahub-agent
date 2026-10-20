import {
  STUDIO_VERSION,
  POLICY_VERSION,
  StudioError,
  snapshot,
  exact,
  canonical,
  hash,
  requireThat,
} from './contract.js';
import { compileRecipe, REGISTRY } from './recipe.js';
import { verifyRun } from './runtime.js';
import { validateEvidence, evidenceFreshness } from './evidence.js';
import { assessCompatibility, evaluatePolicy } from './policy.js';
import { buildArtifacts } from './artifacts.js';

export const INSPECTOR_VERSION = '1.0.0';
export const MAX_REVIEW_BYTES = 4_000_000;
const equal = (a, b) => canonical(a) === canonical(b);
const date = (value) => {
  requireThat(
    typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)),
    'INVALID_REVIEW_TIME',
    'A recorded timestamp is invalid',
  );
  return Date.parse(value);
};

// JSON.parse validates syntax. This second bounded lexical pass rejects repeated
// member names, including differently escaped spellings, before trust decisions.
function rejectDuplicateKeys(text) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[') {
      stack.push(c === '{' ? new Set() : null);
      requireThat(stack.length <= 30, 'DATA_LIMIT', 'JSON nesting exceeds the inspection limit');
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === '"') {
      const start = i++;
      for (; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(text[next] || '') && next < text.length) next++;
      if (text[next] === ':') {
        const key = JSON.parse(text.slice(start, i + 1)),
          keys = stack.at(-1);
        requireThat(
          keys instanceof Set && !keys.has(key),
          'DUPLICATE_JSON_KEY',
          'Duplicate object members are ambiguous and are not accepted',
        );
        keys.add(key);
      }
    }
  }
}

/** Local data only: no fetch, adapter, execution, database, storage or mutation. */
export async function inspectReviewBytes(input, options = {}) {
  requireThat(input instanceof Uint8Array, 'INVALID_INPUT', 'Provide UTF-8 file bytes');
  requireThat(
    input.byteLength > 0 && input.byteLength <= MAX_REVIEW_BYTES,
    'DATA_LIMIT',
    'Review files must be nonempty and at most 4 MB',
  );
  const bytes = input.slice();
  let raw, text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    raw = JSON.parse(text);
  } catch {
    throw new StudioError('INVALID_JSON', 'The file is not valid UTF-8 JSON');
  }
  rejectDuplicateKeys(text);
  const report = await inspectReview(raw, options);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    ...report,
    fileBytes: bytes.byteLength,
    fileSha256: [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''),
  };
}

// Policy is time-dependent. Replay the finite freshness transition points in its
// recorded execution window instead of guessing a single policy evaluation time.
function policyAtRecordedWindow(run, outputs) {
  const step = run.steps.policy;
  const start = date(step.startedAt),
    end = date(step.endedAt);
  requireThat(end >= start, 'INVALID_REVIEW_TIME', 'Policy time window is reversed');
  const times = new Set([start, end]);
  const age = run.recipe.policy === 'strict' ? 3600000 : 86400000;
  for (const [id, value] of Object.entries(outputs)) {
    if (REGISTRY[id].kind !== 'tool') continue;
    const observed = date(value.observedAt);
    for (const boundary of [observed - 300000, observed + age + 1]) {
      if (boundary >= start && boundary <= end) times.add(boundary);
    }
  }
  return [...times].some((now) =>
    equal(evaluatePolicy(run.request, run.recipe, outputs, now), step.output),
  );
}

export async function inspectReview(raw, { now = Date.now() } = {}) {
  requireThat(
    Number.isSafeInteger(now) && Math.abs(now) <= 8_640_000_000_000_000,
    'INVALID_REVIEW_TIME',
    'Inspection time is invalid',
  );
  const run = snapshot(raw);
  exact(run, [
    'schema',
    'version',
    'id',
    'createdAt',
    'updatedAt',
    'generation',
    'status',
    'request',
    'recipe',
    'sourceRevision',
    'sourceMode',
    'context',
    'binding',
    'callsUsed',
    'steps',
    'events',
    'result',
    'review',
    'checksum',
  ]);
  await verifyRun(run);
  requireThat(
    ['synthetic-fixture', 'datahub-mcp'].includes(run.sourceMode),
    'EVIDENCE_BINDING_MISMATCH',
    'Unsupported source mode',
  );
  const compiled = compileRecipe(run.recipe),
    outputs = {},
    evidence = [],
    checks = [];
  const add = (id, detail) => checks.push({ id, status: 'pass', detail });
  date(run.createdAt);
  date(run.updatedAt);
  exact(run.context, ['scenarioId']);
  let generation = 0;
  for (const event of run.events) {
    exact(event, ['sequence', 'time', 'generation', 'type', 'step', 'detail', 'previous', 'hash']);
    date(event.time);
    requireThat(
      Number.isInteger(event.generation) &&
        event.generation >= generation &&
        event.generation <= run.generation,
      'INVALID_CHECKPOINT',
      'Event generation is inconsistent',
    );
    generation = event.generation;
  }
  requireThat(
    run.events.at(-1).time === run.updatedAt,
    'INVALID_REVIEW_TIME',
    'Final event time does not match the checkpoint',
  );
  add(
    'checkpoint',
    'Schema, input binding, checksum, step hashes and event-chain integrity match.',
  );
  for (const id of compiled.order) {
    const step = run.steps[id];
    exact(step, [
      'id',
      'status',
      'attempts',
      'output',
      'outputDigest',
      'error',
      'startedAt',
      'endedAt',
      'durationMs',
      'reused',
    ]);
    requireThat(
      typeof step.reused === 'boolean' && Number.isFinite(step.durationMs) && step.durationMs >= 0,
      'INVALID_CHECKPOINT',
      'Step metadata is invalid',
    );
    if (step.startedAt !== null) date(step.startedAt);
    if (step.endedAt !== null) date(step.endedAt);
    if (step.status !== 'completed') continue;
    requireThat(step.startedAt !== null && step.endedAt !== null, 'INVALID_REVIEW_TIME');
    const node = compiled.recipe.nodes.find((n) => n.id === id);
    requireThat(
      node.dependsOn.every((dep) => run.steps[dep].status === 'completed'),
      'DEPENDENCY_MISMATCH',
      'Completed output has an incomplete dependency',
    );
    outputs[id] = step.output;
    if (REGISTRY[id].kind === 'tool') {
      const embedded = { ...step.output };
      delete embedded.digest;
      const checked = await validateEvidence(embedded, id, run.request, run.sourceRevision);
      requireThat(
        checked.source.mode === run.sourceMode && equal(checked, step.output),
        'EVIDENCE_BINDING_MISMATCH',
        'Embedded evidence source or inner digest does not match',
      );
      evidence.push({
        kind: id,
        coverage: checked.coverage,
        observedAt: checked.observedAt,
        freshness: evidenceFreshness(
          checked,
          now,
          run.recipe.policy === 'strict' ? 3600000 : 86400000,
        ),
        digest: checked.digest,
      });
    }
  }
  add(
    'evidence',
    `${evidence.length} completed evidence contracts match their targets, modes, revisions and inner digests.`,
  );
  if (outputs.compatibility) {
    requireThat(
      equal(assessCompatibility(run.request, outputs.schema), outputs.compatibility),
      'COMPATIBILITY_REPLAY_MISMATCH',
      'Compatibility output does not reproduce from the supplied schema',
    );
    add(
      'compatibility',
      'Deterministic compatibility reproduces from embedded schema and request.',
    );
  }
  if (outputs.policy) {
    requireThat(
      policyAtRecordedWindow(run, outputs),
      'POLICY_REPLAY_MISMATCH',
      'Recorded policy does not reproduce within its declared execution window',
    );
    add('policy', 'Policy reproduces at a freshness-consistent point in its recorded time window.');
  }
  if (outputs.artifacts) {
    requireThat(
      equal(buildArtifacts(run.request, outputs, run.binding), outputs.artifacts),
      'ARTIFACT_REPLAY_MISMATCH',
      'Draft artifacts do not reproduce from their bound inputs',
    );
    add('artifacts', 'Draft artifacts regenerate exactly; nothing was executed.');
  }
  const completed = run.status === 'completed';
  if (completed) {
    const projection = {
      policy: outputs.policy,
      artifacts: outputs.artifacts,
      evidence: Object.fromEntries(
        Object.entries(outputs).filter(([id]) => REGISTRY[id].kind === 'tool'),
      ),
    };
    requireThat(
      equal(projection, run.result),
      'RESULT_PROJECTION_MISMATCH',
      'The exported result differs from its completed step outputs',
    );
    add('projection', 'Exported policy, artifacts and evidence match completed step outputs.');
  } else
    requireThat(
      run.result === null && run.review === null,
      'INCOMPLETE_RESULT',
      'An incomplete run cannot carry a completed review or acknowledgement',
    );
  if (run.review !== null) {
    exact(run.review, [
      'reviewer',
      'note',
      'binding',
      'runId',
      'generation',
      'resultDigest',
      'policyVersion',
      'recordedAt',
      'executionAuthorized',
      'authentication',
    ]);
    requireThat(
      run.review.authentication === 'local-unverified' &&
        run.review.policyVersion === POLICY_VERSION,
      'INVALID_REVIEW',
      'A local review note is not authenticated approval',
    );
    date(run.review.recordedAt);
    add(
      'acknowledgement',
      'The local unverified note is bound to the exact result, not execution authority.',
    );
  }
  const current = completed ? evaluatePolicy(run.request, run.recipe, outputs, now) : null;
  return {
    schema: 'lineageguard.inspection/1',
    inspectorVersion: INSPECTOR_VERSION,
    applicationVersion: STUDIO_VERSION,
    inspectedAt: new Date(now).toISOString(),
    runId: run.id,
    generation: run.generation,
    runStatus: run.status,
    completed,
    binding: run.binding,
    checksum: run.checksum,
    sourceMode: run.sourceMode,
    integrity: 'pass',
    consistency: 'pass',
    recordedDecision: run.result?.policy.decision || null,
    currentDecision: current?.decision || null,
    evidenceReadyNow: current?.evidenceReady || false,
    acknowledgement: run.review ? 'local-unverified' : 'none',
    evidence,
    checks,
    toolCalls: 0,
    sourceAuthenticated: false,
    executionAuthorized: false,
    resumableImport: false,
    scope:
      'Internal consistency and deterministic replay of supplied evidence only. No source was reread. Hashes do not authenticate authors, source truth, approval or a complete real-world execution history.',
  };
}
