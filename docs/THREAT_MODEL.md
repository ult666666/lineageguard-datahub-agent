# Studio 2.0 threat model

## Protected boundaries

| Boundary | Threat | Implemented control | Residual limit |
| --- | --- | --- | --- |
| Workflow input → interpreter | Unregistered capabilities, cycles, missing dependencies, unbounded work | Strict JSON snapshot, fixed registry, compiler, hard budgets | Trusted maintainers can still change the registry source |
| Tool transport → evidence | Wrong response ID, tool error mistaken for success, oversized or hanging response | Exact JSON-RPC binding, error classification, byte/time bounds, read-only allowlist | Tested MCP profile only; no live-tenant validation |
| Catalog result → policy | Missing data treated as zero, partial lineage treated as complete, broad type-family shortcuts | Typed completeness, freshness and target checks; explicit compatibility rules | Metadata truth ultimately depends on its provider |
| Async run → checkpoint | Late result after cancellation, overlapping writers, failed storage hidden as success | Serialized awaited checkpoints, abort checks, revision CAS, leases and admission reservations | Single-host clock/filesystem are trusted; no distributed consensus |
| Browser state → result | Another tab overwrites work, corrupt or quota-limited storage | Last-value conflict detection, Web Locks when available, checksums, surfaced errors | Browser owner can rewrite all state; hashes are not signatures |
| Draft → execution | A recommendation or acknowledgement mistaken for permission | No mutation/execution capability; bound unverified notes; explicit UI limits | Users can manually copy a draft outside the tool |
| Repository → public hosting | Local DB, private files or credentials accidentally deployed | Exact public-file inventory, `.gitignore`, byte verification, staged secret scanning | Reviewed allowed files still need content review |

## Public service

The public API serves only synthetic data and deterministic computations. It cannot receive a tenant URL, credential, executable function, filesystem path or SQL-execution request. The request, run and evaluation workloads have bounded sizes and fixed capabilities. Hosting-platform abuse controls remain relevant: this application does not claim a globally coordinated rate limiter.

Same-origin browser requests, restrictive content policy, no external runtime scripts/fonts, safe text rendering and nonpersistent serverless semantics keep the demonstration small. There is no public user-account system. Do not interpret the absence of authentication as a claim that the local durable API is ready for internet exposure.

## Local service and private data

The SQLite service is bound to `127.0.0.1` and validates Host/Origin. Run identifiers cannot select filesystem paths. Database and ancestor links are rejected, including dangling links. Database records are bounded, checked on read and written with optimistic revisions and leases. Storage files use private permissions.

A hostile same-user process, administrator, compromised browser origin or modified trusted source is outside this security boundary. The path checks are not a kernel sandbox or a comprehensive defense against a malicious filesystem owner racing every operation. System-clock changes can affect lease timing. Do not expose the local server using a public tunnel or bind it to a public interface without a separate authenticated deployment design.

The optional live DataHub capture is an explicit local CLI action. Credentials come from the invoking environment and are not logged or included in the run export. Returned catalog names and evidence can still be sensitive: exported tenant reviews belong in private storage and must not be committed. The hosted Studio never invokes this path.

## Release and incident handling

Keep secret scanning, push protection, private vulnerability reporting, dependency checks and CodeQL enabled. If a real credential is disclosed, revoke it first; deleting a file is not credential rotation or history erasure. Do not dismiss a scanner result solely to make a badge green.

Report security issues privately through the repository's Security tab. Include the affected version, expected and observed behavior, and a minimal synthetic reproduction. Never post tokens, private schemas, catalog exports or personal data in a public issue.

This threat model describes implemented and explicitly limited controls. It is not a penetration-test certificate, enterprise deployment approval or guarantee of perfect security.
