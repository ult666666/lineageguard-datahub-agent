# LineageGuard Studio 2.0 — delivery guide

## Open the shipped work

- Studio: https://lineageguard-datahub-agent.vercel.app/
- Portfolio case study: https://ult666666.github.io/projects/lineageguard.html
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Verification: [VERIFICATION.md](VERIFICATION.md)
- Five-minute demo: [DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md)
- Threat model: [THREAT_MODEL.md](THREAT_MODEL.md)

Studio is an executable orchestration workbench, not a prerecorded trace. Choose a synthetic review, compose a registered workflow, observe dependent steps, inspect evidence, interrupt and recover a run, compare an alternative, and export its exact review package.

## Run the full local stack

Use Node 24. Node 22.13+ is also supported and covered by the Node 22 CI job. Application runtime dependencies are zero; Python 3 is needed only for the preserved skill tests.

```sh
git clone https://github.com/ult666666/lineageguard-datahub-agent.git
cd lineageguard-datahub-agent
npm run studio:local
```

Open `http://127.0.0.1:4183`. The local service runs the shared interpreter and persists checkpoints in `.lineageguard/runs.sqlite`. The directory is ignored by Git. Stop the foreground server with Ctrl+C; previously committed checkpoints remain available on the next start. Recovery of a genuinely interrupted run must wait for the old writer lease to expire. No persistent operating-system service is installed by these commands.

For a deliberate private storage location:

```sh
npm run studio:local -- --port=4183 --store=/absolute/private/lineageguard-runs
```

Do not put a tenant capture, database or run export in public source. The optional live-capture CLI is separate and requires an explicit flag, request file and locally configured credentials. No tenant connection is required to run Studio or its evaluations.

## What each surface proves

| Surface | Execution | Checkpoint location | Boundary |
| --- | --- | --- | --- |
| Published Studio | Actual shared interpreter; same-origin synthetic reads | Current isolated browser storage | Not a durable cloud worker or real tenant |
| Local Studio | Node service, same interpreter, SQLite transactions and writer leases | User-selected local directory | Single-host, not authenticated multi-user infrastructure |
| Evaluation laboratory | Named scenarios executed against the same rules/runtime | Test output or displayed results | Synthetic regression coverage, not real-world incident prediction |
| Classic demo | Preserved original scorer and API | Original request scope | Historical compatibility surface, not the Studio policy |

## A demonstration that shows the engineering

1. Run **Revenue field rename**. Inspect a completed node, its evidence envelope and the separation between compatibility risk and evidence readiness.
2. Run **Evidence-source outage**. Show the actual failed step. Restore the synthetic source and resume; the same identity advances to a new generation without treating the failed run as successful.
3. Run **Missing usage evidence** and **Numeric narrowing**. Explain why missing facts cannot be silently replaced by zero and why numeric-family membership is not a safe conversion rule.
4. Compare the rename with the additive alternative. The comparison explicitly identifies changed requests rather than presenting them as the same baseline.
5. Export the review, then execute the evaluations. The JSON includes binding, evidence, outputs and event history; it is not execution authorization.

## Reproduce release verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run mcp:smoke
npm run studio:evaluate
npx playwright install chromium
npm run test:browser
npm run build
node scripts/build-studio.mjs --verify dist
```

Build into a fresh checkout: `dist/` is deliberately not overwritten. The browser test creates only its own temporary local service, database and browser contexts. The restart test interrupts only its test-owned child.

After the exact application payload is deployed, the explicit command below verifies the real public site. It is not part of offline CI. It uses normal TLS verification, a fixed public origin, fresh unauthenticated browser storage, bounded synthetic API operations and no private credentials:

```sh
npm run verify:deployed
```

The verifier compares all 19 static files and the release manifest, exercises the serverless API and preserved classic API, then checks real browser execution, exports, changed-input invalidation, comparison, reload/resume, outage recovery, cancellation, evaluations and responsive layout. A report is written under `test-results/deployed-<timestamp>/` only after all checks pass. It records the source commit and whether the working tree was clean. A mismatched deployment fails instead of being called current.

## Explicit exclusions

No paid inference, autonomous LLM team, catalog mutation or SQL execution is enabled. A local acknowledgement is an unverified review note—not an organizational approval. SQLite durability is single-host, browser storage is not cloud persistence, hashes are not signatures, and Docker execution and real DataHub tenants were not validated in this release. Current deterministic fixtures are not a claim of production reliability or enterprise adoption.
