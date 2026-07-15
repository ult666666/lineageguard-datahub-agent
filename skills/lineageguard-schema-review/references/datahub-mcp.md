# Read-only DataHub MCP collection

Use DataHub only to collect evidence. Do not call mutation tools during review.

1. Resolve the changed dataset, chart, dashboard, pipeline, or model with `get_entities`.
2. Query downstream lineage with `get_lineage`; expand far enough to identify user-facing or production-critical endpoints.
3. Record URNs, owners, usage indicators, quality assertions/incidents, and downstream asset types.
4. Deduplicate lineage nodes before counting them.
5. Count critical assets only when evidence identifies them as production, executive, regulatory, customer-facing, or model-serving dependencies.
6. If a signal is unavailable, leave it unknown. Do not convert “not returned” into zero.
7. Include tool name, queried URN, and retrieval time in the evidence list. Do not include tokens or private row/query contents.

Map collected evidence to the manifest fields, run the deterministic scorer, then explain the highest-risk paths in plain language.
