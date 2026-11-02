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
    badge.textContent = { empty: 'No file', checking: 'Checking', error: 'Refused' }[state];
    badge.dataset.tone = { checking: 'info', error: 'bad' }[state] || '';
  }
  function show(value) {
    report = value;
    result.dataset.state = 'pass';
    result.setAttribute('aria-busy', 'false');
    badge.textContent = 'Consistent';
    badge.dataset.tone = 'good';
    download.disabled = false;
    const heading = node('h4', 'Internally consistent, not authenticated');
    const limits = node(
      'p',
      'The decision and drafts match the evidence in the file. No source was contacted, and a consistent file can still contain invented evidence.',
      'field-help',
    );
    const facts = node('dl', undefined, 'inspection-facts');
    for (const [label, detail] of [
      ['Run state', value.runStatus + ' · generation ' + value.generation],
      ['Inspected at', value.inspectedAt],
      ['Recorded decision', value.recordedDecision || 'No completed review'],
      [
        'Decision now, on the saved evidence',
        value.currentDecision || 'Not evaluated for an incomplete run',
      ],
      [
        'Evidence ready now',
        value.evidenceReadyNow ? 'Yes, within the saved evidence' : 'No; see the evidence below',
      ],
      ['Run ID', value.runId],
      ['File SHA-256', value.fileSha256 || 'Current review in memory; no file selected'],
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
    reset('checking', 'Checking the file in this browser…');
    try {
      const value = await load();
      if (ticket === generation) show(value);
    } catch (error) {
      if (ticket !== generation) return;
      const code =
        error instanceof StudioError && /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'INSPECTION_FAILED';
      reset('error', `Inspection refused: ${code}. The current review is unchanged.`);
    }
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      generation++;
      reset('empty', 'Choose a run JSON file, or inspect the current review.');
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
    reset('empty', 'Cleared. The current review and saved runs are unchanged.');
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
  reset('empty', 'Choose a run JSON file, or inspect the current review.');
}
