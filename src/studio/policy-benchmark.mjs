import { createHash } from 'node:crypto';
import {
  POLICY_VERSION,
  StudioError,
  canonical,
  exact,
  requireThat,
  snapshot,
} from '../../public/studio/core/contract.js';
import { makeRecipe } from '../../public/studio/core/recipe.js';
import { createRun, executeRun } from '../../public/studio/core/runtime.js';
import {
  captureDbtManifest,
  listDbtTargets,
  parseDbtCatalog,
  parseDbtManifest,
} from '../../public/studio/core/dbt-manifest.js';
import { readDbtFixture } from './dbt-fixture.mjs';

export const CASES_FILE = new URL('../../evals/policy-cases.json', import.meta.url);
export const REPORT_FILE = new URL('../../evals/policy-report.json', import.meta.url);
export const OUTCOMES = [
  'block',
  'needs-evidence',
  'failed',
  'review-required',
  'proceed-with-checks',
];
// How firmly each outcome stops a change. A run that fails on invalid evidence stops it
// like needs-evidence does: nothing is cleared and the source must be fixed first.
const STRICTNESS = {
  block: 3,
  'needs-evidence': 2,
  failed: 2,
  'review-required': 1,
  'proceed-with-checks': 0,
};
const GROUPS = ['compatibility', 'batch', 'evidence', 'strict', 'contract', 'adversarial', 'dbt'];
const KINDS = ['resolve', 'schema', 'lineage', 'usage', 'ownership', 'paths'];
const REASONS = [
  'ADDITIVE_CHANGE',
  'REQUIRED_WITHOUT_BACKFILL',
  'FIELD_EXISTS',
  'SCHEMA_MISMATCH',
  'DESTRUCTIVE_CHANGE',
  'RENAME_CONTRACT',
  'NARROWING_TYPE',
  'TYPE_WIDENING',
  'NULLABILITY_TIGHTENING',
  'NULLABILITY_REVIEW',
];
const GAPS = ['MISSING_EVIDENCE', 'INCOMPLETE_EVIDENCE', 'STALE_EVIDENCE', 'MISSING_OWNER'];
const OVERRIDES = [
  'coverage',
  'ageMinutes',
  'weeklyQueries',
  'windowDays',
  'fields',
  'nodes',
  'edges',
  'total',
  'ownerless',
  'unassigned',
  'nodeNames',
  'ownerNames',
  'platform',
  'paths',
  'target',
];

function invalid(id, message) {
  throw new StudioError('INVALID_CASES', id ? `Case ${id}: ${message}` : message);
}

