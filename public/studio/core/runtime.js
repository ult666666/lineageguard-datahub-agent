import {
  STUDIO_VERSION,
  POLICY_VERSION,
  StudioError,
  snapshot,
  canonical,
  hash,
  validateRequest,
  requireThat,
  publicError,
  text,
} from './contract.js';
import { REGISTRY, compileRecipe } from './recipe.js';
import { validateEvidence, evidenceFreshness } from './evidence.js';
import { assessCompatibility, evaluatePolicy } from './policy.js';
import { buildArtifacts } from './artifacts.js';
const activeRuns = new Set();
const iso = () => new Date().toISOString();
const body = (run) => {
  const copy = { ...run };
  delete copy.checksum;
  return copy;
};
const bindingFor = (run) =>
  hash({
    request: run.request,
    recipe: run.recipe,
    sourceRevision: run.sourceRevision,
    sourceMode: run.sourceMode,
    context: run.context,
    policyVersion: POLICY_VERSION,
    version: STUDIO_VERSION,
  });
async function append(run, type, step = null, detail = {}) {
  const event = {
    sequence: run.events.length + 1,
    time: iso(),
    generation: run.generation,
    type,
    step,
    detail,
    previous: run.events.at(-1)?.hash || null,
  };
  event.hash = await hash(event);
  run.events.push(event);
  run.updatedAt = event.time;
  run.checksum = await hash(body(run));
}
export async function createRun(request, recipe, adapter) {
  requireThat(
    adapter?.readOnly === true &&
      typeof adapter.revision === 'string' &&
      adapter.revision.length <= 200,
    'INVALID_ADAPTER',
    'Read-only adapter with a revision is required',
  );
  const checked = validateRequest(request),
    compiled = compileRecipe(recipe),
    now = iso();
  const run = {
    schema: 'lineageguard.run/2',
    version: STUDIO_VERSION,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    generation: 0,
    status: 'created',
    request: checked,
    recipe: compiled.recipe,
    sourceRevision: adapter.revision,
    sourceMode: adapter.mode,
    context: { scenarioId: adapter.scenarioId || null },
    binding: '',
    callsUsed: 0,
    steps: {},
    events: [],
    result: null,
    review: null,
    checksum: '',
  };
  for (const id of compiled.order)
    run.steps[id] = {
      id,
      status: 'pending',
      attempts: 0,
      output: null,
      outputDigest: null,
      error: null,
      startedAt: null,
      endedAt: null,
      durationMs: 0,
      reused: false,
    };
  run.binding = await bindingFor(run);
  await append(run, 'run.created');
  return snapshot(run);
}
export async function verifyRun(raw) {
  const run = snapshot(raw);
  requireThat(
    run.schema === 'lineageguard.run/2' && run.version === STUDIO_VERSION,
    'INVALID_CHECKPOINT',
    'Unsupported checkpoint schema',
  );
  const compiled = compileRecipe(run.recipe);
  validateRequest(run.request);
  requireThat(
    /^[a-f0-9-]{36}$/.test(run.id) &&
      ['created', 'running', 'paused', 'cancelled', 'failed', 'completed'].includes(run.status),
    'INVALID_CHECKPOINT',
  );
  requireThat(
    Number.isInteger(run.generation) &&
      run.generation >= 0 &&
      run.generation <= 100 &&
      Number.isInteger(run.callsUsed) &&
      run.callsUsed >= 0 &&
      run.callsUsed <= run.recipe.budget.maxCalls,
    'INVALID_CHECKPOINT',
  );
  requireThat(
    run.binding === (await bindingFor(run)),
    'BINDING_MISMATCH',
    'Checkpoint binding changed',
  );
  requireThat(
    run.checksum === (await hash(body(run))),
    'CHECKSUM_MISMATCH',
    'Checkpoint checksum mismatch',
  );
  requireThat(
    Array.isArray(run.events) && run.events.length >= 1 && run.events.length <= 1000,
    'INVALID_CHECKPOINT',
  );
  let previous = null,
    index = 0;
  for (const event of run.events) {
    const e = { ...event };
    delete e.hash;
    requireThat(
      event.previous === previous && event.sequence === ++index && event.hash === (await hash(e)),
      'EVENT_MISMATCH',
      'Checkpoint event history changed',
    );
    previous = event.hash;
  }
  requireThat(Object.keys(run.steps).length === compiled.order.length, 'INVALID_CHECKPOINT');
  for (const id of compiled.order) {
    const s = run.steps[id];
    requireThat(
      s?.id === id && ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(s.status),
      'INVALID_CHECKPOINT',
    );
    requireThat(
      Number.isInteger(s.attempts) &&
        s.attempts >= 0 &&
        s.attempts <= run.recipe.budget.maxCalls + 100,
      'INVALID_CHECKPOINT',
    );
    if (s.status === 'completed')
      requireThat(
        s.output !== null && s.outputDigest === (await hash(s.output)),
        'OUTPUT_MISMATCH',
        'Completed output changed',
      );
    else
      requireThat(
        s.output === null && s.outputDigest === null,
        'INVALID_CHECKPOINT',
        'Incomplete step cannot carry authoritative output',
      );
  }
  if (run.status === 'completed')
    requireThat(
      compiled.order.every((id) => run.steps[id].status === 'completed') &&
        run.result?.policy?.executionAuthorized === false,
      'INVALID_CHECKPOINT',
    );
  if (run.review)
    requireThat(
      run.status === 'completed' &&
        run.review.binding === run.binding &&
        run.review.executionAuthorized === false &&
        run.review.runId === run.id &&
        run.review.generation === run.generation &&
        run.review.resultDigest === (await hash(run.result)),
      'INVALID_REVIEW',
      'Review evidence binding is invalid',
    );
  return true;
}
async function bounded(work, signal, ms) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer, abort;
  const failed = new Promise((_, reject) => {
    abort = () =>
      reject(new StudioError('CANCELLED', 'Step cancelled', { cause: combined.reason }));
    combined.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      const e = new StudioError('TIMEOUT', 'Step deadline timeout');
      reject(e);
      controller.abort(e);
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(combined)), failed]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', abort);
  }
}

