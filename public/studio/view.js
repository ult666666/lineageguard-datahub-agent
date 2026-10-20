import { reviewIsCurrent } from './core/runtime.js';
import { REGISTRY, compileRecipe } from './core/recipe.js';
import { evidenceFreshness } from './core/evidence.js';
const $ = (id) => document.getElementById(id);
const set = (id, value) => {
  const node = $(id);
  if (node) node.textContent = String(value);
};
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
    const group = svg('g', {
      class: 'graph-node',
      'data-node': id,
      'data-step-status': status,
      'data-kind': item.kind,
      transform: `translate(${x},${y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${item.label}: ${status}. Inspect stage output`,
    });
    group.append(
      svg('rect', { width: 177, height: 70, rx: 9 }),
      svg('text', { x: 13, y: 18, class: 'node-kind' }, item.kind.toUpperCase()),
      svg('text', { x: 13, y: 38, class: 'node-title' }, item.label),
      svg('circle', { cx: 14, cy: 55, r: 2.5, class: 'state-dot' }),
      svg(
        'text',
        { x: 22, y: 58, class: 'node-meta' },
        step?.reused
          ? 'REUSED · VERIFIED'
          : status.toUpperCase() + (step?.endedAt ? ` · ${step.durationMs} ms` : ''),
      ),
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
  status.textContent = phase === 'created' ? 'Ready' : phase;
  set(
    'run-identity',
    run ? `${run.id.slice(0, 8)} · generation ${run.generation}` : 'No run created',
  );
  set('calls-value', `${run?.callsUsed || 0} / ${recipe.budget.maxCalls}`);
  set('event-count', `${run?.events.length || 0} EVENTS`);
  const p = run?.status === 'completed' ? run.result?.policy : null;
  const fallback = {
    created: [
      'Not evaluated',
      'Run a review to receive a decision. Missing data is never interpreted as low risk.',
    ],
    running: [
      'Review in progress',
      'Actual steps are running. No final decision has been published.',
    ],
    paused: [
      'Paused before policy',
      'The checkpoint preserves completed evidence. Resume to evaluate policy and generate the review.',
    ],
    failed: [
      'Review incomplete',
      'An execution boundary stopped this run. Inspect the trace, correct the source condition and resume.',
    ],
    cancelled: [
      'Cancelled · no decision',
      'No new steps will be dispatched. Completed, verified evidence remains in the checkpoint.',
    ],
  };
  set(
    'decision-title',
    p
      ? reviewIsCurrent(run)
        ? p.headline
        : 'Historical review · refresh evidence'
      : (fallback[phase] || fallback.created)[0],
  );
  set(
    'decision-description',
    p
      ? p.method + '. This review does not authorize execution.'
      : (fallback[phase] || fallback.created)[1],
  );
  set('risk-value', p ? p.riskLevel : '—');
  set(
    'readiness-value',
    p
      ? !reviewIsCurrent(run)
        ? 'Stale · rerun'
        : p.evidenceReady
          ? 'Ready for review'
          : 'Needs evidence'
      : '—',
  );
  set('decision-symbol', p ? (p.decision === 'block' ? '×' : p.evidenceReady ? '✓' : '!') : '◇');
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
      el('p', 'Step states and output digests appear here as work actually completes.', {
        class: 'empty-copy',
      }),
    );
  set('artifact-sql', p ? run.result.artifacts.sql : 'No draft generated for the current input.');
  set(
    'artifact-markdown',
    p ? run.result.artifacts.markdown : 'No review generated for the current input.',
  );
  set(
    'review-status',
    run?.review
      ? `Local acknowledgement by ${run.review.reviewer}, bound to ${run.binding.slice(0, 12)}. No execution authorized.`
      : 'Only an evidence-ready, nonblocked review can be acknowledged.',
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
  if (!lineage) {
    graph.append(
      svg(
        'text',
        { x: 38, y: 80, class: 'lineage-empty' },
        'No validated lineage result received.',
      ),
    );
    set('lineage-coverage', 'NO EVIDENCE');
    set('lineage-note', 'No catalog result has been received.');
    return;
  }
  const data = lineage.data;
  set('lineage-coverage', lineage.coverage.toUpperCase());
  const root = data.nodes.find((n) => n.urn === run.request.datasetUrn),
    depth = new Map([[root.id, 0]]);
  for (let i = 0; i < data.nodes.length; i++)
    for (const edge of data.edges)
      if (depth.has(edge.from) && !depth.has(edge.to))
        depth.set(edge.to, Math.min(3, depth.get(edge.from) + 1));
  for (const n of data.nodes) if (!depth.has(n.id)) depth.set(n.id, 1);
  const maximum = Math.max(...depth.values()),
    positions = new Map();
  for (let level = 0; level <= maximum; level++) {
    const group = data.nodes.filter((n) => depth.get(n.id) === level);
    group.forEach((n, i) =>
      positions.set(n.id, {
        x: 28 + (level * 780) / Math.max(1, maximum),
        y: 185 - (group.length * 72 + (group.length - 1) * 14) / 2 + i * 86,
      }),
    );
  }
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
        class: 'lineage-node',
        transform: `translate(${p.x},${p.y})`,
      });
    group.append(
      svg('rect', { width: 202, height: 72, rx: 10 }),
      svg('text', { x: 14, y: 18, class: 'asset-type' }, n.type.toUpperCase()),
      svg('text', { x: 14, y: 38 }, n.name.length > 26 ? n.name.slice(0, 24) + '…' : n.name),
      svg('text', { x: 14, y: 57, class: 'asset-owner' }, n.owner || 'Owner not recorded'),
    );
    graph.append(group);
  }
  set(
    'lineage-note',
    `${data.nodes.length - 1} returned downstream assets / ${data.total} declared · ${lineage.coverage} coverage. Lines are supplied ${data.level}-level relationships. Inspect Paths separately for explicit column evidence.`,
  );
}
export function renderComparison(diff, left, right) {
  const out = $('comparison-result');
  out.replaceChildren();
  out.dataset.ready = 'true';
  const cards = el('div', null, { class: 'compare-cards' });
  for (const [label, run, side] of [
    ['A / CURRENT REVIEW', left, diff.left],
    ['B / ALTERNATIVE', right, diff.right],
  ]) {
    const panel = el('section', null, { class: 'panel' });
    panel.append(
      el('p', label, { class: 'eyebrow' }),
      el('h3', side.summary),
      el('div', side.decision.replaceAll('-', ' '), { class: 'compare-decision' }),
    );
    panel.append(
      el(
        'p',
        `Evidence ${side.evidenceReady ? 'ready' : 'not ready'} · ${side.calls} evidence calls · ${side.policy} policy`,
        { class: 'muted small' },
      ),
    );
    const details = el('details');
    details.append(
      el('summary', 'Exact request and binding'),
      el('pre', JSON.stringify({ request: run.request, binding: run.binding }, null, 2), {
        class: 'code-block',
      }),
    );
    panel.append(details);
    cards.append(panel);
  }
  out.append(
    cards,
    el(
      'div',
      diff.explanation +
        ' Neither result authorizes a migration. An additive alternative still requires a separately reviewed consumer cutover.',
      { class: 'comparison-note' },
    ),
  );
}
export function renderEvaluations(report) {
  set('eval-summary', `${report.passed} / ${report.total} checks passed`);
  $('eval-report').dataset.result = report.failed ? 'fail' : 'pass';
  set('eval-scope', `${report.scope} Executed ${report.observedAt}; ${report.elapsedMs} ms.`);
  const body = $('eval-rows');
  body.replaceChildren();
  for (const row of report.checks) {
    const tr = el('tr');
    tr.append(
      el('td', row.name),
      el('td', String(row.expected)),
      el('td', String(row.actual)),
      el('td', row.pass ? 'PASS' : 'FAIL', { class: row.pass ? 'result-pass' : 'result-fail' }),
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
  if (!rows.length) root.append(el('p', 'No saved reviews yet.', { class: 'small muted' }));
}
