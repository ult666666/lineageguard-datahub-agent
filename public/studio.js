import { inspectReview } from './studio/core/inspection.js';
import { mountSavedComparison } from './studio/saved-comparison-view.js';
import { mountInspector } from './studio/inspection-view.js';
import {
  STUDIO_VERSION,
  StudioError,
  validateRequest,
  requireThat,
  snapshot,
} from './studio/core/contract.js';
import { makeRecipe, compileRecipe } from './studio/core/recipe.js';
import { scenario } from './studio/core/fixtures.js';
import {
  createRun,
  executeRun,
  verifyRun,
  acknowledgeRun,
  reviewIsCurrent,
} from './studio/core/runtime.js';
import { compareRuns } from './studio/core/comparison.js';
import { BrowserCheckpoints } from './studio/storage.js';
import { api, httpFixtureAdapter } from './studio/transport.js';
import {
  el,
  message,
  showView,
  renderRun,
  renderEvidence,
  renderComparison,
  renderEvaluations,
  renderHistory,
} from './studio/view.js';

const $ = (id) => document.getElementById(id);
let metadata = null,
  busy = false,
  current = null,
  recipe = makeRecipe('standard'),
  request = null,
  valid = false,
  controller = null,
  checkpoints = null,
  storageReady = true,
  evaluation = null;
let history = [],
  selectedId = 'rename',
  editing = false;
mountInspector({ current: () => current, busy: () => busy });
mountSavedComparison();
const local = () => metadata?.runtime === 'durable-local';
const errorText = (error) =>
  error instanceof StudioError
    ? error.message
    : error?.name === 'AbortError'
      ? 'The operation was cancelled.'
      : 'The operation could not finish. Existing evidence has been preserved.';
