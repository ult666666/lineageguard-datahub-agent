# LineageGuard — DataHub demo video

Target runtime: **2:20–2:40**. Hard limit: **under 3:00**.

Upload the final video to YouTube or Vimeo with **Public** visibility. Use no music or third-party footage. The existing unlisted OpenAI Build Week video is a separate asset and should not be reused for this Devpost entry.

## Recording order

### 0:00–0:18 — Problem and DataHub advantage

**Screen:** Hosted LineageGuard landing page.

**Narration:**

“A schema change can look safe in code while breaking downstream dashboards, pipelines, datasets, and machine-learning models. LineageGuard uses DataHub context to reveal that blast radius before merge.”

### 0:18–0:42 — Enter the change

**Screen:** Click **Load risky demo**. Show the dataset URN and proposed rename, type change, and drop.

**Narration:**

“The reviewer provides a DataHub dataset URN and a structured proposal. This change renames a revenue field, converts it from decimal to text, and removes the currency column. The hosted demo uses a disclosed synthetic DataHub-shaped snapshot so anyone can run it without credentials.”

### 0:42–1:10 — Run and explain the decision

**Screen:** Click **Analyze with LineageGuard**. Show the critical score, block decision, downstream assets, and owner notifications.

**Narration:**

“LineageGuard combines schema risk with the metadata a normal code review cannot see: downstream lineage, ownership gaps, recent usage, quality context, and sensitive-data tags. It blocks this change at critical risk and identifies the affected finance dataset, executive dashboard, ML model, and monthly-close pipeline.”

### 1:10–1:42 — Generated code and checks

**Screen:** Expand **Staged migration SQL** and validation checks.

**Narration:**

“The agent does more than warn. It generates additive migration SQL, preserves the old field during a compatibility window, creates a shadow-column conversion, blocks promotion when casts fail, and delays destructive removal until owners approve and usage reaches zero.”

### 1:42–2:03 — PR artifact and authority boundary

**Screen:** Expand the generated PR review and agent trace.

**Narration:**

“The generated PR review packages the evidence, affected owners, checks, and rollout recommendation in a form a data team can review before merge. DataHub reads are automatic. Production SQL and catalog mutation remain approval-gated and are never executed by this demo.”

### 2:03–2:25 — MCP proof without credentials

**Screen:** Terminal in repository. Run `npm run mcp:smoke` and show the successful JSON result.

**Narration:**

“The live adapter uses the DataHub MCP Server tools get-entities and downstream get-lineage over Streamable HTTP. This bounded local smoke test verifies one MCP session, the official tool arguments, JSON and event-stream responses, and downstream normalization without a tenant, API key, or paid service.”

### 2:25–2:40 — Close

**Screen:** Show repository URL, hosted demo URL, Apache-2.0 badge/detection, and `npm test` summary with ten passes.

**Narration:**

“LineageGuard turns DataHub’s context graph into merge-ready migration code and a safer review decision. The demo and Apache-2.0 repository are public, and all ten tests pass.”

## Capture checklist

- [ ] Browser address bar shows the hosted demo URL.
- [ ] The change request is readable.
- [ ] The analysis visibly runs after a click.
- [ ] The block decision and impacted assets are readable.
- [ ] Migration SQL and PR review are shown.
- [ ] Synthetic-snapshot disclosure is spoken and, ideally, visible.
- [ ] `npm run mcp:smoke` success is shown.
- [ ] `npm test` shows ten passes.
- [ ] Repository and demo URLs are shown.
- [ ] Runtime is below 3:00.
- [ ] YouTube/Vimeo visibility is Public.
- [ ] Logged-out playback works.
