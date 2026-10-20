export const STUDIO_VERSION = '2.0.0';
export const POLICY_VERSION = '2.0.0';
export class StudioError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'StudioError';
    this.code = code;
  }
}
export function requireThat(ok, code, message = code) {
  if (!ok) throw new StudioError(code, message);
}

/** Take a bounded JSON-data snapshot without invoking accessors or toJSON. */
export function snapshot(value, { maxDepth = 24, maxNodes = 60000, maxBytes = 2_000_000 } = {}) {
  let count = 0;
  const seen = new Set();
  function copy(x, depth) {
    requireThat(
      ++count <= maxNodes && depth <= maxDepth,
      'DATA_LIMIT',
      'Data exceeds structural limits',
    );
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'number') {
      requireThat(Number.isFinite(x), 'INVALID_NUMBER', 'Numbers must be finite');
      return Object.is(x, -0) ? 0 : x;
    }
    if (typeof x === 'string') {
      requireThat(x.length <= maxBytes, 'DATA_LIMIT');
      return x;
    }
    requireThat(
      typeof x === 'object' && !seen.has(x),
      'INVALID_DATA',
      'Only acyclic JSON data is supported',
    );
    requireThat(
      Array.isArray(x) || [null, Object.prototype].includes(Object.getPrototypeOf(x)),
      'INVALID_DATA',
      'Plain records are required',
    );
    seen.add(x);
    const keys = Reflect.ownKeys(x);
    const out = Array.isArray(x) ? [] : {};
    requireThat(
      keys.every(
        (k) => typeof k === 'string' && !['__proto__', 'prototype', 'constructor'].includes(k),
      ),
      'INVALID_DATA',
      'Unsupported record key',
    );
    if (Array.isArray(x))
      requireThat(
        keys.length === x.length + 1 && x.length <= maxNodes,
        'INVALID_DATA',
        'Sparse or extended arrays are unsupported',
      );
    for (const k of keys) {
      if (Array.isArray(x) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(x, k);
      requireThat(
        d && d.enumerable && Object.hasOwn(d, 'value'),
        'INVALID_DATA',
        'Accessors and hidden fields are unsupported',
      );
      out[k] = copy(d.value, depth + 1);
    }
    seen.delete(x);
    return out;
  }
  const result = copy(value, 0);
  requireThat(
    new TextEncoder().encode(JSON.stringify(result)).length <= maxBytes,
    'DATA_LIMIT',
    'Data exceeds byte limit',
  );
  return result;
}
export function canonical(value) {
  const x = snapshot(value);
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return JSON.stringify(sort(x));
}
export async function hash(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function exact(record, required, optional = []) {
  requireThat(
    record !== null && typeof record === 'object' && !Array.isArray(record),
    'INVALID_RECORD',
    'Expected a record',
  );
  requireThat(
    required.every((k) => Object.hasOwn(record, k)) &&
      Object.keys(record).every((k) => [...required, ...optional].includes(k)),
    'INVALID_FIELDS',
    'Missing or unsupported fields',
  );
}
export function integer(x, min, max, label) {
  requireThat(
    Number.isInteger(x) && x >= min && x <= max,
    'INVALID_NUMBER',
    `${label} must be an integer from ${min} to ${max}`,
  );
  return x;
}
export function text(x, max, label) {
  requireThat(
    typeof x === 'string' && x.length > 0 && x.length <= max,
    'INVALID_TEXT',
    `${label} is missing or too long`,
  );
  return x;
}
export function identifier(x) {
  requireThat(
    typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(x),
    'INVALID_IDENTIFIER',
    'Use a simple unquoted identifier',
  );
  return x;
}
export function sqlType(x) {
  requireThat(
    typeof x === 'string' &&
      x.length <= 80 &&
      /^(?:TINYINT|SMALLINT|INT|INTEGER|BIGINT|FLOAT|DOUBLE|DECIMAL|NUMBER|NUMERIC|CHAR|VARCHAR|STRING|TEXT|DATE|DATETIME|TIMESTAMP|TIME|BOOL|BOOLEAN)(?:\([1-9][0-9]{0,5}(?:,\s*[0-9]{1,3})?\))?$/i.test(
        x,
      ),
    'INVALID_TYPE',
    'Unsupported scalar SQL type',
  );
  const normalized = x.toUpperCase().replaceAll(' ', '');
  const params = normalized.match(/^([A-Z]+)\((\d+)(?:,(\d+))?\)$/);
  if (params) {
    const [, base, p, scale] = params;
    requireThat(
      ['DECIMAL', 'NUMBER', 'NUMERIC', 'CHAR', 'VARCHAR', 'TIMESTAMP'].includes(base),
      'INVALID_TYPE',
      'Parameters are unsupported for this scalar type',
    );
    if (['DECIMAL', 'NUMBER', 'NUMERIC'].includes(base))
      requireThat(
        Number(p) <= 38 && Number(scale || 0) <= Number(p),
        'INVALID_TYPE',
        'Decimal precision or scale is unsupported',
      );
    else
      requireThat(
        scale === undefined && (base !== 'TIMESTAMP' || Number(p) <= 9),
        'INVALID_TYPE',
        'Invalid scalar type parameters',
      );
  }
  return normalized;
}
export function validateRequest(raw) {
  const r = snapshot(raw, { maxBytes: 40000, maxNodes: 1500, maxDepth: 8 });
  exact(r, ['datasetUrn', 'changeRequest']);
  requireThat(
    typeof r.datasetUrn === 'string' &&
      r.datasetUrn.startsWith('urn:li:dataset:') &&
      r.datasetUrn.length <= 2048 &&
      !/[\x00-\x20\x7f]/.test(r.datasetUrn),
    'INVALID_TARGET',
    'Target must be a bounded dataset URN',
  );
  exact(r.changeRequest, ['summary', 'changes']);
  text(r.changeRequest.summary, 500, 'Summary');
  requireThat(
    Array.isArray(r.changeRequest.changes) &&
      r.changeRequest.changes.length >= 1 &&
      r.changeRequest.changes.length <= 20,
    'INVALID_CHANGES',
    'Provide 1–20 changes',
  );
  for (const c of r.changeRequest.changes) {
    exact(c, ['kind', 'field'], ['from', 'to', 'type', 'required']);
    identifier(c.field);
    requireThat(
      ['add', 'drop', 'rename', 'type_change', 'nullable'].includes(c.kind),
      'INVALID_CHANGE',
      'Unsupported change kind',
    );
    if (Object.hasOwn(c, 'required'))
      requireThat(typeof c.required === 'boolean', 'INVALID_CHANGE', 'required must be boolean');
    if (Object.hasOwn(c, 'type')) c.type = sqlType(c.type);
    if (c.kind === 'rename') identifier(c.to);
    if (c.kind === 'type_change') {
      c.from = sqlType(c.from);
      c.to = sqlType(c.to);
    }
    if (c.kind === 'nullable')
      requireThat(typeof c.to === 'boolean', 'INVALID_CHANGE', 'Nullable value must be boolean');
    if (c.kind === 'add') {
      requireThat(Object.hasOwn(c, 'type'), 'INVALID_CHANGE', 'New field type is required');
    }
  }
  const touched = new Set();
  for (const change of r.changeRequest.changes) {
    const names = [change.field, ...(change.kind === 'rename' ? [change.to] : [])];
    for (const name of names) {
      const normalized = name.toUpperCase();
      requireThat(
        !touched.has(normalized),
        'CONFLICTING_CHANGE',
        'Duplicate or conflicting field operations must be reviewed in separate requests',
      );
      touched.add(normalized);
    }
  }
  return r;
}
export function publicError(error) {
  const code =
    typeof error?.code === 'string' && /^[A-Z_]{2,45}$/.test(error.code)
      ? error.code
      : 'STEP_FAILED';
  return {
    code,
    message:
      {
        TIMEOUT: 'Step exceeded its deadline',
        CANCELLED: 'Run cancelled',
        CALL_BUDGET: 'Read-call budget exhausted',
        TOOL_UNAVAILABLE: 'Synthetic evidence source unavailable',
        CHECKPOINT_FAILED: 'Checkpoint could not be stored',
        INVALID_EVIDENCE: 'Evidence did not match its contract',
      }[code] || 'The step could not produce validated evidence',
  };
}
