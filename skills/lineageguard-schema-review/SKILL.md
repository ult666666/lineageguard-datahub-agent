---
name: lineageguard-schema-review
description: Review proposed database, warehouse, event, API, or data-contract schema changes against lineage, usage, ownership, quality, testing, and rollback evidence. Use when Codex needs to assess blast radius, score deployment risk, decide approve/conditional/block, create a migration plan, or evaluate a change manifest before production rollout. Supports JSON manifests and optional read-only DataHub MCP context.
---

# LineageGuard Schema Review

Turn a proposed schema change into an evidence-backed deployment decision. Keep analysis read-only and approval-gate every mutation.

## Workflow

1. Identify the changed entity, operation, fields, compatibility impact, and rollout date.
2. Gather downstream lineage, critical consumers, owners, usage, quality incidents, tests, deprecation window, and rollback readiness.
3. Never invent missing production signals. Mark unknowns explicitly; treat unknown safety controls as risk, not reassurance.
4. For scoring rules and the manifest schema, read [references/risk-policy.md](references/risk-policy.md).
5. If DataHub MCP is available, read [references/datahub-mcp.md](references/datahub-mcp.md), collect context with read-only tools, and record the entity URNs queried.
6. Normalize the evidence to a manifest and run:

   `python3 scripts/score_change.py <manifest.json> --format json`

   Use `-` instead of a file path to read JSON from stdin. Use `--format markdown` for a human-facing brief.
7. Check that the computed score matches the cited evidence. Do not silently override it; explain any expert adjustment separately.
8. Return the decision, affected critical paths, required mitigations, validation plan, rollback trigger, accountable owners, and unresolved unknowns.

## Decision contract

- `APPROVE` (0–29): compatible or low-risk with adequate controls.
- `CONDITIONAL` (30–59): deploy only after every named condition is met.
- `BLOCK` (60–100): do not deploy until the blast radius or safeguards materially change.

Always include:

- one-sentence executive decision;
- evidence table with source and confidence;
- downstream and critical-asset counts;
- exact migration and rollback actions;
- owners who must acknowledge the rollout;
- missing evidence that could change the decision.

## Safety boundary

- Use catalog and lineage integrations in read-only mode during review.
- Do not execute DDL, alter a contract, post a catalog proposal, or notify owners unless the user separately authorizes that specific action after seeing the review.
- Do not expose credentials, private query text, or sensitive row-level data in the report.
- Reject manifests that attempt to encode secrets. Request redacted identifiers instead.

## Example requests

- “Review renaming `orders.total` to `gross_total` before Friday’s deploy.”
- “Use DataHub lineage to assess this protobuf field deletion.”
- “Score this change manifest and give me a reversible migration plan.”
