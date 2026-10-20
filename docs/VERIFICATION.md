# Studio 2.0 verification

## Review Inspector follow-up — 20 October 2026

The Inspector adds 19 core/CLI tests to the launcher-era 101-test suite: **120 Node tests passed**. The browser suite now passes **31 journeys** across browser-session and durable-local modes. It verifies inspection with networking disabled, zero initiated requests and unchanged checkpoint storage; refusal of tampering/oversize data; no stale report after a new file or Clear; responsive layout; and refusal to export a rehashed inconsistent SQL draft. The original **19 evaluation assertions**, MCP smoke and formatter pass. The exact public inventory now contains **21 files plus its manifest**, explicitly including both Inspector modules. These layers overlap and are not summed as independent tests.

A source-level baseline demonstrated that the old checksum verifier accepted a result projection changed after recomputing the outer checksum. A real browser regression then downloaded the inconsistent draft with the old export check; the new semantic export check refused it. Core tests also change policy, evidence target/mode/digest and regenerated artifacts. A time-window regression proves policy can be consistent at an internal freshness transition even when neither endpoint matches. CLI tests preserve input bytes and refuse links, special files and oversized input. Browser tests first found a narrow-screen min-content overflow, traced to the existing table minimum; the scoped Inspector layout correction passes the same 390/768/1440 checks.

The shared Inspector has no network, catalog, model, store-write or resume capability. It is replay consistency using the same deterministic functions, not independent source validation or authentication. The report explicitly sets `sourceAuthenticated=false`, `executionAuthorized=false`, `toolCalls=0` and `resumableImport=false`. See [REVIEW_INSPECTOR.md](REVIEW_INSPECTOR.md). The original engine, policy, API, SQLite service/store and checkpoint schema are unchanged. Hosted acceptance and the user's local installation are separate final gates recorded after publication; no independent external reviewer is claimed.

## Local launcher follow-up — 20 October 2026

The post-release launcher change preserves application/policy version 2.0.0 and every public runtime asset. It adds 17 focused launch checks to the preserved 84-test application suite: **101 Node tests passed**. The same 24 browser journeys, 19 evaluation assertions, original MCP smoke, formatting, exact 19-file static payload and 17 hosted acceptance sections were rerun successfully. These are overlapping layers, not a summed count of independent tests.

A real duplicate-start regression failed against the original CLI: it threw `EADDRINUSE` after attempting to initialize an unused store. The corrected CLI identifies the existing service through bounded read-only metadata. The regression leaves an actual paused run unchanged and does not create a database in the second working directory. Other cases cover unrelated/redirecting/oversized/unfinished responses, mode/version mismatch, explicit-store refusal, stopped status, invalid options, opener failure, an injected bind race and actual foreground restart with an exact preserved checkpoint. An inconclusive connection is not labeled occupied or free.

Status is not process authentication or a database integrity audit. No automatic listener termination, port change, database deletion, paid inference or migration was added. See [LOCAL_LAUNCH.md](LOCAL_LAUNCH.md). The original v2.0.0 tag and its historical 84-test release evidence are not rewritten; follow the launcher-update commit on main for the added commands. Final cloud CI and native-desktop observations are recorded separately after publication. Review comprises direct source inspection, demonstrated regressions and automated checks; an unavailable independent reviewer is not claimed.

## Publication verification — 20 October 2026

