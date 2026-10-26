import { inspectReviewBytes, MAX_REVIEW_BYTES } from './inspection.js';
import { compareRuns } from './comparison.js';
import { StudioError, requireThat } from './contract.js';

function failure(error, side) {
  const result = new StudioError(
    error instanceof StudioError ? error.code : 'COMPARISON_FAILED',
    `The ${side} export could not be validated for comparison`,
    { cause: error },
  );
  result.side = side;
  return result;
}
function ownBytes(value, side) {
  try {
    requireThat(value instanceof Uint8Array, 'INVALID_INPUT');
    requireThat(value.byteLength > 0 && value.byteLength <= MAX_REVIEW_BYTES, 'DATA_LIMIT');
    // Buffer.slice() shares memory. Construct plain owned bytes for both inputs
    // before the first await so callers cannot change the later comparison.
    return new Uint8Array(value);
  } catch (error) {
    throw failure(error, side);
  }
}

/** Supplied data only: no adapter, execution, import, store or network. */
export async function compareReviewBytes(left, right, { now = Date.now() } = {}) {
  const bytes = { left: ownBytes(left, 'left'), right: ownBytes(right, 'right') };
  const inspections = {};
  for (const side of ['left', 'right']) {
    try {
      inspections[side] = await inspectReviewBytes(bytes[side], { now });
    } catch (error) {
      throw failure(error, side);
    }
  }
  for (const side of ['left', 'right'])
    if (!inspections[side].completed)
      throw failure(new StudioError('COMPARISON_NOT_READY', 'Complete both reviews first'), side);
  // Parse only these already-inspected owned bytes. Comparison keeps its existing
  // recorded-decision semantics; current freshness stays in the inspections.
  const decode = (value) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
  return {
    schema: 'lineageguard.review-comparison/1',
    inspectedAt: inspections.left.inspectedAt,
    inspections,
    comparison: compareRuns(decode(bytes.left), decode(bytes.right)),
    toolCalls: 0,
    sourceAuthenticated: false,
    executionAuthorized: false,
    resumableImport: false,
    scope:
      'Comparison of two internally consistent supplied exports and their recorded decisions. The inspections separately assess embedded evidence at the displayed time. No source was reread; consistency does not authenticate source truth, authors or approval. No review was imported, resumed or executed.',
  };
}