/** Real bounded DAG execution. onCheckpoint is awaited before dispatch continues. */
export async function executeRun(
  original,
  { adapter, signal, onCheckpoint = async () => {}, pauseBeforePolicy = false } = {},
) {
  await verifyRun(original);
  requireThat(
    adapter?.readOnly === true && adapter.revision === original.sourceRevision,
    'BINDING_MISMATCH',
    'Source revision changed; create a new review',
  );
  requireThat(!activeRuns.has(original.id), 'RUN_BUSY', 'This run already has a writer');
  requireThat(
    original.status !== 'completed',
    'RUN_COMPLETE',
    'Create a new run to change a completed review',
  );
  activeRuns.add(original.id);
  const run = snapshot(original),
    compiled = compileRecipe(run.recipe),
    internal = new AbortController();
  const combined = signal ? AbortSignal.any([signal, internal.signal]) : internal.signal;
  let queue = Promise.resolve(),
    fatal = null,
    stopReason = null,
    totalTimer;
  function commit(type, step, mutate = () => {}, detail = {}) {
    const next = queue.then(async () => {
      if (fatal) throw fatal;
      requireThat(run.events.length < 995, 'EVENT_LIMIT', 'Run event budget exhausted');
      mutate();
      await append(run, type, step, detail);
      try {
        await onCheckpoint(snapshot(run));
      } catch (cause) {
        fatal = new StudioError('CHECKPOINT_FAILED', 'Checkpoint persistence failed', { cause });
        internal.abort(fatal);
        throw fatal;
      }
    });
    queue = next.catch(() => {});
    return next;
  }
  const outputs = () =>
    Object.fromEntries(
      Object.entries(run.steps)
        .filter(([, s]) => s.status === 'completed')
        .map(([id, s]) => [id, s.output]),
    );
  try {
    const invalid = new Set();
    for (const [id, s] of Object.entries(run.steps))
      if (
        s.status !== 'completed' ||
        (REGISTRY[id].kind === 'tool' &&
          evidenceFreshness(
            s.output,
            Date.now(),
            run.recipe.policy === 'strict' ? 3600000 : 86400000,
          ) !== 'current')
      )
        invalid.add(id);
    for (const id of compiled.order)
      if (compiled.recipe.nodes.find((n) => n.id === id).dependsOn.some((d) => invalid.has(d)))
        invalid.add(id);
    await commit(run.generation ? 'run.resumed' : 'run.started', null, () => {
      run.generation++;
      run.status = 'running';
      run.result = null;
      run.review = null;
      for (const [id, s] of Object.entries(run.steps)) {
        s.reused = s.status === 'completed' && !invalid.has(id);
        if (!s.reused) {
          s.status = 'pending';
          s.output = null;
          s.outputDigest = null;
          s.error = null;
        }
      }
    });
    totalTimer = setTimeout(() => {
      stopReason = 'failed';
      internal.abort(new StudioError('TIMEOUT', 'Run deadline exceeded'));
    }, run.recipe.budget.totalTimeoutMs);
    async function worker(id) {
      const s = run.steps[id],
        isTool = REGISTRY[id].kind === 'tool';
      const start = performance.now();
      try {
        await commit('step.started', id, () => {
          combined.throwIfAborted();
          s.status = 'running';
          s.startedAt = iso();
          s.error = null;
        });
        let output;
        for (let attempt = 0; attempt <= (isTool ? run.recipe.budget.retries : 0); attempt++) {
          try {
            await commit(
              'step.attempt',
              id,
              () => {
                combined.throwIfAborted();
                if (isTool)
                  requireThat(
                    run.callsUsed < run.recipe.budget.maxCalls,
                    'CALL_BUDGET',
                    'Read-call budget exhausted',
                  );
                s.attempts++;
                if (isTool) run.callsUsed++;
              },
              { attempt: attempt + 1, kind: REGISTRY[id].kind },
            );
            output = await bounded(
              async (childSignal) => {
                if (isTool)
                  return validateEvidence(
                    await adapter.read(id, run.request, {
                      signal: childSignal,
                      attempt: attempt + 1,
                      generation: run.generation,
                    }),
                    id,
                    run.request,
                    run.sourceRevision,
                  );
                const data = outputs();
                if (id === 'compatibility') return assessCompatibility(run.request, data.schema);
                if (id === 'policy') return evaluatePolicy(run.request, run.recipe, data);
                if (id === 'artifacts') return buildArtifacts(run.request, data, run.binding);
                throw new StudioError('CAPABILITY_DENIED', 'Unknown operation');
              },
              combined,
              run.recipe.budget.stepTimeoutMs,
            );
            combined.throwIfAborted();
            break;
          } catch (error) {
            if (fatal) throw fatal;
            if (
              !isTool ||
              combined.aborted ||
              !['TOOL_UNAVAILABLE', 'TIMEOUT'].includes(error?.code) ||
              attempt >= run.recipe.budget.retries
            )
              throw error;
            await commit('step.retry', id, () => {}, { code: error.code, attempt: attempt + 1 });
          }
        }
        const digest = await hash(output);
        await commit(
          'step.completed',
          id,
          () => {
            combined.throwIfAborted();
            s.status = 'completed';
            s.output = snapshot(output);
            s.outputDigest = digest;
            s.endedAt = iso();
            s.durationMs = Math.round(performance.now() - start);
          },
          { outputDigest: digest },
        );
      } catch (error) {
        if (fatal) throw fatal;
        const cancelled =
          combined.aborted && error?.code !== 'TIMEOUT' && error?.code !== 'CALL_BUDGET';
        const errorInfo = publicError(
          cancelled ? new StudioError('CANCELLED', 'Cancelled') : error,
        );
        await commit(
          cancelled ? 'step.cancelled' : 'step.failed',
          id,
          () => {
            s.status = cancelled ? 'cancelled' : 'failed';
            s.output = null;
            s.outputDigest = null;
            s.error = errorInfo;
            s.endedAt = iso();
            s.durationMs = Math.round(performance.now() - start);
          },
          errorInfo,
        );
        if (!cancelled) {
          stopReason = 'failed';
          internal.abort(error);
        }
      }
    }
    const active = new Map();
    while (true) {
      if (fatal) break;
      if (!combined.aborted && !stopReason) {
        const ready = compiled.order.filter(
          (id) =>
            run.steps[id].status === 'pending' &&
            !active.has(id) &&
            compiled.recipe.nodes
              .find((n) => n.id === id)
              .dependsOn.every((dep) => run.steps[dep].status === 'completed'),
        );
        for (const id of ready) {
          if (active.size >= run.recipe.budget.maxConcurrency) break;
          if (pauseBeforePolicy && id === 'policy') continue;
          const task = worker(id)
            .catch((error) => {
              fatal ??= error;
              internal.abort(error);
            })
            .finally(() => active.delete(id));
          active.set(id, task);
        }
      }
      if (!active.size) break;
      await Promise.race([...active.values()]);
    }
    await Promise.all([...active.values()]);
    await queue;
    if (fatal) throw fatal;
    const complete = compiled.order.every((id) => run.steps[id].status === 'completed');
    const finalStatus = complete
      ? 'completed'
      : stopReason === 'failed'
        ? 'failed'
        : combined.aborted
          ? 'cancelled'
          : pauseBeforePolicy
            ? 'paused'
            : 'failed';
    await commit(`run.${finalStatus}`, null, () => {
      run.status = finalStatus;
      if (complete)
        run.result = {
          policy: run.steps.policy.output,
          artifacts: run.steps.artifacts.output,
          evidence: Object.fromEntries(
            Object.entries(outputs()).filter(([id]) => REGISTRY[id].kind === 'tool'),
          ),
        };
    });
    await verifyRun(run);
    return snapshot(run);
  } finally {
    clearTimeout(totalTimer);
    activeRuns.delete(run.id);
  }
}
export function reviewIsCurrent(run, now = Date.now()) {
  return (
    run?.status === 'completed' &&
    Object.entries(run.steps)
      .filter(([id]) => REGISTRY[id].kind === 'tool')
      .every(
        ([, step]) =>
          step.status === 'completed' &&
          evidenceFreshness(
            step.output,
            now,
            run.recipe.policy === 'strict' ? 3600000 : 86400000,
          ) === 'current',
      )
  );
}
export async function acknowledgeRun(original, reviewer, note) {
  await verifyRun(original);
  requireThat(
    original.status === 'completed' &&
      original.result.policy.evidenceReady &&
      original.result.policy.decision !== 'block',
    'REVIEW_NOT_READY',
    'Only an evidence-ready nonblocked review can be acknowledged',
  );
  requireThat(
    reviewIsCurrent(original),
    'STALE_REVIEW',
    'Evidence is no longer current; rerun before acknowledging',
  );
  text(reviewer, 80, 'Reviewer');
  text(note, 500, 'Review note');
  const run = snapshot(original);
  run.review = {
    reviewer,
    note,
    binding: run.binding,
    runId: run.id,
    generation: run.generation,
    resultDigest: await hash(run.result),
    policyVersion: POLICY_VERSION,
    recordedAt: iso(),
    executionAuthorized: false,
    authentication: 'local-unverified',
  };
  await append(run, 'review.acknowledged');
  return run;
}
