# OpenAI Build Week submission packet

## Project

**Name:** LineageGuard — Codex Schema Safety

**Tagline:** Stop breaking schema changes before they reach production.

**Category:** Developer Tools

**One-line pitch:** LineageGuard is a portable Codex skill that reviews database, warehouse, event, API, and data-contract changes, maps their downstream blast radius, and returns an auditable `APPROVE`, `CONDITIONAL`, or `BLOCK` decision before deployment.

## Short description

A schema edit can look harmless in one file while breaking dashboards, pipelines, models, exports, and customer alerts downstream. LineageGuard turns that hidden dependency problem into a repeatable Codex review. It can collect read-only evidence from DataHub MCP or accept a redacted local manifest, run a deterministic risk policy, and produce the decision, evidence gaps, mitigations, rollback plan, and verification checklist a developer needs before merging.

The Build Week extension is a reusable Codex skill, not a chat-only demo. Judges can install it locally, run its standard-library Python scorer without an API key, and verify its behavior through automated tests and sample manifests.

## Inspiration

Schema changes are usually reviewed where they are written. Production failures happen where they are consumed. A renamed field can silently affect an executive dashboard, a revenue pipeline, a fraud model, and a customer-facing alert at the same time.

DataHub can expose that lineage, but raw metadata is not yet a deployment decision. We built LineageGuard to give Codex a bounded, auditable workflow for turning dependency evidence into a safe change recommendation without giving the agent permission to mutate production systems.

## What it does

1. Accepts a database, warehouse, event, API, or data-contract change.
2. Normalizes the change into a redacted manifest.
3. Optionally gathers owners, usage, quality signals, incidents, and downstream lineage through read-only DataHub MCP tools.
4. Treats missing production evidence as uncertainty instead of assuming zero risk.
5. Runs a deterministic local scorer.
6. Returns one decision: `APPROVE`, `CONDITIONAL`, or `BLOCK`.
7. Explains the highest-risk paths and creates mitigations, validation checks, rollback steps, and an owner-review plan.
8. Keeps every catalog or schema mutation behind a separate human approval gate.

## How we built it

- **Codex skill:** a concise `SKILL.md` defines when the workflow should trigger and what evidence it must collect.
- **GPT-5.6 through Codex:** used to translate the product constraints into the skill contract, implementation, edge-case review, tests, and documentation.
- **Deterministic scorer:** a Python standard-library script validates the manifest and produces JSON or Markdown output.
- **Risk policy:** a public reference document makes weights, caps, decision thresholds, and unknown-evidence handling inspectable.
- **DataHub MCP guide:** limits the integration to read-only metadata collection and documents safe evidence mapping.
- **Node test suite:** validates high-risk blocking, safe additive approval, unknown-evidence handling, and rejection of ambiguous inputs.
- **Existing LineageGuard demo:** provides a runnable browser experience for the broader schema-risk workflow.

No paid API, contest credit, production credential, or private dataset is required to test the Build Week extension.

## What is new for Build Week

The original LineageGuard browser MVP existed before July 13, 2026. The following extension was created after the submission period opened and is isolated for review:

- portable `lineageguard-schema-review` Codex skill;
- deterministic local risk scorer;
- documented risk policy and DataHub MCP evidence contract;
- four automated skill-scorer tests;
- installation and judge-testing instructions;
- explicit unknown-evidence and mutation-approval boundaries.

**Dated source evidence:** commits `00a0d00` and `2468482` on draft pull request <https://github.com/ult666666/lineageguard-datahub-agent/pull/1>.

## How we collaborated with Codex

The project owner chose the problem, the strict USD 0 budget, and three non-negotiable product rules:

1. LineageGuard must never execute a schema change automatically.
2. Missing production evidence must increase risk instead of disappearing.
3. Judges must be able to test the extension without paid infrastructure.

In the persisted GPT-5.6 Codex thread, Codex converted those constraints into the skill, scorer, policy, tests, and documentation. Codex accelerated implementation and adversarial review; the owner retained authority over product scope and external publication.

**Required `/feedback` Codex Session ID:** `019f5815-17d2-7bd2-81cc-68d346d79d63`

## Challenges

The hardest design problem was uncertainty. A missing lineage result can mean “no downstream consumers,” but it can also mean “the catalog did not return enough evidence.” Treating both as zero would create a dangerous false approval. The scorer therefore raises risk when production context is unknown and can block a change whose safety case is mostly missing.

The second challenge was keeping an AI-assisted review auditable. The final decision comes from deterministic inputs and public thresholds. Codex explains the evidence and proposes mitigations, but it cannot silently change the policy or execute the migration.

