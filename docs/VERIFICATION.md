# Studio 2.0 verification

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
