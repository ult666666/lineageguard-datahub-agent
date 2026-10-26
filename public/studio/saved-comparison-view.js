import { compareReviewBytes } from './core/review-comparison.js';
import { MAX_REVIEW_BYTES } from './core/inspection.js';
import { StudioError } from './core/contract.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const facts = (rows) => {
  const list = node('dl', undefined, 'inspection-facts');
  for (const [label, value] of rows) list.append(node('dt', label), node('dd', value));
  return list;
};

/** Supplied files only. No live-run, checkpoint, adapter or transport dependency. */
export function mountSavedComparison() {
  const get = (id) => document.getElementById(id);
  const inputs = { left: get('saved-left-file'), right: get('saved-right-file') };
  const compare = get('saved-compare'),
    download = get('saved-download');
  const result = get('saved-result'),
    status = get('saved-status'),
    badge = get('saved-badge');
  let generation = 0,
    active = false,
    report = null;
  function controls() {
    compare.disabled = active || !inputs.left.files?.[0] || !inputs.right.files?.[0];
  }
  function reset(state, message) {
    report = null;
    download.disabled = true;
    result.dataset.state = state;
    result.setAttribute('aria-busy', String(state === 'checking'));
    result.replaceChildren(node('p', message, 'muted'));
    status.textContent = message;
    badge.textContent = {
      empty: 'NO COMPARISON',
      checking: 'CHECKING LOCALLY',
      error: 'REFUSED',
      pass: 'CONSISTENCY CHECKED',
    }[state];
  }
  function show(value) {
    const diff = value.comparison;
    const grid = node('div', undefined, 'inspection-grid');
    for (const side of ['left', 'right']) {
      const recorded = diff[side],
        inspected = value.inspections[side];
      const section = node('section', undefined, 'saved-side');
      section.append(
        node('h4', side === 'left' ? 'Left saved review' : 'Right saved review'),
        facts([
          ['Request summary', recorded.summary],
          ['Run identifier', recorded.id],
          ['Recorded decision', recorded.decision],
          ['Recorded risk / evidence ready', recorded.riskLevel + ' / ' + recorded.evidenceReady],
          ['Recorded calls', recorded.calls],
          ['Recorded policy', recorded.policy],
          ['Current check · embedded evidence only', inspected.currentDecision],
          [
            'Evidence ready at inspection time',
            inspected.evidenceReadyNow ? 'Yes, within supplied scope' : 'No',
          ],
          ['File SHA-256', inspected.fileSha256],
        ]),
      );
      grid.append(section);
    }
    const heading = node('h4', 'Internally consistent — not authenticated');
    const scope = node('p', value.scope, 'field-help');
    const comparability = facts([
      ['Same request', diff.sameRequest ? 'Yes' : 'No · alternative plans'],
      ['Same recipe', diff.sameRecipe ? 'Yes' : 'No'],
      ['Same source revision', diff.sameSourceRevision ? 'Yes' : 'No'],
      ['Inspected at · both files', value.inspectedAt],
      ['Added gaps · right versus left', diff.addedGaps.join(', ') || 'None'],
      ['Removed gaps · right versus left', diff.removedGaps.join(', ') || 'None'],
      ['New tool calls / execution authorized', '0 / false'],
    ]);
    result.replaceChildren(
      heading,
      scope,
      node('p', diff.explanation, 'field-help'),
      comparability,
      grid,
    );
    result.dataset.state = 'pass';
    result.setAttribute('aria-busy', 'false');
    status.textContent =
      'Both exports checked locally. Comparison ready; source truth and approval are not authenticated.';
    badge.textContent = 'CONSISTENCY CHECKED';
    report = value;
    download.disabled = false;
  }
  for (const input of Object.values(inputs))
    input.addEventListener('change', () => {
      generation++;
      reset('empty', 'Selection changed. Compare the selected exports to produce a new result.');
      controls();
    });
  get('saved-clear').addEventListener('click', () => {
    generation++;
    inputs.left.value = '';
    inputs.right.value = '';
    reset('empty', 'Saved comparison cleared. Current review and saved checkpoints are unchanged.');
    controls();
  });
  compare.addEventListener('click', async () => {
    if (active) return;
    const files = { left: inputs.left.files?.[0], right: inputs.right.files?.[0] };
    if (!files.left || !files.right) return;
    active = true;
    const ticket = ++generation;
    let reading = 'left';
    controls();
    reset(
      'checking',
      'Reading and checking both exports locally. Nothing is uploaded or imported.',
    );
    try {
      // Refuse either size before reading any file. Only one sequence can be active.
      for (const side of ['left', 'right'])
        if (files[side].size < 1 || files[side].size > MAX_REVIEW_BYTES) {
          const error = new StudioError('DATA_LIMIT', 'File limit');
          error.side = side;
          throw error;
        }
      const left = new Uint8Array(await files.left.arrayBuffer());
      if (ticket !== generation) return;
      reading = 'right';
      const right = new Uint8Array(await files.right.arrayBuffer());
      if (ticket !== generation) return;
      const value = await compareReviewBytes(left, right);
      if (ticket !== generation) return;
      show(value);
    } catch (error) {
      if (ticket !== generation) return;
      const code =
        error instanceof StudioError && /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'COMPARISON_FAILED';
      const side = error.side === 'left' || error.side === 'right' ? error.side : reading;
      reset(
        'error',
        `Comparison refused (${code}, ${side} export). No partial comparison is available. Current review and saved checkpoints are unchanged.`,
      );
    } finally {
      active = false;
      controls();
    }
  });
  download.addEventListener('click', () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }),
    );
    const anchor = node('a');
    anchor.href = url;
    anchor.download = 'lineageguard-saved-comparison.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  reset(
    'empty',
    'Select two exported review JSON files, then compare. No current review is required.',
  );
  controls();
}