function controls() {
  $('inspect-current').disabled = busy || !current;
  const complete = current?.status === 'completed',
    ready =
      complete &&
      reviewIsCurrent(current) &&
      current.result.policy.evidenceReady &&
      current.result.policy.decision !== 'block';
  $('configuration').disabled = busy || !metadata;
  $('run-button').disabled = busy || !valid || !metadata || !storageReady;
  $('run-button').textContent = busy ? 'Running…' : '▶ Run review';
  $('cancel-button').disabled = !busy || !controller;
  $('resume-button').disabled =
    busy ||
    !current ||
    current.status === 'completed' ||
    current.status === 'created' ||
    !storageReady;
  $('pause-toggle').disabled = busy;
  $('restore-toggle').disabled = busy;
  for (const id of ['download-run', 'download-markdown', 'download-sql'])
    $(id).disabled = !complete || busy;
  for (const id of ['compare-additive', 'compare-strict']) $(id).disabled = !complete || busy;
  $('acknowledge-button').disabled = !ready || busy;
  $('evaluate-button').disabled = busy || !metadata;
  $('download-evaluations').disabled = !evaluation || busy;
  $('restore-option').hidden = !['lineage-outage', 'transient-tool'].includes(selectedId);
}
function paint() {
  renderRun(current, recipe);
  controls();
}
function invalidate() {
  if (editing) return;
  current = null;
  controller = null;
  $('comparison-result').dataset.ready = 'false';
  $('comparison-result').replaceChildren(
    el('section', 'Complete a new review for the changed inputs.', { class: 'panel empty-copy' }),
  );
}
function validate(invalidateResult = true) {
  if (invalidateResult) invalidate();
  try {
    request = validateRequest(JSON.parse($('request-json').value));
    recipe = compileRecipe(JSON.parse($('recipe-json').value)).recipe;
    valid = true;
    $('validation-message').textContent = 'Valid request · verified workflow dependencies';
    $('validation-message').dataset.valid = 'true';
  } catch (error) {
    valid = false;
    $('validation-message').textContent =
      'Invalid input: ' + (error instanceof SyntaxError ? 'Enter valid JSON.' : errorText(error));
    $('validation-message').dataset.valid = 'false';
  }
  paint();
}
function writeEditors(run = null) {
  editing = true;
  if (run) {
    selectedId = run.context.scenarioId || 'rename';
    $('scenario-select').value = selectedId;
    recipe = run.recipe;
    request = run.request;
  } else {
    selectedId = $('scenario-select').value;
    request = scenario(selectedId).request;
    recipe = makeRecipe($('profile-select').value);
  }
  $('scenario-description').textContent = scenario(selectedId).detail;
  $('request-json').value = JSON.stringify(request, null, 2);
  $('recipe-json').value = JSON.stringify(recipe, null, 2);
  $('concurrency-input').value = recipe.budget.maxConcurrency;
  $('retries-input').value = recipe.budget.retries;
  $('pause-toggle').checked = false;
  $('restore-toggle').checked = false;
  editing = false;
  validate(!run);
}
async function refreshHistory() {
  if (local()) history = (await api('/api/runs')).runs;
  else history = checkpoints?.history || [];
  renderHistory(history);
}
async function acceptRun(run) {
  await verifyRun(run);
  current = run;
  paint();
}
async function pollRun(id, { display = true, minimumGeneration = 1 } = {}) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const record = await api('/api/runs/' + id);
    await verifyRun(record.run);
    if (display) await acceptRun(record.run);
    if (record.storageError)
      throw new StudioError(
        'CHECKPOINT_FAILED',
        'Local checkpoint persistence failed. Reload to inspect the last stored state.',
      );
    if (
      record.run.generation >= minimumGeneration &&
      record.run.status !== 'created' &&
      record.run.status !== 'running'
    )
      return record.run;
    if (!record.leaseActive && record.run.status === 'running')
      throw new StudioError(
        'INTERRUPTED',
        'The local writer stopped. The last checkpoint is preserved for an explicit resume.',
      );
    await new Promise((resolve) => setTimeout(resolve, 90));
  }
  throw new StudioError(
    'TIMEOUT',
    'The run did not settle within the display deadline. Its local checkpoint remains available.',
  );
}
async function execute({
  resume = false,
  input = request,
  graph = recipe,
  display = true,
  id = selectedId,
  pause = $('pause-toggle').checked,
  restored = $('restore-toggle').checked,
} = {}) {
  if (local()) {
    const result = resume
      ? await api('/api/runs/' + current.id + '/resume', { restored, pauseBeforePolicy: false })
      : await api('/api/runs', {
          scenarioId: id,
          request: input,
          recipe: graph,
          pauseBeforePolicy: pause,
        });
    if (display) await acceptRun(result.run);
    controller = {
      abort: () =>
        api('/api/runs/' + result.run.id + '/cancel', {}).catch((error) =>
          message(errorText(error)),
        ),
    };
    controls();
    return pollRun(result.run.id, { display, minimumGeneration: result.run.generation + 1 });
  }
  const adapter = httpFixtureAdapter(id, { restored });
  const run = resume ? current : await createRun(input, graph, adapter);
  controller = new AbortController();
  if (display) await acceptRun(run);
  return executeRun(run, {
    adapter,
    signal: controller.signal,
    pauseBeforePolicy: resume ? false : pause,
    onCheckpoint: async (state) => {
      await checkpoints.save(state);
      if (display) await acceptRun(state);
    },
  });
}
async function runReview(resume = false) {
  if (busy) return;
  if (!resume && !valid) return;
  busy = true;
  message('');
  controls();
  try {
    const result = await execute({ resume });
    await acceptRun(result);
    await refreshHistory();
  } catch (error) {
    message(errorText(error));
    if (error.code === 'CHECKPOINT_FAILED' || error.code === 'STORAGE_CONFLICT')
      storageReady = false;
  } finally {
    busy = false;
    controller = null;
    controls();
  }
}
async function compare(kind) {
  if (busy || current?.status !== 'completed') return;
  const left = snapshot(current);
  busy = true;
  message('Evaluating the comparison with the same bounded runtime…', false);
  controls();
  try {
    const input = snapshot(left.request);
    let graph = left.recipe;
    if (kind === 'additive') {
      input.changeRequest.summary = 'Additive alternative: preserve the current contract';
      const original = input.changeRequest.changes[0];
      const name = (original.kind === 'rename' ? original.to : original.field + '_v2').slice(
        0,
        128,
      );
      input.changeRequest.changes = [
        {
          kind: 'add',
          field: name,
          type: original.type || (original.kind === 'type_change' ? original.to : 'VARCHAR(64)'),
          required: false,
        },
      ];
    } else graph = makeRecipe('strict');
    const right = await execute({
      input,
      graph,
      display: false,
      id: left.context.scenarioId,
      pause: false,
      restored: $('restore-toggle').checked,
    });
    requireThat(
      right.status === 'completed',
      'COMPARISON_INCOMPLETE',
      'The alternative did not complete; inspect its history rather than infer a comparison',
    );
    renderComparison(compareRuns(left, right), left, right);
    current = left;
    if (!local()) await checkpoints.save(left);
    await refreshHistory();
    message('');
  } catch (error) {
    message(errorText(error));
    current = left;
    if (['CHECKPOINT_FAILED', 'STORAGE_CONFLICT'].includes(error.code)) storageReady = false;
  } finally {
    busy = false;
    controller = null;
    controls();
  }
}
function download(value, name, type = 'application/json') {
  const blob = new Blob(
    [typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'],
    { type },
  );
  const url = URL.createObjectURL(blob),
    a = el('a', '', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeAction(fn) {
  return () =>
    Promise.resolve()
      .then(fn)
      .catch((error) => message(errorText(error)));
}

for (const button of document.querySelectorAll('[data-view]'))
  button.addEventListener('click', () => showView(button.dataset.view));
const tabs = [...document.querySelectorAll('[role=tab]')];
for (const tab of tabs)
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      showView(tabs[next].dataset.view);
      tabs[next].focus();
    }
  });