/** Validate the labelled case file strictly so a typo cannot silently drop a check. */
export function loadCases(raw) {
  const file = snapshot(raw, { maxBytes: 1_000_000, maxNodes: 50_000, maxDepth: 12 });
  exact(file, ['schema', 'about', 'world', 'cases']);
  if (file.schema !== 'lineageguard.policy-cases/1') invalid(null, 'Unsupported case file');
  exact(file.world, [
    'target',
    'name',
    'platform',
    'fields',
    'nodes',
    'edges',
    'paths',
    'weeklyQueries',
  ]);
  const nodeIds = new Set(file.world.nodes.map((n) => n.id));
  if (!Array.isArray(file.cases) || file.cases.length === 0) invalid(null, 'No cases');
  const ids = new Set();
  for (const c of file.cases) {
    exact(
      c,
      ['id', 'group', 'rationale', 'changes', 'expected'],
      ['profile', 'summary', 'evidence', 'twin', 'dbt'],
    );
    if (typeof c.id !== 'string' || !/^[a-z0-9-]{3,60}$/.test(c.id) || ids.has(c.id))
      invalid(c.id, 'id must be unique lowercase kebab-case');
    ids.add(c.id);
    if (!GROUPS.includes(c.group)) invalid(c.id, `unknown group ${c.group}`);
    if (typeof c.rationale !== 'string' || c.rationale.length < 10)
      invalid(c.id, 'every label needs a rationale');
    if (c.profile !== undefined && !['standard', 'strict'].includes(c.profile))
      invalid(c.id, 'profile must be standard or strict');
    exact(c.expected, ['decision', 'reasons', 'gaps'], ['failedStep']);
    const e = c.expected;
    if (!OUTCOMES.includes(e.decision)) invalid(c.id, `unknown decision ${e.decision}`);
    if (!Array.isArray(e.reasons) || !e.reasons.every((r) => REASONS.includes(r)))
      invalid(c.id, 'unknown reason code');
    if (
      !Array.isArray(e.gaps) ||
      !e.gaps.every((g) => {
        const [kind, code] = String(g).split(':');
        return KINDS.includes(kind) && GAPS.includes(code);
      })
    )
      invalid(c.id, 'gaps must be kind:CODE pairs');
    if ((e.decision === 'failed') !== Object.hasOwn(e, 'failedStep'))
      invalid(c.id, 'failedStep is required exactly when the decision is failed');
    if (e.decision === 'failed' && !KINDS.includes(e.failedStep))
      invalid(c.id, 'failedStep must be an evidence step');
    // dbt cases read the committed saas-analytics-warehouse manifest instead of the world.
    if ((c.group === 'dbt') !== (c.dbt !== undefined))
      invalid(c.id, 'the dbt group and a dbt source go together');
    if (c.dbt !== undefined) {
      exact(c.dbt, ['target'], ['catalog', 'ageMinutes']);
      if (c.evidence !== undefined) invalid(c.id, 'dbt cases take no world evidence overrides');
      if (typeof c.dbt.target !== 'string' || !/^(model|seed|snapshot|source)\./.test(c.dbt.target))
        invalid(c.id, 'dbt target must be a model, seed, snapshot or source unique_id');
      if (c.dbt.catalog !== undefined && typeof c.dbt.catalog !== 'boolean')
        invalid(c.id, 'dbt catalog must be true or false');
      if (
        c.dbt.ageMinutes !== undefined &&
        !(Number.isInteger(c.dbt.ageMinutes) && c.dbt.ageMinutes >= 0 && c.dbt.ageMinutes <= 100000)
      )
        invalid(c.id, 'dbt ageMinutes must be a whole number of minutes');
    }
    if (c.evidence !== undefined) {
      exact(c.evidence, [], OVERRIDES);
      for (const id of [
        ...(c.evidence.nodes || []),
        ...(c.evidence.ownerless || []),
        ...Object.keys(c.evidence.nodeNames || {}),
        ...Object.keys(c.evidence.ownerNames || {}),
      ])
        if (!nodeIds.has(id)) invalid(c.id, `unknown node ${id}`);
      for (const key of ['coverage', 'ageMinutes', 'target'])
        for (const kind of Object.keys(c.evidence[key] || {}))
          if (!KINDS.includes(kind) && !(key === 'ageMinutes' && kind === '*'))
            invalid(c.id, `unknown evidence kind ${kind}`);
    }
  }
  for (const c of file.cases)
    if (c.twin !== undefined && (!ids.has(c.twin) || c.twin === c.id))
      invalid(c.id, 'twin must name another case');
  return file;
}

/**
 * A read-only synthetic source for one case: the shared world plus the case's overrides.
 * Observation times are relative to the moment of each read.
 */
