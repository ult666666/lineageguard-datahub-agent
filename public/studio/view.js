import { reviewIsCurrent } from './core/runtime.js';
import { REGISTRY, compileRecipe } from './core/recipe.js';
import { evidenceFreshness } from './core/evidence.js';
const $ = (id) => document.getElementById(id);
const set = (id, value) => {
  const node = $(id);
  if (node) node.textContent = String(value);
};
// Text plus an optional color role (good, warn, bad); the text always carries the meaning.
const tone = (id, value, kind) => {
  set(id, value);
  const node = $(id);
  if (!node) return;
  if (kind) node.dataset.tone = kind;
  else delete node.dataset.tone;
};
const RISK_TONES = { blocked: 'bad', high: 'warn', low: 'good' };
const capitalize = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);
const KIND_LABELS = { tool: 'Tool', deterministic: 'Deterministic', policy: 'Policy' };
export function el(tag, text = '', attrs = {}) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = String(text);
  return node;
}
export function message(text = '', error = true) {
  const box = $('global-message');
  box.hidden = !text;
  box.textContent = text;
  box.dataset.kind = error ? 'error' : 'info';
}
export function showView(name) {
  const names = ['overview', 'evidence', 'artifacts', 'compare', 'evaluations', 'architecture'];
  if (!names.includes(name)) return;
  for (const value of names) {
    $('view-' + value).hidden = value !== name;
    const button = $('tab-' + value);
    button.setAttribute('aria-selected', String(value === name));
    button.tabIndex = value === name ? 0 : -1;
  }
}
export function renderWorkflow(recipe, run) {
  const compiled = compileRecipe(recipe),
    graph = $('pipeline-graph'),
    height = 410,
    width = Math.max(1040, compiled.levels.length * 205 + 24),
    positions = new Map();
  graph.setAttribute('viewBox', `0 0 ${width} ${height}`);
  graph.setAttribute('role', 'group');
  graph.dataset.wide = String(compiled.levels.length > 5);
  const fragment = document.createDocumentFragment();
  fragment.append(
    svg('title', {}, 'Compiled workflow. Select a completed step to inspect its output.'),
  );
  for (let level = 0; level < compiled.levels.length; level++) {
    const ids = compiled.levels[level],
      total = ids.length * 70 + (ids.length - 1) * 18;
    ids.forEach((id, row) =>
      positions.set(id, {
        x: 18 + (level * (width - 210)) / Math.max(1, compiled.levels.length - 1),
        y: (height - total) / 2 + row * 88,
      }),
    );
  }
  for (const node of compiled.recipe.nodes) {
    for (const dependency of node.dependsOn) {
      const a = positions.get(dependency),
        b = positions.get(node.id),
        middle = (a.x + 177 + b.x) / 2;
      const state = run?.steps[dependency]?.status;
      const to = run?.steps[node.id]?.status;
      fragment.append(
        svg('path', {
          d: `M${a.x + 177} ${a.y + 35} C${middle} ${a.y + 35},${middle} ${b.y + 35},${b.x} ${b.y + 35}`,
          class:
            'graph-edge' + (to === 'running' ? ' active' : state === 'completed' ? ' done' : ''),
        }),
      );
    }
  }
  for (const id of compiled.order) {
    const { x, y } = positions.get(id),
      item = REGISTRY[id],
      step = run?.steps[id],
      status = step?.status || 'pending';
    const kind = KIND_LABELS[item.kind] || capitalize(item.kind);
    const meta = step?.reused
      ? 'Reused, verified'
      : capitalize(status) + (step?.endedAt ? ` · ${step.durationMs} ms` : '');
    // The accessible name repeats the visible text in order, then says what Enter does.
    const group = svg('g', {
      class: 'graph-node',
      'data-node': id,
      'data-step-status': status,
      'data-kind': item.kind,
      transform: `translate(${x},${y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${kind}: ${item.label}, ${meta}. Inspect its output`,
    });
    // SVG never renders the spaces between the text elements; they keep the words apart for
    // tools that read the group's text.
    group.append(
      svg('rect', { width: 177, height: 70, rx: 6 }),
      svg('text', { x: 14, y: 20, class: 'node-kind' }, kind),
      ' ',
      svg('text', { x: 14, y: 39, class: 'node-title' }, item.label),
      ' ',
      svg('circle', { cx: 17.5, cy: 54, r: 3.5, class: 'state-dot' }),
      svg('text', { x: 27, y: 58, class: 'node-meta' }, meta),
    );
    fragment.append(group);
  }
  graph.replaceChildren(fragment);
  set(
    'graph-summary',
    `${compiled.order.length} steps · concurrency ${recipe.budget.maxConcurrency} · ${recipe.budget.maxCalls} call limit`,
  );
}
export function renderRun(run, recipe) {
  renderWorkflow(recipe, run);
  const phase = run?.status || 'created';
  const status = $('run-status');
  status.dataset.status = phase;
  status.textContent = phase === 'created' ? 'Ready' : capitalize(phase);
  set(
    'run-identity',
    run ? `${run.id.slice(0, 8)} · generation ${run.generation}` : 'No run created',
  );
  set('calls-value', `${run?.callsUsed || 0} / ${recipe.budget.maxCalls}`);
  const events = run?.events.length || 0;
  set('event-count', `${events} ${events === 1 ? 'event' : 'events'}`);
  const p = run?.status === 'completed' ? run.result?.policy : null;
  const fallback = {
    created: ['Not evaluated', 'Run a review to see the decision and the reasons behind it.'],
    running: ['Review in progress', 'The decision appears when the policy step finishes.'],
    paused: [
      'Paused before policy',
      'Completed evidence is saved. Resume to apply the policy and build the review package.',
    ],
    failed: [
      'No decision: a step failed',
      'Check the run trace. To recover, restore the source and resume the same run.',
    ],
    cancelled: ['No decision: cancelled', 'Completed evidence stays in the checkpoint.'],
  };
  set(
    'decision-title',
    p
      ? reviewIsCurrent(run)
        ? p.headline
        : 'Stale review: refresh evidence'
      : (fallback[phase] || fallback.created)[0],
  );
  set('decision-description', p ? p.method + '.' : (fallback[phase] || fallback.created)[1]);
  const current = p && reviewIsCurrent(run);
  tone('risk-value', p ? capitalize(p.riskLevel) : '–', p && RISK_TONES[p.riskLevel]);
  tone(
    'readiness-value',
    p ? (!current ? 'Stale, rerun' : p.evidenceReady ? 'Ready for review' : 'Needs evidence') : '–',
    p && (current && p.evidenceReady ? 'good' : 'warn'),
  );
  const reasons = $('policy-reasons');
  reasons.replaceChildren();
  if (p) {
    for (const r of p.reasons)
      reasons.append(
        el('div', r.detail, { class: 'reason' + (r.level === 'block' ? ' block' : '') }),
      );
    for (const g of p.gaps) reasons.append(el('div', g.detail, { class: 'reason gap' }));
  }
  const trace = $('trace-list');
  trace.replaceChildren();
  for (const e of (run?.events || []).slice(-14).reverse()) {
    const row = el('div', null, { class: 'trace-row' });
    row.append(
      el('time', e.time.slice(11, 19), { title: e.time + ' UTC' }),
      el('i', '', {
        class:
          'trace-dot ' +
          (e.type.includes('completed') ? 'completed' : e.type.includes('failed') ? 'failed' : ''),
      }),
    );
    const detail = el('span');
    detail.append(
      el('strong', e.step ? REGISTRY[e.step]?.label || e.step : 'Run'),
      document.createTextNode(
        ' · ' + e.type.split('.').at(-1) + (e.detail?.code ? ' · ' + e.detail.code : ''),
      ),
    );
    row.append(
      detail,
      el('code', (e.detail?.outputDigest || e.hash).slice(0, 12), {
        title: e.detail?.outputDigest || e.hash,
      }),
    );
    trace.append(row);
  }
  if (!run?.events.length)
    trace.append(
      el('p', 'Step events and output digests appear here as steps finish.', {
        class: 'empty-copy',
      }),
    );
  set('artifact-sql', p ? run.result.artifacts.sql : 'No draft for the current input.');
  set('artifact-markdown', p ? run.result.artifacts.markdown : 'No brief for the current input.');
  set(
    'review-status',
    run?.review
      ? `Acknowledged by ${run.review.reviewer} for run binding ${run.binding.slice(0, 12)}.`
      : 'Available when the review is complete, current and not blocked.',
  );
  renderEvidence(run);
}
export function renderEvidence(run, preferred) {
  const outputs = Object.values(run?.steps || {}).filter((s) => s.status === 'completed');
  const select = $('evidence-select'),
    selected = preferred || select.value;
  select.replaceChildren();
  for (const s of outputs) select.append(el('option', REGISTRY[s.id].label, { value: s.id }));
  if (!outputs.length) select.append(el('option', 'No evidence yet', { value: '' }));
  else if (outputs.some((s) => s.id === selected)) select.value = selected;
  const step = run?.steps[select.value],
    e = step?.output,
    metadata = $('evidence-metadata');
  metadata.replaceChildren();
  const pairs = e?.source
    ? [
        ['Source', e.source.mode],
        ['Revision', e.source.revision],
        ['Observed', e.observedAt],
        ['Coverage', e.coverage],
        ['Freshness', evidenceFreshness(e)],
        ['Evidence SHA-256', e.digest],
      ]
    : e
      ? [
          ['Component', REGISTRY[step.id].kind],
          ['Output SHA-256', step.outputDigest],
        ]
      : [];
  if (run && e) pairs.push(['Run binding', run.binding]);
  for (const [key, value] of pairs) {
    metadata.append(
      el('dt', key),
      el('dd', value, { class: key.includes('SHA') || key === 'Run binding' ? 'hash' : '' }),
    );
  }
  set('evidence-json', e ? JSON.stringify(e, null, 2) : 'Run a review to inspect its outputs.');
  const lineage = run?.steps?.lineage?.output;
  const graph = $('lineage-graph');
  graph.replaceChildren();
  graph.setAttribute('viewBox', '0 0 1040 260');
  if (!lineage) {
    graph.append(
      svg(
        'text',
        { x: 38, y: 80, class: 'lineage-empty' },
        'No validated lineage result received.',
      ),
    );
    tone('lineage-coverage', 'No lineage yet');
    set('lineage-note', 'No catalog result has been received.');
    return;
  }
  const data = lineage.data;
  tone(
    'lineage-coverage',
    `${capitalize(lineage.coverage)} coverage`,
    lineage.coverage === 'complete' ? 'good' : 'warn',
  );
  const root = data.nodes.find((n) => n.urn === run.request.datasetUrn),
    depth = new Map([[root.id, 0]]);
  for (let i = 0; i < data.nodes.length; i++)
    for (const edge of data.edges)
      if (depth.has(edge.from) && !depth.has(edge.to))
        depth.set(edge.to, Math.min(3, depth.get(edge.from) + 1));
  for (const n of data.nodes) if (!depth.has(n.id)) depth.set(n.id, 1);
  const maximum = Math.max(...depth.values()),
    positions = new Map();
  const levels = Array.from({ length: maximum + 1 }, (_, level) =>
    data.nodes.filter((n) => depth.get(n.id) === level),
  );
  // A dbt project can return many consumers at one depth: grow the canvas, never overlap.
  const height = Math.max(260, Math.max(...levels.map((g) => g.length)) * 86 + 28);
  graph.setAttribute('viewBox', `0 0 1040 ${height}`);
  levels.forEach((group, level) =>
    group.forEach((n, i) =>
      positions.set(n.id, {
        x: 28 + (level * 780) / Math.max(1, maximum),
        y: height / 2 - (group.length * 72 + (group.length - 1) * 14) / 2 + i * 86,
      }),
    ),
  );
  for (const edge of data.edges) {
    const a = positions.get(edge.from),
      b = positions.get(edge.to);
    if (!a || !b) continue;
    graph.append(
      svg('path', {
        class: 'lineage-edge',
        d: `M${a.x + 202} ${a.y + 36} C${(a.x + 202 + b.x) / 2} ${a.y + 36},${(a.x + 202 + b.x) / 2} ${b.y + 36},${b.x} ${b.y + 36}`,
      }),
    );
  }
  for (const n of data.nodes) {
    const p = positions.get(n.id),
      group = svg('g', {
        'data-asset': n.id,
        class: 'lineage-node' + (n.id === root.id ? ' target' : ''),
        transform: `translate(${p.x},${p.y})`,
      });
    group.append(
      svg('rect', { width: 202, height: 72, rx: 6 }),
      svg(
        'text',
        { x: 14, y: 20, class: 'asset-type' },
        capitalize(n.type) + (n.id === root.id ? ' · changed' : ''),
      ),
      svg('text', { x: 14, y: 38 }, n.name.length > 26 ? n.name.slice(0, 24) + '…' : n.name),
      svg('text', { x: 14, y: 57, class: 'asset-owner' }, n.owner || 'Owner not recorded'),
    );
    graph.append(group);
  }
  const checks = data.checks?.length
    ? ` ${data.checks.length} quality checks read this table. They are listed in the lineage JSON and never clear a change.`
    : '';
  set(
    'lineage-note',
    `${data.nodes.length - 1} downstream assets returned of ${data.total} declared. Edges are ${data.level}-level relationships from the source.${checks}`,
  );
}
export function renderComparison(diff, left, right, note = '') {
  const out = $('comparison-result');
  out.replaceChildren();
  out.dataset.ready = 'true';
  const cards = el('div', null, { class: 'compare-cards' });
  for (const [label, run, side] of [
    ['Current review', left, diff.left],
    ['Alternative', right, diff.right],
  ]) {
    const panel = el('section', null, { class: 'panel compare-card' });
    panel.append(
      el('h3', label),
      el('p', side.summary, { class: 'compare-summary' }),
      el('p', capitalize(side.decision.replaceAll('-', ' ')), { class: 'compare-decision' }),
    );
    panel.append(
      el(
        'p',
        `Evidence ${side.evidenceReady ? 'ready' : 'not ready'} · ${side.calls} evidence calls · ${side.policy} policy`,
        { class: 'muted' },
      ),
    );
    const details = el('details');
    details.append(
      el('summary', 'Request and binding'),
      el('pre', JSON.stringify({ request: run.request, binding: run.binding }, null, 2), {
        class: 'code-block',
      }),
    );
    panel.append(details);
    cards.append(panel);
  }
  out.append(
    cards,
    el('p', diff.explanation + (note ? ' ' + note : ''), { class: 'comparison-note' }),
  );
}
export function renderEvaluations(report) {
  set('eval-summary', `${report.passed} of ${report.total} checks passed`);
  $('eval-report').dataset.result = report.failed ? 'fail' : 'pass';
  set(
    'eval-scope',
    `Ran in ${report.elapsedMs} ms at ${report.observedAt.slice(11, 19)} UTC with policy ${report.policyVersion}.`,
  );
  const body = $('eval-rows');
  body.replaceChildren();
  for (const row of report.checks) {
    const tr = el('tr');
    tr.append(
      el('td', row.name),
      el('td', String(row.expected)),
      el('td', String(row.actual)),
      el('td', row.pass ? 'Pass' : 'Fail', { class: row.pass ? 'result-pass' : 'result-fail' }),
    );
    body.append(tr);
  }
}
export function renderHistory(rows) {
  const root = $('history-list');
  root.replaceChildren();
  for (const r of rows.slice(0, 6)) {
    const button = el('button', null, {
      type: 'button',
      class: 'history-row',
      'data-run-id': r.id,
    });
    button.append(
      el('b', r.summary || r.request?.changeRequest.summary || 'Review'),
      el('small', r.status + ' · ' + r.id.slice(0, 8)),
    );
    root.append(button);
  }
  if (!rows.length) root.append(el('p', 'No saved reviews yet.', { class: 'muted' }));
}
