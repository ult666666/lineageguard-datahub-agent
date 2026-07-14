# LineageGuard — DataHub Agent Hackathon submission packet

## Project name

LineageGuard

## Tagline

A DataHub-context agent that blocks dangerous schema changes and generates a safe migration plan before merge.

## Challenge categories

- Primary: Agents That Do Real Work
- Secondary: Metadata-Aware Code Generation & Development

## Short description

LineageGuard reviews a proposed data-schema change using DataHub context that a normal code review cannot see: downstream datasets, dashboards, pipelines, ML models, owners, usage, sensitive-data tags, and quality signals. It scores the blast radius, makes a block/approval/proceed decision, and generates staged migration SQL, validation tests, owner notifications, PR-ready documentation, and an approval-gated DataHub write-back plan.

## Inspiration

A schema edit can look harmless in a pull request while silently breaking finance dashboards, ML features, and operational pipelines. The missing ingredient is organizational context. DataHub already knows what depends on the table, who owns it, how it is used, and which quality rules protect it. LineageGuard turns that metadata into an agent that acts before production breaks.

## What it does

1. Accepts a dataset URN and structured schema-change request.
2. Reads dataset and downstream-lineage context using DataHub MCP tools.
3. Scores technical, operational, ownership, usage, quality, and sensitive-data risk.
4. Blocks critical changes or routes medium/high-risk changes for approval.
5. Generates additive migration SQL rather than irreversible in-place changes.
6. Generates validation checks and a PR-ready blast-radius review.
7. Prepares a DataHub write-back proposal while keeping mutation approval-gated.

## How DataHub is essential

Without DataHub, the agent sees only the edited table. With DataHub MCP, it can retrieve:

- dataset schemas and documentation;
- downstream lineage across multiple asset types;
- ownership and missing-owner gaps;
- usage and common-query signals;
- tags and sensitive-data classifications; and
- quality assertions and context documents.

The MVP uses the MCP tools `get_entities` and `get_lineage`. The adapter is designed for a DataHub Cloud tenant or a self-hosted MCP Server. A deterministic DataHub-shaped snapshot is included only so judges and developers can reproduce the demo without credentials.

## Technical architecture

- Node.js 20+ with no runtime dependencies
- DataHub MCP Streamable HTTP client using JSON-RPC 2.0
- Catalog adapters for live DataHub MCP and reproducible demo mode
- Risk and compatibility engine
- Migration-SQL and PR-document generators
- Approval-gated write-back plan
- Responsive browser UI and JSON API
- Node test runner

## What is complete

- Working browser demo and API
- DataHub MCP client and live-mode adapter
- Synthetic DataHub catalog and risky schema-change scenario
- Blast-radius scoring across datasets, dashboards, pipelines, and ML models
- Additive migration SQL and validation generation
- PR review and owner notification output
- Approval-gated write-back plan
- Automated tests for breaking and additive changes
- Apache 2.0 license and repository documentation

## Remaining before submission

- Test the MCP adapter against a live DataHub Cloud/Core instance.
- Confirm exact live tool schemas and adjust argument mapping if needed.
- Implement an optional approved write-back mutation to attach the review to DataHub.
- Publish a public Apache-2.0 GitHub repository.
- Host the app at a public free URL.
- Record and upload the public screen demo under three minutes.
- Join and submit through Devpost.

## Honest limitations

- The current local demo uses a DataHub-shaped snapshot because no tenant credentials are configured.
- The migration SQL is advisory and is never executed by the app.
- Risk weights are transparent heuristics intended for team calibration.
- Live metadata mutation remains disabled until an authorized person approves it.

## Three-minute demo script

### 0:00–0:20 — Problem

“A schema change can look safe in code while breaking downstream dashboards, pipelines, or ML models. Code review rarely has the complete organizational context.”

### 0:20–0:40 — DataHub advantage

“LineageGuard uses DataHub MCP to read schemas, ownership, usage, quality signals, tags, and downstream lineage before deciding whether a change can ship.”

### 0:40–1:15 — Submit the change

Show the `orders` dataset URN and the proposed rename, breaking type conversion, and currency-field removal. Click **Analyze with LineageGuard**.

### 1:15–1:50 — Decision and blast radius

Show the critical score and block decision. Point out the downstream revenue dataset, executive dashboard, ML model, and monthly-close pipeline, including the missing owner.

### 1:50–2:20 — Generated artifacts

Open the staged migration SQL. Explain the additive rename, shadow-column cast, failed-cast gate, and delayed destructive drop. Open the PR review and validation checklist.

### 2:20–2:45 — Agent loop and safety

Show the plan, retrieve, analyze, generate, and proposed write-back trace. Explain that reads are automatic but mutations require approval.

### 2:45–3:00 — Close

“LineageGuard turns DataHub’s context graph into a practical change-safety agent: fewer surprises, clearer ownership, and migration artifacts a data team could actually merge.”

## Devpost checklist

- [ ] Create or sign in to Devpost.
- [ ] Review and accept the official hackathon rules personally.
- [ ] Join the hackathon and complete any reCAPTCHA.
- [ ] Create a public GitHub repository with this project.
- [ ] Ensure the GitHub About section detects the Apache 2.0 license.
- [ ] Add public hosted-demo URL.
- [ ] Add public repository URL.
- [ ] Add public YouTube or Vimeo demo URL under three minutes.
- [ ] Add screenshots and sample outputs.
- [ ] Complete the optional actionable-feedback section for the $50 feedback prizes.
- [ ] Submit before August 10, 2026 at 5:00 PM EDT.