export function createCaseAdapter(world, spec) {
  const o = spec.evidence || {};
  const revision = `policy-benchmark:${spec.id}`;
  const kept = new Set(o.nodes || world.nodes.map((n) => n.id));
  const ownerless = new Set(o.ownerless || []);
  const nodes = world.nodes
    .filter((n) => kept.has(n.id))
    .map((n) => ({
      ...n,
      name: o.nodeNames?.[n.id] ?? n.name,
      owner: ownerless.has(n.id) ? null : (o.ownerNames?.[n.id] ?? n.owner),
    }));
  const data = {
    resolve: { urn: world.target, name: world.name, platform: o.platform ?? world.platform },
    schema: { fields: o.fields ?? world.fields },
    lineage: {
      nodes,
      edges: o.edges ?? world.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
      total: o.total ?? world.nodes.length - 1,
      level: 'table',
    },
    usage: {
      weeklyQueries: Object.hasOwn(o, 'weeklyQueries') ? o.weeklyQueries : world.weeklyQueries,
      windowDays: o.windowDays ?? 7,
    },
    ownership: {
      owners: nodes.filter((n) => n.owner !== null).map((n) => ({ urn: n.urn, name: n.owner })),
      unassigned: [
        ...nodes.filter((n) => n.owner === null).map((n) => n.urn),
        ...(o.unassigned || []),
      ],
    },
    paths: { paths: o.paths ?? world.paths, level: 'column' },
  };
  return {
    mode: 'synthetic-fixture',
    revision,
    readOnly: true,
    scenarioId: null,
    async read(kind, request, { signal } = {}) {
      signal?.throwIfAborted();
      requireThat(Object.hasOwn(data, kind), 'CAPABILITY_DENIED', 'Unknown benchmark read');
      const minutes = o.ageMinutes?.[kind] ?? o.ageMinutes?.['*'] ?? 1;
      return snapshot({
        kind,
        target: o.target?.[kind] ?? world.target,
        observedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
        source: { mode: 'synthetic-fixture', revision },
        coverage: o.coverage?.[kind] ?? 'complete',
        data: data[kind],
      });
    },
  };
}

let dbtFiles = null;
/** The digest of the dbt fixture the dbt cases read, pinned in the report. */
export function dbtFixtureSha256() {
  dbtFiles ??= readDbtFixture();
  return createHash('sha256')
    .update(canonical(dbtFiles.manifest))
    .update(canonical(dbtFiles.catalog))
    .digest('hex');
}
/**
 * The real manifest, observed ageMinutes before the read (1 by default), as synthetic cases
 * use ageMinutes. The policy sees what a manifest supplies and nothing more.
 */
export async function createDbtCaseAdapter(spec) {
  dbtFiles ??= readDbtFixture();
  const { manifest, catalog } = structuredClone(dbtFiles);
  const at = new Date(Date.now() - (spec.dbt.ageMinutes ?? 1) * 60_000).toISOString();
  manifest.metadata.generated_at = at;
  catalog.metadata.generated_at = at;
  const index = parseDbtManifest(manifest);
  const target = listDbtTargets(index).find((t) => t.uniqueId === spec.dbt.target);
  requireThat(target, 'INVALID_CASES', `Case ${spec.id}: unknown dbt target`);
  const adapter = await captureDbtManifest(index, target.urn, {
    catalog: spec.dbt.catalog === false ? null : parseDbtCatalog(catalog),
  });
  return { adapter, urn: target.urn };
}

/** Execute one case through the same interpreter, evidence contracts and policy as Studio. */
export async function runCase(world, spec) {
  const { adapter, urn } = spec.dbt
    ? await createDbtCaseAdapter(spec)
    : { adapter: createCaseAdapter(world, spec), urn: world.target };
  const request = {
    datasetUrn: urn,
    changeRequest: {
      summary: spec.summary ?? `Benchmark case ${spec.id}`,
      changes: spec.changes,
    },
  };
  const created = await createRun(request, makeRecipe(spec.profile ?? 'standard'), adapter);
  const run = await executeRun(created, { adapter });
  if (run.status === 'completed') {
    const policy = run.result.policy;
    return {
      decision: policy.decision,
      reasons: policy.reasons.map((r) => r.code).sort(),
      gaps: policy.gaps.map((g) => `${g.kind}:${g.code}`).sort(),
    };
  }
  requireThat(run.status === 'failed', 'BENCHMARK_FAILED', `Case ${spec.id} ended ${run.status}`);
  return {
    decision: 'failed',
    reasons: [],
    gaps: [],
    failedStep: Object.values(run.steps).find((s) => s.status === 'failed')?.id ?? null,
  };
}

const ratio = (part, whole) => (whole === 0 ? null : Math.round((part / whole) * 10000) / 10000);
const f1 = (p, r) => (p === null || r === null || p + r === 0 ? null : ratio(2 * p * r, p + r));
const sameList = (a, b) => canonical([...a].sort()) === canonical([...b].sort());
function tally(list) {
  const counts = new Map();
  for (const item of list) counts.set(item, (counts.get(item) || 0) + 1);
  return counts;
}

