import { snapshot, exact, requireThat, integer, text } from './contract.js';
export const REGISTRY = {
  resolve: { label: 'Resolve target', kind: 'tool', requires: [] },
  schema: { label: 'Schema contract', kind: 'tool', requires: ['resolve'] },
  lineage: { label: 'Downstream lineage', kind: 'tool', requires: ['resolve'] },
  usage: { label: 'Usage evidence', kind: 'tool', requires: ['resolve'] },
  ownership: { label: 'Accountable owners', kind: 'tool', requires: ['resolve'] },
  paths: { label: 'Verified paths', kind: 'tool', requires: ['lineage'] },
  compatibility: { label: 'Compatibility rules', kind: 'deterministic', requires: ['schema'] },
  policy: {
    label: 'Evidence & risk policy',
    kind: 'policy',
    requires: ['schema', 'lineage', 'usage', 'ownership', 'compatibility'],
  },
  artifacts: { label: 'Review package', kind: 'deterministic', requires: ['policy'] },
};
export function makeRecipe(profile = 'standard') {
  requireThat(
    ['standard', 'strict', 'sequential'].includes(profile),
    'INVALID_RECIPE',
    'Unknown review profile',
  );
  const nodes = Object.entries(REGISTRY)
    .filter(([id]) => id !== 'paths' || profile === 'strict')
    .map(([id, item]) => ({ id, operation: id, dependsOn: [...item.requires] }));
  if (profile === 'strict') nodes.find((n) => n.id === 'policy').dependsOn.push('paths');
  if (profile === 'sequential') {
    let prior = null;
    for (const n of nodes) {
      if (prior && !n.dependsOn.includes(prior)) n.dependsOn.push(prior);
      prior = n.id;
    }
  }
  return {
    version: 2,
    name:
      profile === 'strict'
        ? 'Evidence-first review'
        : profile === 'sequential'
          ? 'Sequential review'
          : 'Balanced parallel review',
    policy: profile === 'strict' ? 'strict' : 'standard',
    budget: {
      maxConcurrency: profile === 'sequential' ? 1 : 3,
      maxCalls: 12,
      retries: 1,
      stepTimeoutMs: 1500,
      totalTimeoutMs: 10000,
    },
    nodes,
  };
}
export function compileRecipe(raw) {
  const r = snapshot(raw, { maxBytes: 20000, maxNodes: 1000, maxDepth: 8 });
  exact(r, ['version', 'name', 'policy', 'budget', 'nodes']);
  requireThat(r.version === 2, 'INVALID_RECIPE', 'Unsupported recipe version');
  text(r.name, 70, 'Recipe name');
  requireThat(['standard', 'strict'].includes(r.policy), 'INVALID_RECIPE', 'Unknown policy');
  exact(r.budget, ['maxConcurrency', 'maxCalls', 'retries', 'stepTimeoutMs', 'totalTimeoutMs']);
  integer(r.budget.maxConcurrency, 1, 3, 'Concurrency');
  integer(r.budget.maxCalls, 1, 30, 'Call budget');
  integer(r.budget.retries, 0, 2, 'Retries');
  integer(r.budget.stepTimeoutMs, 25, 5000, 'Step deadline');
  integer(r.budget.totalTimeoutMs, 100, 20000, 'Run deadline');
  requireThat(
    r.budget.stepTimeoutMs <= r.budget.totalTimeoutMs,
    'INVALID_RECIPE',
    'Step deadline exceeds run deadline',
  );
  requireThat(
    Array.isArray(r.nodes) && r.nodes.length >= 8 && r.nodes.length <= 9,
    'INVALID_RECIPE',
    'A review needs its eight registered stages',
  );
  const ids = new Set();
  for (const n of r.nodes) {
    exact(n, ['id', 'operation', 'dependsOn']);
    requireThat(
      typeof n.id === 'string' &&
        Object.hasOwn(REGISTRY, n.id) &&
        n.operation === n.id &&
        !ids.has(n.id),
      'INVALID_RECIPE',
      'Unknown capability or duplicate node',
    );
    ids.add(n.id);
    requireThat(
      Array.isArray(n.dependsOn) &&
        n.dependsOn.every((x) => typeof x === 'string') &&
        new Set(n.dependsOn).size === n.dependsOn.length,
      'INVALID_RECIPE',
      'Dependencies must be unique node identifiers',
    );
  }
  for (const id of Object.keys(REGISTRY).filter((x) => x !== 'paths'))
    requireThat(ids.has(id), 'INVALID_RECIPE', 'Missing required stage');
  for (const n of r.nodes) {
    requireThat(
      n.dependsOn.every((id) => ids.has(id) && id !== n.id),
      'INVALID_RECIPE',
      'Unknown or self dependency',
    );
    requireThat(
      REGISTRY[n.id].requires.every((id) => n.dependsOn.includes(id)),
      'INVALID_RECIPE',
      'A required evidence dependency was removed',
    );
  }
  if (ids.has('paths'))
    requireThat(
      r.nodes.find((n) => n.id === 'policy').dependsOn.includes('paths'),
      'INVALID_RECIPE',
      'Path evidence must reach the policy',
    );
  if (r.policy === 'strict')
    requireThat(ids.has('paths'), 'INVALID_RECIPE', 'Strict policy requires path evidence');
  const order = [],
    levels = [],
    done = new Set();
  while (done.size < ids.size) {
    const ready = r.nodes
      .filter((n) => !done.has(n.id) && n.dependsOn.every((id) => done.has(id)))
      .map((n) => n.id);
    requireThat(ready.length > 0, 'INVALID_RECIPE', 'Workflow contains a cycle');
    levels.push(ready);
    for (const id of ready) {
      done.add(id);
      order.push(id);
    }
  }
  return { recipe: r, order, levels };
}
