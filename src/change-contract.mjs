// Conservative contract for the existing generated-SQL review flow.
// This is deliberately not a general SQL parser or production migration validator.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const KINDS = new Set(['add', 'drop', 'rename', 'type_change', 'nullable']);
const TYPE = /^(?:TINYINT|SMALLINT|INT|INTEGER|BIGINT|FLOAT|DOUBLE(?: PRECISION)?|DECIMAL|NUMBER|NUMERIC|CHAR|VARCHAR|STRING|TEXT|DATE|DATETIME|TIMESTAMP|TIME|BOOL|BOOLEAN)(?:\([1-9][0-9]{0,5}(?:,\s*[0-9]{1,3})?\))?$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || /[\r\n]/.test(value)) {
    throw new TypeError(`${label} must be a simple, unquoted SQL identifier.`);
  }
}
function sqlType(value, label) {
  if (typeof value !== 'string' || value.length > 80 || /[\r\n]/.test(value) || !TYPE.test(value)) {
    throw new TypeError(`${label} must be a supported scalar SQL type, without statements or comments.`);
  }
}

export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 100) {
    throw new TypeError('changeRequest.changes must contain between 1 and 100 schema changes.');
  }
  const checked = [];
  for (const source of changes) {
    if (!object(source)) throw new TypeError('Each change must be an object.');
    // Read every SQL-relevant value once, then validate/use only this snapshot.
    const change = Object.create(null);
    for (const key of ['kind', 'field', 'from', 'to', 'type', 'required']) {
      if (key in source) change[key] = source[key];
    }
    if (typeof change.kind !== 'string' || !KINDS.has(change.kind)) {
      throw new TypeError('change.kind must be add, drop, rename, type_change, or nullable.');
    }
    identifier(change.field, 'change.field');
    if ('required' in change && typeof change.required !== 'boolean') {
      throw new TypeError('change.required must be a boolean when supplied.');
    }
    if ('type' in change) sqlType(change.type, 'change.type');
    if (change.kind === 'rename') identifier(change.to, 'change.to');
    if (change.kind === 'type_change') {
      sqlType(change.from, 'change.from');
      sqlType(change.to, 'change.to');
    }
    if (change.kind === 'nullable' && typeof change.to !== 'boolean') {
      throw new TypeError('change.to must be a boolean for nullability changes.');
    }
    checked.push(change);
  }
  return checked;
}

export function validateRequest(datasetUrn, changeRequest) {
  if (typeof datasetUrn !== 'string' || !datasetUrn.startsWith('urn:') ||
      datasetUrn.length <= 4 || datasetUrn.length > 2048 || /[\x00-\x20\x7f]/.test(datasetUrn)) {
    throw new TypeError('datasetUrn must be a bounded URN string without whitespace.');
  }
  if (!object(changeRequest)) throw new TypeError('changeRequest must be an object.');
  const checked = Object.create(null);
  if ('summary' in changeRequest) {
    checked.summary = changeRequest.summary;
    if (typeof checked.summary !== 'string' || checked.summary.length > 2000) {
      throw new TypeError('changeRequest.summary must be a string of at most 2000 characters.');
    }
  }
  checked.changes = validateChanges(changeRequest.changes);
  return checked;
}

export function validateSqlDataset(dataset) {
  if (!object(dataset)) throw new TypeError('dataset.name must be a qualified SQL identifier.');
  const original = dataset;
  dataset = Object.assign(Object.create(null), original);
  if (!Object.hasOwn(dataset, 'name')) dataset.name = original.name;
  if (typeof dataset.name !== 'string' || dataset.name.length > 515) {
    throw new TypeError('dataset.name must be a qualified SQL identifier.');
  }
  const parts = dataset.name.split('.');
  if (parts.length > 4) throw new TypeError('dataset.name has too many qualifier segments.');
  for (const part of parts) identifier(part, 'dataset.name');
  return dataset;
}
