> **Studio 2.0:** the expanded runtime is documented in [Architecture](ARCHITECTURE.md), [Verification](VERIFICATION.md) and [Threat model](THREAT_MODEL.md). The original review guide below retains its historical scope.

# LineageGuard — engineering review guide

Start with the [live demo](https://lineageguard-datahub-agent.vercel.app/), inspect the source below, and reproduce the checks. The hosted demo uses synthetic metadata; it is not evidence of validation against a customer's live DataHub tenant.

## Read the implementation in order

| Concern | Source | What to inspect |
| --- | --- | --- |
| Request boundary | [`api/analyze.js`](../api/analyze.js) | HTTP method handling, JSON parsing, and the call into the agent. |
| Orchestration | [`src/agent.mjs`](../src/agent.mjs) | How the request and catalog context become review artifacts. |
| Deterministic decisions | [`src/impact-engine.mjs`](../src/impact-engine.mjs) | Breaking versus additive changes, severity, and generated guidance. |
| Catalog integration | [`src/catalog-adapter.mjs`](../src/catalog-adapter.mjs) | Separation of the mock catalog from the MCP-backed adapter. |
| MCP transport | [`src/datahub-mcp-client.mjs`](../src/datahub-mcp-client.mjs) | Initialization, tool calls, and response handling. |
| Portable review skill | [`score_change.py`](../skills/lineageguard-schema-review/scripts/score_change.py) | Explicit evidence fields and refusal of ambiguous boolean inputs. |

## Reproduce the public checks

Node.js 22 or 24 and Python 3.13 match the CI matrix. No package installation or paid service account is required for these commands.

```sh
npm test
npm run mcp:smoke
```

The complete suite currently has **23 distinct tests** across five files. The matrix replays the same tests on two Node versions; it does not double the number of unique tests.

| Public test file | Evidence covered |
| --- | --- |
| [`api-handlers.test.mjs`](../test/api-handlers.test.mjs) | Demo health, a runnable example request, and blocking the risky example. |
| [`impact-engine.test.mjs`](../test/impact-engine.test.mjs) | A high-impact breaking migration and a controlled additive field. |
| [`skill-scorer.test.mjs`](../test/skill-scorer.test.mjs) | Breaking changes, unknown evidence, controlled additions, and invalid boolean input. |
| [`datahub-mcp.test.mjs`](../test/datahub-mcp.test.mjs) | Local MCP initialization and the expected entity/lineage tool calls. |

[View current GitHub Actions results](https://github.com/ult666666/lineageguard-datahub-agent/actions/workflows/tests.yml). The workflow uses a loopback mock transport, clears tenant URL/token variables, and has no deploy or catalog-mutation step. A passing run verifies this bounded test suite, not production migration safety, exhaustive security, or live-tenant compatibility.

## Product and collaboration boundaries

Schema changes are reviewed, not executed. Migration SQL and catalog write-back remain proposals requiring an authorized human decision. The project's [README](../README.md#codex-collaboration) documents the owner's product decisions and AI-assisted implementation workflow; this guide does not imply unaided authorship or employment/client results.

## Generated-SQL input contract

The application validates change objects before asking the catalog for metadata, and the direct impact-engine entry applies the same contract before producing SQL suggestions. Unsupported operations, string-valued booleans, missing identifiers and statement/comment fragments in type positions are rejected rather than scored optimistically or silently rewritten. The current simple-identifier contract deliberately rejects quoted, whitespace-containing and punctuation-bearing identifiers; table names support up to four dotted segments.

`change-contract.test.mjs` covers those refusals, bounded change counts, direct-library use, unchanged valid inputs and accepted scalar/parameterized types. The type rule is a conservative lexical subset, not a complete SQL dialect or parameter-range validator. SQL remains a human-reviewed suggestion; no migration is executed.

Input validation produces a stable copy of each SQL-relevant value. Later catalog awaits, prototype values, or repeat getter reads cannot silently change the values used for a migration suggestion. The original request object is not modified.