$('scenario-select').addEventListener('change', () => {
  message('');
  writeEditors();
});
$('profile-select').addEventListener('change', () => {
  recipe = makeRecipe($('profile-select').value);
  $('recipe-json').value = JSON.stringify(recipe, null, 2);
  $('concurrency-input').value = recipe.budget.maxConcurrency;
  $('retries-input').value = recipe.budget.retries;
  validate();
});
for (const id of ['concurrency-input', 'retries-input'])
  $(id).addEventListener('input', () => {
    try {
      const value = JSON.parse($('recipe-json').value);
      value.budget[id === 'concurrency-input' ? 'maxConcurrency' : 'retries'] = Number($(id).value);
      $('recipe-json').value = JSON.stringify(value, null, 2);
    } catch {
      /* Existing editor validation reports the invalid JSON. */
    }
    validate();
  });
for (const id of ['request-json', 'recipe-json']) $(id).addEventListener('input', () => validate());
$('compile-button').addEventListener('click', () => validate());
$('run-button').addEventListener('click', () => runReview(false));
$('resume-button').addEventListener('click', () => runReview(true));
$('cancel-button').addEventListener('click', () => controller?.abort());
$('evidence-select').addEventListener('change', () =>
  renderEvidence(current, $('evidence-select').value),
);
function inspectNode(event) {
  const group = event.target.closest('[data-node]');
  if (!group) return;
  showView('evidence');
  renderEvidence(current, group.dataset.node);
  $('evidence-select').focus();
}
$('pipeline-graph').addEventListener('click', inspectNode);
$('pipeline-graph').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    inspectNode(event);
  }
});
$('compare-additive').addEventListener('click', () => compare('additive'));
$('compare-strict').addEventListener('click', () => compare('strict'));
for (const [id, key, name, type] of [
  ['download-run', null, null, 'application/json'],
  ['download-markdown', 'markdown', 'lineageguard-review.md', 'text/markdown'],
  ['download-sql', 'sql', 'lineageguard-review-draft.sql', 'text/plain'],
]) {
  $(id).addEventListener(
    'click',
    safeAction(async () => {
      const selected = current;
      if (!selected || selected.status !== 'completed' || busy) return;
      await inspectReview(selected);
      // Changing input while verification is in flight must not export an old review.
      if (current !== selected || busy) return;
      download(
        key ? selected.result.artifacts[key] : selected,
        name || `lineageguard-${selected.id.slice(0, 8)}.json`,
        type,
      );
    }),
  );
}
$('acknowledge-button').addEventListener(
  'click',
  safeAction(async () => {
    if (!current || busy) return;
    busy = true;
    controls();
    try {
      const run = local()
        ? (
            await api('/api/runs/' + current.id + '/acknowledge', {
              reviewer: $('reviewer-name').value,
              note: $('review-note').value,
            })
          ).run
        : await acknowledgeRun(current, $('reviewer-name').value, $('review-note').value);
      if (!local()) await checkpoints.save(run);
      await acceptRun(run);
      await refreshHistory();
      message('The local review note is recorded. It does not authorize execution.', false);
    } finally {
      busy = false;
      controls();
    }
  }),
);
$('evaluate-button').addEventListener(
  'click',
  safeAction(async () => {
    if (busy) return;
    busy = true;
    controls();
    $('eval-summary').textContent = 'Executing the scenario suite…';
    try {
      evaluation = await api('/api/studio', { action: 'evaluate' });
      requireThat(
        evaluation.schema === 'lineageguard.evaluations/2' && Array.isArray(evaluation.checks),
        'INVALID_RESPONSE',
      );
      renderEvaluations(evaluation);
    } finally {
      busy = false;
      controls();
    }
  }),
);
$('download-evaluations').addEventListener('click', () => {
  if (evaluation) download(evaluation, 'lineageguard-evaluations.json');
});
$('history-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-run-id]');
  if (!button || busy) return;
  safeAction(async () => {
    const run = local()
      ? (await api('/api/runs/' + button.dataset.runId)).run
      : history.find((r) => r.id === button.dataset.runId);
    await verifyRun(run);
    current = run;
    writeEditors(run);
    showView('overview');
    paint();
  })();
});
window.addEventListener('storage', (event) => {
  if (event.key === 'lineageguard.studio.v2' && !local()) {
    storageReady = false;
    message(
      'Another tab changed local checkpoints. Reload to read the latest verified state before running.',
    );
    controls();
  }
});

