# Studio 2.0 architecture and run semantics

## Product contract

A review is a reproducible decision artifact, not a command to mutate a system. The input is a bounded data-change request and a typed recipe. The output separates compatibility risk, evidence readiness and a review-only artifact package. The public application has no model credentials, tenant credentials, migration executor or arbitrary tool registry.

## Component graph

```text
Request + recipe
       │
       ▼
Strict data snapshot ──► DAG compiler ──► binding identity
                                 │
                                 ▼
                         Resolve exact target
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
              Schema          Lineage         Usage / owners
                 │               │               │
                 ▼               ▼               │
           Compatibility   Optional paths        │
                 └───────────────┼───────────────┘
                                 ▼
                     Evidence and risk policy
                                 │
                                 ▼
                     Bound review-only artifacts
```

The compiler computes topological levels from actual dependencies. The visual graph is rendered from that compiled result. It rejects unknown operations, duplicate nodes, missing required evidence dependencies and cycles. The registry is fixed code, not dynamically supplied executable functions. Independent tool reads can run concurrently; deterministic analysis and policy wait for their declared inputs.

## Identity and data contracts

`contract.js` snapshots bounded plain JSON without calling getters or `toJSON`. It rejects poison keys, cycles, symbols, hidden fields, unsupported numbers and extended/sparse arrays. The request validates simple SQL identifiers and an intentionally conservative scalar type subset. The recipe limits concurrency, retries, calls and deadlines.

A run binding hashes the normalized request, complete recipe, source mode and revision, scenario context, policy version and application version. Each completed output has its own digest. Evidence envelopes contain the exact target, evidence kind, observation time, source identity, completeness and typed data. The whole checkpoint has a checksum, and events form a hash-linked chain.

These hashes detect corruption and accidental mismatches. They do not authenticate a source or defend against an attacker able to rewrite the whole browser/local record. There is no server endpoint for accepting an arbitrary imported run as authority.

## Execution state machine

A new run begins as `created`. An execution generation moves it to `running` and may settle as `completed`, `paused`, `failed` or `cancelled`. Each registered step is `pending`, `running`, `completed`, `failed` or `cancelled`.

A serialized commit queue changes state, appends an event, computes the checkpoint checksum and awaits persistence. Work is not dispatched past a failed checkpoint write. The interpreter does not emit a success result merely because an HTTP request returned or because a process disappeared.

Tool operations have a read-call budget and bounded retry count. Only declared transient source errors and timeouts are retried. Every attempt is counted. A run deadline and per-step deadline use cancellation signals plus a bounded promise race. A late tool result cannot become completed evidence after cancellation. The call budget counts logical evidence-adapter invocations, not TCP packets, protocol initialization or every underlying MCP request.

The default recipe allows concurrency 3, 12 logical read calls and one retry per read. Users may lower or adjust values only within the compiler's hard limits. Deterministic and policy steps do not consume evidence calls. A pause before policy waits until running reads settle; it is a checkpoint boundary rather than a claim that JavaScript execution was suspended mid-statement.

## Recovery and valid reuse

Resume preserves the run ID and increments its generation. It verifies the complete checkpoint, binding, event chain and output digests before dispatch. Source-revision changes require a new review. Previously running, failed or cancelled steps are reset. Completed tool outputs are reused only while current under the selected policy's freshness limit. Invalidated outputs invalidate their dependent steps transitively.

The read-call budget is cumulative across generations. Resume is not a way to replenish a depleted budget. A restored synthetic source changes its availability, not its evidence revision; this makes outage recovery demonstrable without silently substituting a different data snapshot.

The local UI waits for the new execution generation after a resume request. A `202 Accepted` response may precede its first durable state transition; returning the old paused checkpoint is not proof that the resumed generation finished. A browser regression reproduced and closed this race.

## Two persistence implementations

**Browser session.** One localStorage value holds up to six verified runs. A write checks the previously read value, takes a Web Lock where supported, then performs one set/read-back operation. Corrupt data is preserved and surfaced, not silently deleted. Quota failures stop progress. Another tab's change produces a conflict and requires reload. Without Web Locks, the fallback comparison is cooperative rather than a cross-process atomic transaction. Browser storage can be cleared or unavailable, so the UI labels this mode explicitly and supports exports.

**Durable local service.** Native SQLite stores a payload, monotonic revision counter, writer lease and update time. WAL mode and `synchronous=FULL` are used. A transaction bounds record count at creation. Saves require the expected revision, matching writer and an unexpired lease. After lease takeover, the old writer cannot commit. Admission reservations prevent simultaneous asynchronous starts from exceeding the local active-run limit or creating phantom accepted runs. This is a single-host coordinator that trusts its clock and local filesystem, not a distributed queue or authenticated multi-tenant service.

A local process interruption leaves the last committed checkpoint. Recovery is explicit after the prior lease expires. The process-recovery test interrupts only its own test child and then verifies the same ID, a new generation, reused completed evidence and no false terminal success.

## Evidence policy

Compatibility is not an opaque composite score. Drops, required additions without validated backfill, numeric narrowing, unsupported conversions, source-schema mismatches and nullability tightening are blocking findings. Renames and supported widening require review. An optional additive field can proceed only with explicit validation checks and adequate evidence.

Evidence readiness is independent: missing, stale, future-dated or incomplete required observations and missing owners prevent readiness. The stricter policy uses a shorter freshness window and requires explicit column paths. A partial lineage response never proves zero consumers. The graph shows supplied relationships only; flat reachable-asset results are not relabeled as exact graph edges.

The artifacts use validated identifiers and types. Unsupported or blocked operations are omitted or commented. SQL remains a dialect-specific review draft, not a verified migration or atomic rollback transaction. A local acknowledgement binds the current review but sets `executionAuthorized=false` and labels its identity `local-unverified`.

## DataHub integration profile

The MCP client implements the explicitly tested 2025-11-25 handshake profile, including initialization, session identifiers and tool execution. It binds JSON-RPC response IDs, distinguishes protocol errors from tool errors, enforces deadlines and response sizes, refuses redirects and constrains tools to an explicit read-only list. MCP 2026-07-28 has a different stateless lifecycle and is not claimed compatible.

The optional Studio CLI captures `get_entities` and `get_lineage` once, then runs against an immutable hash-bound capture. It does not hide repeated live reads inside the DAG. Only recognized scalar schema metadata and exact seven-day usage become complete evidence; 30-day usage is not automatically relabeled as exact weekly activity. Unknown column paths stay unknown. This bridge is tested with injected structured tool results. No real tenant was connected or validated for the Studio release.

## Repository and deployment boundaries

The stateless hosted API accepts only bounded compile, synthetic read and evaluation operations. It does not expose the SQLite service, filesystem paths or arbitrary network URLs. The local durable API binds loopback and checks Host/Origin before writes. Static publishing uses an exact file inventory; tests, SQLite databases, credentials and private artifacts do not enter the site build.

CI executes the core suite on Node 22 and 24, then the actual browser workflows and static-build checks on Node 24. CodeQL and secret scanning supplement these checks; none constitutes an absolute security guarantee. The original classic UI and portable skill remain available with explicitly historical scope.
