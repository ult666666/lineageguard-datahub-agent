# LineageGuard demo storyboard

Target runtime: 2:30–2:50. Keep the final public video under three minutes.

## Capture order

1. `assets/demo-landing.jpg` — introduce the production risk and the DataHub-context agent loop.
2. `assets/demo-request.jpg` — show the dataset URN and risky migration request.
3. `assets/demo-result-top.jpg` — show the BLOCK decision, critical score, impacted assets, and owners to notify.
4. `assets/demo-impact.jpg` — show the risk evidence and downstream DataHub blast radius.
5. `assets/demo-artifacts.jpg` — show the additive migration SQL and validation gate.
6. `assets/demo-trace.jpg` — show the PR review and the plan/retrieve/analyze/generate/write-back workflow.

## Narration

“A schema change can look safe in code while breaking downstream dashboards, pipelines, and machine-learning models. LineageGuard prevents that by using DataHub as the context layer for an AI change-safety agent.

The reviewer provides a DataHub dataset URN and a structured proposal. This demo renames a revenue field, changes its type from decimal to text, and removes the currency column. LineageGuard retrieves schema, ownership, usage, quality, sensitive-data tags, and downstream lineage through the DataHub MCP interface.

The agent scores the blast radius and blocks this change with a critical score of one hundred. It identifies four downstream assets: a finance dataset, an executive revenue dashboard, a customer-lifetime-value model, and a monthly-close pipeline. It also spots a missing owner and active production usage.

LineageGuard does more than flag risk. It generates an additive migration plan that preserves compatibility, creates a shadow column for the type conversion, blocks promotion when casts fail, and delays destructive removal until owners approve and usage reaches zero.

The generated PR review gives engineers the risk evidence, affected owners, validation checklist, and rollout recommendation in a form they can use before merge. The execution trace makes the agent workflow inspectable: plan, retrieve DataHub context, analyze impact, generate safe artifacts, and propose a write-back.

Reads are automatic. Mutations remain approval-gated, and the demo never executes production SQL. LineageGuard turns DataHub’s context graph into a practical safety layer for schema changes: fewer production surprises, clearer ownership, and migration artifacts a data team can actually review.”

## Recording notes

- Use the hosted demo at https://lineageguard-datahub-agent.vercel.app.
- Start with **Load risky demo**, then click **Analyze with LineageGuard**.
- Expand **Staged migration SQL**, **Generated PR review**, and **Agent execution trace**.
- Do not claim the snapshot is a live tenant. State clearly that the public demo uses synthetic DataHub-shaped metadata and that the adapter supports live DataHub MCP credentials.
- End on the source repository and hosted-demo URLs.