try {
  metadata = await api('/api/studio');
  requireThat(
    metadata.version === STUDIO_VERSION &&
      ['browser-session', 'durable-local'].includes(metadata.runtime),
    'VERSION_MISMATCH',
    'The Studio UI and runtime versions differ. Reload the current release.',
  );
  $('runtime-mode').dataset.mode = metadata.runtime;
  $('runtime-mode').textContent = local()
    ? 'LOCAL · SQLITE CHECKPOINTS'
    : 'BROWSER SESSION · SYNTHETIC';
  $('session-description').textContent = local()
    ? 'Local durable runtime. Checkpoints are stored in SQLite on this computer. Synthetic evidence only; no catalog writes or SQL execution.'
    : 'Public preview. The real workflow runs in this browser against synthetic read-only tools. Checkpoints stay here unless exported; no durable cloud queue or paid inference.';
  for (const row of metadata.scenarios)
    $('scenario-select').append(el('option', row.label, { value: row.id }));
  $('scenario-select').value = 'rename';
  writeEditors();
  if (local()) {
    await refreshHistory();
    const latest = history.find((row) => row.status !== 'unavailable');
    if (latest) {
      current = (await api('/api/runs/' + latest.id)).run;
      await verifyRun(current);
      writeEditors(current);
    }
  } else {
    try {
      checkpoints = new BrowserCheckpoints(window.localStorage);
      const saved = await checkpoints.load();
      history = saved.history;
      if (saved.current) {
        current = saved.current;
        writeEditors(current);
      }
      renderHistory(history);
    } catch (error) {
      storageReady = false;
      message(errorText(error));
    }
  }
  if (current?.status === 'running')
    message(
      'This checkpoint was captured during a run. No writer has been resumed automatically; inspect and explicitly resume.',
      false,
    );
  paint();
  showView('overview');
} catch (error) {
  metadata = null;
  message(errorText(error));
  controls();
}
