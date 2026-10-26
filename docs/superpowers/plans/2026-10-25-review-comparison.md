# Validated Review Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. The user delegated routine design/execution and the heartbeat specifies this bounded milestone; do not stop for repeated approval.

**Goal:** Compare two saved exports only after both pass the existing semantic inspector.

**Architecture:** Owned bounded byte snapshots compose unchanged inspection and comparison contracts. A native CLI reuses the current safe file reader and emits scoped stdout only. No UI/static payload/store/adapter is added.

**Tech Stack:** Existing Node22.13–24 ESM, node:test, pinned repository tools.

**Spec:** `docs/superpowers/specs/2026-10-25-review-comparison.md`

## Global Constraints

Max4,000,000 bytes per input. One inspection time for both. No network/tools/stores/writes/approval/execution. Existing compareRuns/inspector semantics unchanged. Sanitized errors; source summaries only in successful stdout. Different requests are permitted and labelled. Existing static allowlist/production UI unaffected. Preserve current965e1de main and concurrent work.

## Review Focus

- Right-hand tampering must refuse all comparison output, not leave a successful left result.
- Input byte mutation during asynchronous hashing must not change the compared snapshot.
- Recorded decisions and inspection-time freshness must remain separately labelled.
- Valid but incomplete exports must not be treated as completed comparisons.
- CLI failure paths must not disclose supplied summaries/paths, open FIFO/stores or change files.

### Task1: Validated comparison API

**Files:** create `src/studio/review-comparison.mjs`, `test/studio/review-comparison.test.mjs`.
**Interfaces:** `compareReviewBytes(left:Uint8Array,right:Uint8Array,{now=Date.now()}={})` resolves `{schema:'lineageguard.review-comparison/1',inspectedAt,inspections:{left,right},comparison,scope,sourceAuthenticated:false,executionAuthorized:false,toolCalls:0,resumableImport:false}`. Inspector errors retain stable code plus `side`; incomplete returns COMPARISON_NOT_READY with side. comparison is unchanged compareRuns output.

- [ ] Write actual-run tests for same request/strict recipe, different requests, stale current evidence, both-side tampering/malformed/oversize, incomplete and owned bytes. Observe missing API RED.
- [ ] Implement bounded snapshots, two inspections at one time, completion gating and unchanged compareRuns. Run tests then full npm test; commit.

### Task2: Native two-file command

**Files:** extract `scripts/lib/review-file.mjs` from `scripts/studio-inspect.mjs`; create `scripts/studio-compare.mjs`, `test/studio/comparison-cli.test.mjs`; update package/format command, README and `docs/REVIEW_COMPARISON.md`.
**Interfaces:** shared `readReviewFile(name)` returns safely read Uint8Array with existing reader limits. CLI `--left=`, `--right=`, optional `--json`, standalone `--help`; exit0 success/help or2 failure. Error JSON `{schema:'lineageguard.comparison-error/1',valid:false,code,side,message,sourceAuthenticated:false,executionAuthorized:false,toolCalls:0,resumableImport:false}`; side is left/right/null. stdout is the only output.

- [ ] Write real CLI tests for valid machine/text/same-file results, invalid args, both-side corruption/nonregular/linked/large inputs, no paths/private-canary leaks and unchanged files/cwd. Observe missing command RED.
- [ ] Extract the unchanged existing reader, implement command and add scripts/docs. Run old inspector CLI plus new/full suite/evaluations/format/fresh build/browser. Commit.
- [ ] Independent whole-branch review, repair with real RED/GREEN, reconcile current main, attach PR and merge only exact reviewed green head. Verify public source.
- [ ] Add the shipped CLI/guide to current portfolio Lineage catalog route, preserve design/inventory; full tests/browser/review/green shipping/public verification. Save exact sources/outputs/receipts and actual effort ledger.

## Pre-flight

Task1 API feeds Task2 CLI; byte reports and error side agree. Shared reader extraction is covered by existing inspector tests. Task-owned isolated branch begins clean965e1de with no open PRs; routine user-delegated native execution with one fresh final reviewer. No other implementation agents.
