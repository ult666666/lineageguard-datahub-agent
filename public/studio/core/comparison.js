import { canonical, requireThat } from './contract.js';
export function compareRuns(a, b) {
  requireThat(
    a?.result?.policy && b?.result?.policy,
    'COMPARISON_NOT_READY',
    'Complete both reviews before comparing',
  );
  const side = (r) => ({
    id: r.id,
    summary: r.request.changeRequest.summary,
    binding: r.binding,
    decision: r.result.policy.decision,
    riskLevel: r.result.policy.riskLevel,
    evidenceReady: r.result.policy.evidenceReady,
    gaps: r.result.policy.gaps.map((g) => g.code + ':' + g.kind),
    calls: r.callsUsed,
    policy: r.recipe.policy,
  });
  const left = side(a),
    right = side(b);
  return {
    sameRequest: canonical(a.request) === canonical(b.request),
    sameRecipe: canonical(a.recipe) === canonical(b.recipe),
    sameSourceRevision: a.sourceRevision === b.sourceRevision,
    left,
    right,
    removedGaps: left.gaps.filter((g) => !right.gaps.includes(g)),
    addedGaps: right.gaps.filter((g) => !left.gaps.includes(g)),
    explanation:
      canonical(a.request) === canonical(b.request)
        ? 'Same change request; policy and evidence differences are shown explicitly.'
        : 'The change requests differ. This is an alternative-plan comparison, not a repeated result on an identical input.',
    executionAuthorized: false,
  };
}
