import { POLICY_VERSION, requireThat, snapshot, sqlType } from './contract.js';
import { evidenceFreshness } from './evidence.js';
const ints = ['TINYINT', 'SMALLINT', 'INT', 'BIGINT'];
const normalize = (x) =>
  sqlType(x)
    .replace(/^INTEGER$/, 'INT')
    .replace(/^NUMBER/, 'DECIMAL')
    .replace(/^NUMERIC/, 'DECIMAL');
function narrowing(from, to) {
  const a = normalize(from),
    b = normalize(to);
  if (a === b) return false;
  if (ints.includes(a) && ints.includes(b)) return ints.indexOf(b) < ints.indexOf(a);
  const parse = (x) => x.match(/^(DECIMAL|VARCHAR|CHAR)\((\d+)(?:,(\d+))?\)$/);
  const p = parse(a),
    q = parse(b);
  if (p && q && p[1] === q[1]) {
    if (p[1] === 'DECIMAL')
      return (
        Number(q[3] || 0) < Number(p[3] || 0) ||
        Number(q[2]) - Number(q[3] || 0) < Number(p[2]) - Number(p[3] || 0)
      );
    return Number(q[2]) < Number(p[2]);
  }
  // Unsupported conversions are never inferred lossless from a broad type family.
  return true;
}
/**
 * Unquoted identifiers resolve case-insensitively on mainstream warehouses, so ORDER_ID
 * and order_id name the same column. The lookup returns the field, undefined when no
 * field matches, or null when two observed fields differ only by case (ambiguous).
 */
export function fieldIndex(fields) {
  const index = new Map();
  for (const f of fields) {
    const key = f.name.toUpperCase();
    index.set(key, index.has(key) ? null : f);
  }
  return (name) => index.get(name.toUpperCase());
}
const taken = (name, field) =>
  field && field.name !== name
    ? `${name} matches existing field ${field.name}`
    : `${name} already exists`;
export function assessCompatibility(request, schema) {
  const reasons = [];
  const lookup = fieldIndex(schema.data.fields);
  const add = (code, level, detail) =>
    reasons.push({ code, level, detail, evidence: [schema.digest] });
  for (const c of request.changeRequest.changes) {
    const field = lookup(c.field);
    if (c.kind === 'add') {
      if (field !== undefined) add('FIELD_EXISTS', 'block', taken(c.field, field));
      else if (c.required)
        add(
          'REQUIRED_WITHOUT_BACKFILL',
          'block',
          `${c.field} requires a separately validated backfill`,
        );
      else
        add('ADDITIVE_CHANGE', 'low', `Optional ${c.field} does not remove an existing contract`);
    } else if (field === undefined) {
      add('SCHEMA_MISMATCH', 'block', `${c.field} was not found in the observed schema`);
    } else if (field === null) {
      add('SCHEMA_MISMATCH', 'block', `${c.field} matches more than one observed field`);
    } else if (c.kind === 'drop')
      add(
        'DESTRUCTIVE_CHANGE',
        'block',
        `Dropping ${c.field} is outside automatic review clearance`,
      );
    else if (c.kind === 'rename') {
      const existing = lookup(c.to);
      if (existing !== undefined) add('FIELD_EXISTS', 'block', taken(c.to, existing));
      else {
        add(
          'RENAME_CONTRACT',
          'review',
          `${c.field} → ${c.to} requires an additive compatibility window`,
        );
        // A declared type for the new name is a type change too, judged like type_change.
        if (Object.hasOwn(c, 'type') && normalize(c.type) !== normalize(field.type)) {
          if (narrowing(field.type, c.type))
            add(
              'NARROWING_TYPE',
              'block',
              `${c.to} would change ${field.type} → ${c.type}, which is narrowing or not proven lossless`,
            );
          else
            add(
              'TYPE_WIDENING',
              'review',
              `${c.to} would change ${field.type} → ${c.type}; downstream validation is still required`,
            );
        }
      }
    } else if (c.kind === 'type_change') {
      if (normalize(c.from) !== normalize(field.type))
        add('SCHEMA_MISMATCH', 'block', `${c.field} does not have the declared source type`);
      else if (narrowing(c.from, c.to))
        add('NARROWING_TYPE', 'block', `${c.from} → ${c.to} is narrowing or not proven lossless`);
      else
        add('TYPE_WIDENING', 'review', `${c.from} → ${c.to} still requires downstream validation`);
    } else if (c.kind === 'nullable') {
      if (c.to === false && field.nullable)
        add(
          'NULLABILITY_TIGHTENING',
          'block',
          `${c.field} needs validated null cleanup before tightening`,
        );
      else
        add(
          'NULLABILITY_REVIEW',
          'review',
          `Consumers must tolerate the proposed nullability for ${c.field}`,
        );
    }
  }
  return {
    policyVersion: POLICY_VERSION,
    reasons,
    hasBlockingChange: reasons.some((r) => r.level === 'block'),
    needsReview: reasons.some((r) => r.level === 'review'),
  };
}
export function evaluatePolicy(request, recipe, outputs, now = Date.now()) {
  const compatibility = outputs.compatibility;
  requireThat(compatibility, 'MISSING_EVIDENCE');
  const required = [
    'resolve',
    'schema',
    'lineage',
    'usage',
    'ownership',
    ...(recipe.policy === 'strict' ? ['paths'] : []),
  ];
  const gaps = [];
  const evidenceIds = [];
  for (const kind of required) {
    const e = outputs[kind];
    if (!e) {
      gaps.push({ kind, code: 'MISSING_EVIDENCE', detail: `${kind} was not obtained` });
      continue;
    }
    evidenceIds.push(e.digest);
    if (e.coverage !== 'complete')
      gaps.push({ kind, code: 'INCOMPLETE_EVIDENCE', detail: `${kind} coverage is ${e.coverage}` });
    const freshness = evidenceFreshness(e, now, recipe.policy === 'strict' ? 3600000 : 86400000);
    if (freshness !== 'current')
      gaps.push({ kind, code: 'STALE_EVIDENCE', detail: `${kind} observation is ${freshness}` });
  }
  const lineage = outputs.lineage?.data,
    ownership = outputs.ownership?.data;
  if (ownership && lineage) {
    const known = new Set(ownership.owners.map((o) => o.urn));
    const missing = lineage.nodes.filter((n) => !known.has(n.urn));
    if (missing.length || ownership.unassigned.length)
      gaps.push({
        kind: 'ownership',
        code: 'MISSING_OWNER',
        detail: 'At least one returned asset has no accountable owner',
      });
  }
  const evidenceReady = gaps.length === 0;
  const decision = compatibility.hasBlockingChange
    ? 'block'
    : !evidenceReady
      ? 'needs-evidence'
      : compatibility.needsReview || recipe.policy === 'strict'
        ? 'review-required'
        : 'proceed-with-checks';
  return {
    version: POLICY_VERSION,
    decision,
    evidenceReady,
    riskLevel: compatibility.hasBlockingChange
      ? 'blocked'
      : compatibility.needsReview
        ? 'high'
        : 'low',
    reasons: snapshot(compatibility.reasons),
    gaps,
    evidenceIds,
    consumers: lineage ? lineage.nodes.filter((n) => n.urn !== request.datasetUrn).length : 0,
    headline: {
      block: 'Change blocked by compatibility rules',
      'needs-evidence': 'More evidence is required',
      'review-required': 'Ready for a human review',
      'proceed-with-checks': 'Additive change; validation still required',
    }[decision],
    executionAuthorized: false,
    method: 'Deterministic rules, not a probability or model prediction',
  };
}