## Accomplishments

- A reusable Codex skill that works across five schema-contract surfaces.
- Fully local scoring with no API key or paid service.
- Clear `APPROVE`, `CONDITIONAL`, and `BLOCK` decisions.
- Unknown production evidence never becomes a false zero-risk result.
- Read-only DataHub evidence collection and a separate mutation gate.
- Nine passing repository tests, including four Build Week skill tests.
- A public, dated implementation trail.

## What we learned

Agentic developer tools are safer when the model owns interpretation but not authority. Codex is excellent at turning context into an explanation and an action plan. Deterministic policy, typed inputs, explicit uncertainty, and human approval make that reasoning usable in a real deployment workflow.

## What's next

- Validate the DataHub MCP mapping against a real test tenant.
- Add adapters for dbt manifests, protobuf, Avro, OpenAPI, and GraphQL diffs.
- Generate pull-request checks directly from the scored manifest.
- Add policy profiles for regulated, customer-facing, and model-serving systems.
- Build a replayable corpus of real schema incidents and mitigations.

## Judge testing

### Fastest path: existing browser demo

Open <https://lineageguard-datahub-agent.vercel.app>, load the risky demo, and run the analysis.

### Test the new Codex skill

```bash
git clone https://github.com/ult666666/lineageguard-datahub-agent.git
cd lineageguard-datahub-agent
git checkout codex/lineageguard-codex-skill
cp -R skills/lineageguard-schema-review "${CODEX_HOME:-$HOME/.codex}/skills/"
npm test
```

Then ask Codex:

```text
Use $lineageguard-schema-review to assess renaming orders.total to gross_total.
```

### Run the scorer directly

```bash
python3 skills/lineageguard-schema-review/scripts/score_change.py change.json --format markdown
```

The scorer uses only the Python standard library.

## Submission links

- Public repository: <https://github.com/ult666666/lineageguard-datahub-agent>
- Build Week draft pull request: <https://github.com/ult666666/lineageguard-datahub-agent/pull/1>
- Live demo: <https://lineageguard-datahub-agent.vercel.app>
- Public YouTube demo: pending

## Demo video script — target 2:35

### 0:00–0:15 — Problem

**Visual:** Open on the LineageGuard result showing a blocked schema change and downstream assets.

**Audio:** “A schema edit can look safe in one file and still break dashboards, pipelines, models, and customer alerts downstream. LineageGuard gives Codex a repeatable way to review that blast radius before deployment.”

### 0:15–0:35 — Product

**Visual:** Show the repository and the new `skills/lineageguard-schema-review` directory.

**Audio:** “For OpenAI Build Week, I turned the original LineageGuard prototype into a portable Codex skill. It reviews database, warehouse, event, API, and data-contract changes and returns an auditable approve, conditional, or block decision.”

### 0:35–1:05 — Run the skill

**Visual:** Ask Codex to review a risky rename. Show the normalized evidence, decision, highest-risk paths, mitigations, rollback plan, and verification checklist.

**Audio:** “The skill can use read-only DataHub MCP evidence or a redacted local manifest. Codex maps the change to owners, usage, quality signals, incidents, and downstream lineage, then explains the highest-risk paths and creates a safe migration plan.”

### 1:05–1:30 — Deterministic safety

**Visual:** Run the Python scorer on a risky manifest, then a safe nullable addition.

**Audio:** “The final score is deterministic and runs locally with the Python standard library. A breaking high-blast-radius rename blocks. A controlled nullable addition approves. Missing production evidence increases risk instead of being silently treated as zero.”

### 1:30–1:52 — Approval boundary

**Visual:** Highlight the read-only MCP reference and mutation approval language.

**Audio:** “Codex owns interpretation, not production authority. Metadata collection is read-only, and every catalog or schema mutation stays behind a separate human approval gate.”

### 1:52–2:15 — How GPT-5.6 and Codex were used

**Visual:** Show the dated commits, draft PR, tests, and the Codex session ID in the README.

**Audio:** “I used GPT-5.6 through Codex to translate the product constraints into the skill contract, implementation, edge-case review, tests, and documentation. The owner chose the problem and safety boundaries; Codex accelerated the engineering and adversarial review.”

### 2:15–2:35 — Proof and close

**Visual:** Run `npm test`, show nine passes, then return to the live demo.

**Audio:** “LineageGuard passes nine automated tests, needs no paid API or production credential, and is available in the public repository. It makes hidden schema risk visible before a small edit becomes a production incident.”
