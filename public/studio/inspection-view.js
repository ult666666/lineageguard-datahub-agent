import { inspectReview, inspectReviewBytes, MAX_REVIEW_BYTES } from './core/inspection.js';
import { StudioError } from './core/contract.js';
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};

/** An isolated inspection surface. It never mutates live runs or checkpoint storage. */
export function mountInspector({ current, busy }) {
  const get = (id) => document.getElementById(id);
  const fileInput = get('inspection-file'),
    result = get('inspection-result'),
    download = get('inspection-download'),
    badge = get('inspection-badge');
  let generation = 0,
    report = null;
  function reset(state, message) {
    report = null;
    download.disabled = true;
    result.dataset.state = state;
    result.replaceChildren(node('p', message, 'muted'));
    result.setAttribute('aria-busy', String(state === 'checking'));
    badge.textContent = {
      empty: 'NO INPUT',
      checking: 'CHECKING LOCALLY',
      error: 'REFUSED',
      pass: 'CONSISTENCY CHECKED',
    }[state];
  }
  function show(value) {
    report = value;
    result.dataset.state = 'pass';
    result.setAttribute('aria-busy', 'false');
    badge.textContent = 'CONSISTENCY CHECKED';
    download.disabled = false;
    const heading = node('h4', 'Internally consistent — not authenticated');
    const limits = node(
      'p',
      'No tools or source systems were contacted. A self-consistent file can still contain invented evidence; this is not approval or permission to execute.',
      'field-help',
    );
    const facts = node('dl', undefined, 'inspection-facts');
    for (const [label, detail] of [
      ['Run state', value.runStatus + ' · generation ' + value.generation],
      ['Inspected at', value.inspectedAt],
      ['Recorded decision', value.recordedDecision || 'No completed review'],
      [
        'Current check · embedded evidence only',
        value.currentDecision || 'Not evaluated for an incomplete run',
      ],
      [
        'Evidence readiness now',
        value.evidenceReadyNow
          ? 'Current within supplied evidence scope'
          : 'Not ready; inspect evidence below',
      ],
      ['Source authentication', 'Not authenticated'],
      ['Tools called / execution authorized', '0 / false'],
      ['Run identifier', value.runId],
      ['File SHA-256', value.fileSha256 || 'Current in-memory review; no file selected'],
    ])
      facts.append(node('dt', label), node('dd', detail));
    const grid = node('div', undefined, 'inspection-grid'),
      list = node('ul', undefined, 'inspection-checks');
    for (const check of value.checks) list.append(node('li', check.detail));
    const table = node('table'),
      header = node('tr');
    for (const label of ['Evidence', 'Coverage', 'Freshness now']) {
      const cell = node('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const head = node('thead');
    head.append(header);
    const body = node('tbody');
    for (const item of value.evidence) {
      const row = node('tr');
      for (const text of [item.kind, item.coverage, item.freshness]) row.append(node('td', text));
      body.append(row);
    }
    table.append(head, body);
    const wrap = node('div', undefined, 'table-scroll');
    wrap.append(table);
    const evidence = node('section');
    evidence.append(node('h4', 'Evidence at inspection time'), wrap);
    grid.append(list, evidence);
    result.replaceChildren(heading, limits, facts, grid);
  }
  async function inspect(load) {
    const ticket = ++generation;
    reset('checking', 'Reading and verifying locally. Nothing is uploaded or restored.');
    try {
      const value = await load();
      if (ticket === generation) show(value);
    } catch (error) {
      if (ticket !== generation) return;
      const code =
        error instanceof StudioError && /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'INSPECTION_FAILED';
      reset(
        'error',
        `Inspection refused (${code}). No file was uploaded, imported, resumed or executed. The current review is unchanged.`,
      );
    }
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      generation++;
      reset('empty', 'Select an exported run JSON, or inspect the current review.');
      return;
    }
    void inspect(async () => {
      if (file.size < 1 || file.size > MAX_REVIEW_BYTES)
        throw new StudioError('DATA_LIMIT', 'File limit');
      return inspectReviewBytes(new Uint8Array(await file.arrayBuffer()));
    });
  });
  get('inspect-current').addEventListener('click', () => {
    const run = current();
    if (!run || busy()) return;
    fileInput.value = '';
    void inspect(() => inspectReview(run));
  });
  get('inspection-clear').addEventListener('click', () => {
    generation++;
    fileInput.value = '';
    reset('empty', 'Inspection cleared. Your current run and saved checkpoints were not changed.');
  });
  download.addEventListener('click', () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      a = node('a');
    a.href = url;
    a.download = 'lineageguard-inspection.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  reset(
    'empty',
    'Select an exported run JSON, or inspect the current review. No network, database write or resume will occur.',
  );
}