/** Multiset precision and recall per code, plus micro totals over all codes. */
export function codeMetrics(rows, key) {
  const per = {};
  const total = { tp: 0, fp: 0, fn: 0 };
  for (const { expected, observed } of rows) {
    const want = tally(expected[key]),
      got = tally(observed[key]);
    for (const code of new Set([...want.keys(), ...got.keys()])) {
      const w = want.get(code) || 0,
        g = got.get(code) || 0,
        tp = Math.min(w, g);
      per[code] ??= { tp: 0, fp: 0, fn: 0 };
      per[code].tp += tp;
      per[code].fp += g - tp;
      per[code].fn += w - tp;
      total.tp += tp;
      total.fp += g - tp;
      total.fn += w - tp;
    }
  }
  const score = ({ tp, fp, fn }) => {
    const precision = ratio(tp, tp + fp),
      recall = ratio(tp, tp + fn);
    return { labelled: tp + fn, predicted: tp + fp, precision, recall, f1: f1(precision, recall) };
  };
  return {
    micro: score(total),
    perCode: Object.fromEntries(
      Object.keys(per)
        .sort()
        .map((code) => [code, score(per[code])]),
    ),
  };
}

/** Decision confusion matrix, per-outcome precision/recall and safety counts. */
export function decisionMetrics(rows) {
  const confusion = Object.fromEntries(
    OUTCOMES.map((e) => [e, Object.fromEntries(OUTCOMES.map((o) => [o, 0]))]),
  );
  for (const { expected, observed } of rows) confusion[expected.decision][observed.decision]++;
  const perOutcome = {};
  for (const outcome of OUTCOMES) {
    const tp = confusion[outcome][outcome];
    const labelled = OUTCOMES.reduce((n, o) => n + confusion[outcome][o], 0);
    const predicted = OUTCOMES.reduce((n, e) => n + confusion[e][outcome], 0);
    const precision = ratio(tp, predicted),
      recall = ratio(tp, labelled);
    perOutcome[outcome] = { labelled, predicted, precision, recall, f1: f1(precision, recall) };
  }
  return { outcomes: OUTCOMES, confusion, perOutcome };
}

export function direction(expected, observed) {
  if (expected === observed) return 'match';
  const delta = STRICTNESS[observed] - STRICTNESS[expected];
  return delta < 0 ? 'more-permissive' : delta > 0 ? 'stricter' : 'different-stop';
}

export function summarize(file, rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const twins = file.cases.filter((c) => c.twin !== undefined);
  const count = (fn) => rows.filter(fn).length;
  const decided = rows.filter((r) => r.expected.decision !== 'failed');
  const matched = count((r) => r.decisionMatch);
  return {
    schema: 'lineageguard.policy-benchmark/1',
    policyVersion: POLICY_VERSION,
    casesSha256: createHash('sha256').update(canonical(file)).digest('hex'),
    ...(file.cases.some((c) => c.dbt) ? { dbtFixtureSha256: dbtFixtureSha256() } : {}),
    summary: {
      cases: rows.length,
      decisionsMatched: matched,
      decisionAccuracy: ratio(matched, rows.length),
      morePermissive: count(
        (r) => direction(r.expected.decision, r.observed.decision) === 'more-permissive',
      ),
      stricter: count((r) => direction(r.expected.decision, r.observed.decision) === 'stricter'),
      differentStop: count(
        (r) => direction(r.expected.decision, r.observed.decision) === 'different-stop',
      ),
      detailsMatched: count((r) => r.detailsMatch),
      twins: twins.length,
      twinsHeld: twins.filter((c) => {
        const a = byId.get(c.id).observed,
          b = byId.get(c.twin).observed;
        return (
          a.decision === b.decision && sameList(a.reasons, b.reasons) && sameList(a.gaps, b.gaps)
        );
      }).length,
    },
    decisions: decisionMetrics(rows),
    reasons: codeMetrics(decided, 'reasons'),
    gaps: codeMetrics(decided, 'gaps'),
    disagreements: rows
      .filter((r) => !r.decisionMatch || !r.detailsMatch)
      .map((r) => ({
        id: r.id,
        expected: r.expected.decision,
        observed: r.observed.decision,
        direction: r.decisionMatch
          ? 'details'
          : direction(r.expected.decision, r.observed.decision),
      })),
    results: rows,
  };
}

