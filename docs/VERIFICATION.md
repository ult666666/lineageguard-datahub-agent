# Verification

GitHub Actions runs these checks on every pull request and every push to `main`.
The [workflow page](https://github.com/ult666666/lineageguard-datahub-agent/actions/workflows/tests.yml)
shows the latest results. CI uses synthetic data only, clears the DataHub URL and
token, and has no deploy or catalog step.

## What CI runs

[`tests.yml`](../.github/workflows/tests.yml) has two jobs:

| Job | Steps |
| --- | --- |
| Offline tests (Node 22 and 24) | `npm test`: the full Node suite, including a real interrupted process and SQLite recovery. `npm run mcp:smoke`: a read-only MCP handshake against a loopback fixture. `npm run studio:evaluate`: the named synthetic evaluations. `npm run build` and `node scripts/build-studio.mjs --verify dist`: the exact public file list and its hashes. |
| Studio browser workflows (Node 24) | `npm ci --ignore-scripts`, `npm run format:check`, then `npm run test:browser`: Chromium journeys in both the browser-session and durable-local modes, with external requests blocked. |

The test job also sets up Python 3.13 for the preserved Codex-skill tests.

## Run the same checks locally

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run mcp:smoke
npm run studio:evaluate
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
narrowing, pause, reload and resume, a source outage and its restoration,
cancellation, invalid input, the executed evaluations, and layouts at 390, 768 and
1440 pixels. The Review Inspector and saved-review comparison journeys also run
with networking disabled and check that nothing is uploaded and stored checkpoints
do not change. This is targeted accessibility testing, not a WCAG audit.

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

### DataHub scope

The capture bridge is tested with injected structured results, not a real tenant.
It binds the exact target identity, rejects error-marked data, keeps incomplete
metadata incomplete and does not relabel 30-day counts as exact weekly usage.
Unknown column paths stay unknown. The transport targets the MCP 2025-11-25
profile; live-tenant compatibility and the MCP 2026-07-28 lifecycle are not
claimed. The optional live CLI needs an explicit flag, a request file and local
credentials, and no automated check runs it.

## Not covered

- A live DataHub tenant, model inference, catalog writes and SQL execution. None
  is enabled or tested.
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
  [Review Inspector](REVIEW_INSPECTOR.md) and [saved-review comparison](REVIEW_COMPARISON.md).
  Each guide describes its own checks.
