# Verification

GitHub Actions runs these checks on every pull request and every push to `main`.
The [workflow page](https://github.com/ult666666/lineageguard-datahub-agent/actions/workflows/tests.yml)
shows the latest results. CI uses synthetic data only, clears the DataHub URL and
token, and has no deploy or catalog step.

## What CI runs

[`tests.yml`](../.github/workflows/tests.yml) has two jobs:

| Job | Steps |
| --- | --- |
| Offline tests (Node 22 and 24) | `npm test`: the full Node suite, including a real interrupted process and SQLite recovery. `npm run mcp:smoke`: a read-only MCP handshake against a loopback fixture. `npm run studio:evaluate`: the named synthetic evaluations. `npm run studio:benchmark -- --check`: the labelled policy benchmark, which fails on any decision more permissive than its label or any drift from the pinned report. `npm run build` and `node scripts/build-studio.mjs --verify dist`: the exact public file list and its hashes. |
| Studio browser workflows (Node 24) | `npm ci --ignore-scripts`, `npm run format:check`, then `npm run test:browser`: Chromium journeys in both the browser-session and durable-local modes, with external requests blocked. |

The test job also sets up Python 3.13 for the preserved Codex-skill tests.

## Run the same checks locally

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run mcp:smoke
npm run studio:evaluate
npm run studio:benchmark -- --check
npm run format:check
npx playwright install chromium
npm run test:browser
npm run build
node scripts/build-studio.mjs --verify dist
```

`npm run build` refuses to overwrite an existing `dist/`. `npm run verify:deployed`
is an opt-in acceptance check of the published preview; CI does not run it. See the
[delivery guide](RELEASE_2_0.md).

## What the checks cover

### Policy decisions are measured against labels

[`evals/policy-cases.json`](../evals/policy-cases.json) holds labelled schema changes and
evidence conditions. Each case runs through the real interpreter. The report pins
per-outcome precision and recall, a confusion matrix and every disagreement. Its first
run found five decisions more permissive than their labels; all were fixed. See
[Evaluation](EVALUATION.md) for the labelling rules and current numbers.

### Durable recovery is exercised, not inferred

`test/studio/process-recovery.test.mjs` starts a child process with a temporary
SQLite directory, waits for a real committed checkpoint, interrupts that
test-owned process and reopens the database. It checks that the stored run is
still marked running rather than complete, refuses a premature lease claimant,
and resumes after the old lease expires. The recovered run keeps its ID, gets a
new generation, reuses only checked evidence and keeps correct call accounting.

This proves a bounded single-host recovery path. It does not establish distributed
durability, resilience to disk corruption or authenticated multi-user coordination.

### Browser journeys

Each runtime mode runs a completed review, evidence inspection, a verified JSON
export, an additive-plan comparison, input invalidation, missing usage, numeric
narrowing, a review of the bundled dbt manifest (eight lineage nodes that fit the
graph, owners, the quality-check note and open gaps, with no overflow at 390 pixels), pause, reload and resume, a source outage and its restoration,
cancellation, invalid input, the executed evaluations, and layouts at 390, 768 and
1440 pixels. After a run, keyboard focus must land on the decision heading (the Run
button disables itself, which would otherwise drop focus to the page) and a status
message must announce the result; one run is started from the keyboard. The Review Inspector and saved-review comparison journeys also run
with networking disabled and check that nothing is uploaded and stored checkpoints
do not change. This is targeted accessibility testing, not a WCAG audit.

### Property and hostile-input tests

[`properties.test.mjs`](../test/studio/properties.test.mjs) checks properties on
generated inputs with a seeded generator and no extra dependencies. Each property runs
250 cases per `npm test` (the type parser 500); a failure prints its seed, and
`PROPERTY_SEED=<seed> PROPERTY_RUNS=1 npm test` replays it. The properties cover:

- parsers: SQL types have one canonical form, request validation refuses only with
  `StudioError` and is idempotent, canonical JSON ignores key order, the Inspector's
  duplicate-key scanner has no false positives and finds re-spelled duplicates, and the
  recipe compiler accepts exactly the acyclic graphs in topological order;
- policy: batch order, letter case and free text (summaries, owner and asset names,
  platform labels) never change a decision; adding a change or weakening any evidence
  never makes one more permissive; type widening is reflexive and transitive;
- outputs: an uncleared review never emits an executable SQL line, and the Markdown
  brief keeps a hostile summary on its title line;
- MCP transport: event-stream responses parse the same under any chunking, line ending
  and interleaved notification, and a response to another request is refused.

[`dbt-properties.test.mjs`](../test/studio/dbt-properties.test.mjs) generates random
dbt manifests (sources, seeds, models, snapshots, exposures, data and unit tests, owners
and catalogs) and checks that:

- the returned lineage, its edges and its quality checks equal an independent walk of
  `depends_on`, which does not use `child_map`;
- a full review through the interpreter is never evidence-ready and ends in `block` or
  `needs-evidence`, and replacing every owner name leaves it unchanged (100 cases, since
  each runs two reviews);
- removing or adding one entry in `child_map`, `parent_map` or `depends_on` is always
  refused as `MANIFEST_INCONSISTENT`;
- shuffling key order and dependency lists never changes the evidence revision.

[`dbt-manifest.test.mjs`](../test/studio/dbt-manifest.test.mjs) runs the real fixture and
refuses other schema versions and artifacts, missing maps, mismatched IDs, cycles, self
edges, unknown nodes, prototype keys, accessors, unsafe relation names, ambiguous targets
and oversized files (byte, resource and column limits). It checks that hostile owner and
label text is bounded and changes no decision.

[`hostile-metadata.test.mjs`](../test/studio/hostile-metadata.test.mjs) feeds the
DataHub capture instruction-like text, markup, overlong and non-text names, duplicate
targets, prototype keys and oversized output, and checks the Markdown brief and SQL
draft against hostile summaries and types. The skill scorer test checks that injected
text changes neither the score nor the brief's single heading.

### Regressions reproduced before each fix

- **MCP client:** it accepted unrelated response IDs, ambiguous result envelopes,
  unimplemented protocol negotiation and error-marked tool output, exposed remote
  errors, and could substitute a different mock target.
- **Store and requests:** a dangling database symlink, races in asynchronous run
  admission, invalid decimal precision and scale, and an acknowledgement that did
  not bind the exact result evidence. Batches with duplicate fields or conflicting
  rename targets are now rejected before any artifact is generated.
- **Local UI:** the resume check read the old paused checkpoint before the next
  generation began.
- **Local launcher:** a second `npm run studio:local` threw `EADDRINUSE` after
  initializing an unused store. It now identifies the running service through
  read-only metadata.
- **Review Inspector:** the old checksum check accepted a result changed after the
  outer checksum was recomputed, and a browser test downloaded that inconsistent
  SQL draft. The semantic check now refuses it. Browser tests also found a
  narrow-screen overflow, now fixed.
- **Policy:** the labelled benchmark found that adding `ORDER_ID` next to an existing
  `order_id` returned `proceed-with-checks`, and that a rename declaring a lossy type
  went to review. Names now compare case-insensitively and a declared rename type is
  judged as a type change.
- **Type parser and SQL drafts:** a property test found that `sqlType` accepted a tab
  or line break after the parameter comma, skipped the parameter checks
  (`TEXT(58,\n42)` passed) and split a commented draft line, so `9);` appeared
  uncommented in a blocked review. Only a space may follow the comma now.
- **Review brief:** a multi-line summary could render a fake decision line and a link
  above the real decision. The summary now stays on the title line with link syntax
  escaped, and a target URN containing backticks gets a longer code fence.
- **DataHub capture:** one display name over 160 characters, or an owner name that was
  not text, failed the whole capture; display names are now shortened or treated as
  unknown. A target returned twice used the first match; it is now refused.

### DataHub scope

The capture bridge is tested with injected structured results, not a real tenant.
It binds the exact target identity, rejects error-marked data, keeps incomplete
metadata incomplete and does not relabel 30-day counts as exact weekly usage.
Unknown column paths stay unknown. The transport targets the MCP 2025-11-25
profile; live-tenant compatibility and the MCP 2026-07-28 lifecycle are not
claimed. The optional live CLI needs an explicit flag, a request file and local
credentials, and no automated check runs it.

### dbt scope

The dbt adapter is tested with one real manifest and catalog (dbt Core 1.12.6, DuckDB),
trimmed and committed with its [provenance](../examples/dbt/README.md), plus generated
manifests. `node scripts/trim-dbt-manifest.mjs --compare` showed that the trimmed files
give the same evidence revision as the full ones for all 30 targets. Manifests from
other dbt versions, adapters or dbt Cloud, and projects with model versions, contracts
or semantic models, were not run. Mutating the adapter (unknown usage read as zero, a
`not_null` test read as a constraint, the map check removed, exposures dropped, every
gap cleared) failed between two and nine tests each, and the two mutations that change
decisions also failed the benchmark check.

## Not covered

- A live DataHub tenant, model inference, catalog writes and SQL execution. None
  is enabled or tested.
- dbt manifests other than schema v12, and running dbt itself.
- Running the Docker image.
- An independent external code review, or security, accessibility or financial
  audits.

Build hashes detect byte changes; they are not signatures. The public build
contains only the allowlisted static files. SQLite files, test output,
`node_modules`, private metadata and credentials are excluded, and a DataHub capture
can contain private metadata, so never commit one.

## History

- **v2.0.0** merged through [PR #6](https://github.com/ult666666/lineageguard-datahub-agent/pull/6).
  Its [tagged verification record](https://github.com/ult666666/lineageguard-datahub-agent/blob/v2.0.0/docs/VERIFICATION.md)
  lists what was run for that release, and the [local record](verification/studio-2.0-local.json)
  lists its inputs and artifact hashes.
- **Added on `main` after v2.0.0:** the [local launcher](LOCAL_LAUNCH.md), the
  [Review Inspector](REVIEW_INSPECTOR.md), [saved-review comparison](REVIEW_COMPARISON.md)
  and the [dbt manifest source](ARCHITECTURE.md#dbt-manifest-integration-profile).
  Each guide describes its own checks.