The application implementation merged through [PR #6](https://github.com/ult666666/lineageguard-datahub-agent/pull/6) at `a37c3bc5bc586bd8f7f49a6f6e4fbe856dbb9336`. A fresh checkout passed all 84 Node tests, the 24 browser journeys in both runtime modes, the 19 evaluation assertions, the original MCP smoke, formatting, and the exact 19-file static build. This rerun includes the real test-owned process interruption and SQLite recovery; it is not inferred from the public browser.

The published origin returned Studio version 2.0.0 with browser-session mode and model inference, catalog writes and SQL execution all disabled. The new opt-in `npm run verify:deployed` command passed 17 acceptance sections, including every static asset and manifest byte, serverless compilation and refusal cases, the classic API, verified exports, real UI execution, input invalidation, comparison, browser reload/resume, source-outage recovery, cancellation, executed evaluations and three responsive widths. No external runtime request or JavaScript page error was observed. A deliberately changed expected manifest caused an assertion failure before any passing verification report; the original local build was restored afterward.

This is live verification of a synthetic demonstration, not live-tenant validation. The command records source commit, working-tree cleanliness, output hashes, timestamp and scope under `test-results/`. The final tagged release carries the clean-source verification record and source-package checksums separately from this documentation. Follow the [delivery guide](RELEASE_2_0.md) to reproduce it.

The portfolio and profile updates are [portfolio PR #4](https://github.com/ult666666/ult666666.github.io/pull/4) and [profile PR #3](https://github.com/ult666666/ult666666/pull/3). Their source review preserves the concurrently updated fintech project and original project history. Portfolio verification is a separate suite: 37 Python tests, its real staged browser suite including 56 navigation checks, and the 28-file static inventory.

## Local implementation verification — 19 October 2026

These results were executed against the Studio 2.0 candidate derived from public base `0ca61b69ce401ff5e0d87d78f8d3ddbf95da4585`. CI, hosted deployment and source publication are separate gates; their final commit and subsequent evidence belong to the release record, not an inferred local success.

| Layer | Executed result | Reproduce |
| --- | --- | --- |
| Full Node tests, including preserved classic tests | **84 passed; 0 failed** | `npm test` |
| Actual browser workflows in browser-session and durable-local modes | **24 journey checks passed; no page errors** | `npm run test:browser` |
| Named synthetic evaluation assertions | **19 passed; 0 failed** | `npm run studio:evaluate` |
| Public static build | **19 allowlisted files plus the release manifest** | `npm run build` and `node scripts/build-studio.mjs --verify dist` |
| Formatting | Current implementation passes the pinned formatter | `npm run format:check` |
| Read-only MCP transport smoke | Successful initialization and two read tools against an ephemeral loopback fixture | `npm run mcp:smoke` |

The counts are separate, overlapping verification layers—not a summed claim of independent tests. The browser suite checks the actual UI in both modes, not screenshots alone. It runs with external requests blocked and uses fresh test-created storage. The source-bound [local record](verification/studio-2.0-local.json) identifies inputs and artifact hashes.

## Regressions demonstrated before repair

The MCP client accepted unrelated response IDs, ambiguous result envelopes, unimplemented protocol negotiation and error-marked tool output. It exposed remote errors and could substitute a different mock target. Those behaviors have dedicated failing-baseline regressions and corrected tests.

Runtime tests cover actual parallelism, dependency ordering, retry accounting, source outages, cancellation, per-step deadlines, total budgets, checkpoint-write failure, source-revision changes, modified output digests and event-chain corruption. Recovery reuses only valid completed evidence. Changed requests cannot retain old acknowledgements.

Additional adversarial tests first reproduced a dangling database symlink, asynchronous run-admission races, invalid decimal precision/scale and an acknowledgement that did not bind exact result evidence. The corrected store refuses dangling links, reserves capacity before asynchronous admission, and fences obsolete writers. The corrected acknowledgement binds run ID, generation and result digest, and rejects expired evidence.

A further request-boundary regression rejects batches with duplicate fields or conflicting rename targets before artifact generation.

The local UI's resume check initially returned the prior paused checkpoint before the next generation began. The browser regression reproduced this; it now waits for the new generation before interpreting a terminal state.

## Durable recovery is exercised, not inferred

`test/studio/process-recovery.test.mjs` creates a child process and a temporary SQLite directory, waits for a real committed checkpoint, interrupts that test-owned process, and reopens the database. It verifies that the stored state remains running rather than falsely complete, refuses a premature lease claimant, then resumes after the prior lease expires. The recovered run has the same ID, a new generation, checked reused evidence and correct logical call accounting.

This proves a bounded single-host recovery path. It does not establish distributed durability, resilience to disk corruption or authenticated multi-user coordination.

## Browser coverage

Each runtime mode exercises a completed review, evidence inspection, verified JSON export, actual additive-plan comparison, input invalidation, missing usage, numeric narrowing, pause/reload/resume, outage/restoration, cancellation, invalid input, executed evaluations and responsive layout at 390, 768 and 1440 pixels. Node activation and view selection use native buttons with explicit accessibility state. This is targeted accessibility testing, not a WCAG certification.

Browser-session checkpoints remain in the current browser. Durable-local checkpoints belong to SQLite. No browser screenshot or API response is used to claim the public preview has a durable cloud worker.

## DataHub scope

The new immutable-capture bridge is tested with injected structured results, not a real tenant. It binds exact target identity, rejects error-marked data, preserves incomplete metadata and does not relabel 30-day counts as exact weekly usage. Flat reachable assets do not become invented direct lineage edges; unknown column paths remain unknown.

The transport targets the explicit MCP 2025-11-25 profile. Live-tenant compatibility and the different MCP 2026-07-28 lifecycle are not claimed. The optional live CLI requires an explicit flag, a request file and locally configured credentials; it was not invoked during this build.

## Release boundaries

The public artifact contains only the reviewed static inventory. SQLite files, test outputs, node_modules, private metadata and credentials are excluded. Build hashes detect byte changes; they are not signatures. The optional catalog capture can contain private metadata and must not be committed.

Docker image execution has not been verified in this release. No paid inference, autonomous LLM operation, catalog write or SQL execution has been tested or enabled. Independent external financial, security or accessibility audits are not claimed. Review consists of source inspection, reproduced regressions, executed local tests and the subsequent automated CI/security checks identified in the release.