export async function runBenchmark(file) {
  const rows = [];
  for (const spec of file.cases) {
    const observed = await runCase(file.world, spec);
    const expected = {
      decision: spec.expected.decision,
      reasons: [...spec.expected.reasons].sort(),
      gaps: [...spec.expected.gaps].sort(),
      ...(spec.expected.failedStep ? { failedStep: spec.expected.failedStep } : {}),
    };
    rows.push({
      id: spec.id,
      group: spec.group,
      profile: spec.profile ?? 'standard',
      expected,
      observed,
      decisionMatch: expected.decision === observed.decision,
      detailsMatch:
        sameList(expected.reasons, observed.reasons) &&
        sameList(expected.gaps, observed.gaps) &&
        expected.failedStep === observed.failedStep,
    });
  }
  return summarize(file, rows);
}

/** Stable JSON with one line per case, so a behaviour change shows up as a one-line diff. */
export function formatReport(report) {
  const { disagreements, results, ...head } = report;
  const rows = (items) =>
    items.length ? `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : '[]';
  const top = JSON.stringify(head, null, 2).slice(0, -2);
  return `${top},\n  "disagreements": ${rows(disagreements)},\n  "results": ${rows(results)}\n}\n`;
}

const percent = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const fixed = (x) => (x === null ? 'n/a' : x.toFixed(2));

export function headline(report) {
  const s = report.summary;
  return (
    `${s.cases} labelled cases: ${s.decisionsMatched} decisions match the label ` +
    `(${percent(s.decisionAccuracy)}), ${s.morePermissive} are more permissive than the label ` +
    `and ${s.stricter} are stricter.`
  );
}

/** The results block in docs/EVALUATION.md, regenerated by `--write` and checked by `--check`. */
export function renderMarkdown(report) {
  const { summary: s, decisions: d } = report;
  const lines = [
    headline(report),
    '',
    `Reason codes: precision ${fixed(report.reasons.micro.precision)}, recall ${fixed(report.reasons.micro.recall)}. ` +
      `Evidence gaps: precision ${fixed(report.gaps.micro.precision)}, recall ${fixed(report.gaps.micro.recall)}. ` +
      `Adversarial twins with identical outcomes: ${s.twinsHeld} of ${s.twins}.`,
    '',
    '| Outcome | Labelled | Predicted | Precision | Recall | F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...d.outcomes.map((o) => {
      const m = d.perOutcome[o];
      return `| \`${o}\` | ${m.labelled} | ${m.predicted} | ${fixed(m.precision)} | ${fixed(m.recall)} | ${fixed(m.f1)} |`;
    }),
    '',
    'Confusion matrix (rows: label, columns: policy output):',
    '',
    `| Label | ${d.outcomes.map((o) => `\`${o}\``).join(' | ')} |`,
    `| --- | ${d.outcomes.map(() => '---:').join(' | ')} |`,
    ...d.outcomes.map(
      (e) => `| \`${e}\` | ${d.outcomes.map((o) => d.confusion[e][o]).join(' | ')} |`,
    ),
    '',
  ];
  if (report.disagreements.length) {
    lines.push('| Case | Label | Policy output | Direction |', '| --- | --- | --- | --- |');
    for (const x of report.disagreements)
      lines.push(`| \`${x.id}\` | \`${x.expected}\` | \`${x.observed}\` | ${x.direction} |`);
  } else lines.push('Every case matches its label.');
  return lines.join('\n');
}

/** Replace the generated text between `<!-- name:start -->` and `<!-- name:end -->`. */
export function replaceBlock(text, name, content) {
  const start = `<!-- ${name}:start -->`,
    end = `<!-- ${name}:end -->`;
  const a = text.indexOf(start),
    b = text.indexOf(end);
  requireThat(
    a !== -1 && b > a && text.indexOf(start, a + 1) === -1,
    'INVALID_DOCUMENT',
    `Missing or repeated ${name} markers`,
  );
  return `${text.slice(0, a + start.length)}\n${content}\n${text.slice(b)}`;
}
