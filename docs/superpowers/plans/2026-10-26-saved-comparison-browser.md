# Saved-review browser comparison implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans natively, then one fresh whole-branch review. The user delegated routine implementation and shipping and requested continued substantive AI-tools work.

**Goal:** Let browser visitors compare two saved completed review exports locally through the existing semantic inspection and comparison rules.

**Architecture:** Move the existing byte comparison into the browser-safe core with a native compatibility re-export. A separately mounted DOM surface owns file selections and a single asynchronous generation, shows a shared report, and never touches live runtime/store state.

**Tech Stack:** Existing native ES modules, Node22.13–24 tests, DOM/File APIs and pinned Playwright; no new dependency or service.

**Spec:** docs/superpowers/specs/2026-10-26-saved-comparison-browser-design.md

## Global Constraints

- Same compareReviewBytes(left,right,{now=Date.now()}) and lineageguard.review-comparison/1 report; both inputs inspected/completed first, sourceAuthenticated/executionAuthorized/resumableImport false and toolCalls0.
- Two selected JSON files, each1–4,000,000bytes; explicit Compare, no automatic runs. One active left-then-right read sequence. Generation invalidates after either selection change or Clear; check it after every await. Active old work settles before a new sequence starts.
- Compare disabled without both files or while active; download disabled except for a current successful report. Clear empties both files/results immediately. Inputs/Clear stay usable while reading. TextContent only for supplied strings; no runtime/history/storage writes, uploads, API/provider calls, new dependencies or version changes.
- Visible separate recorded/current judgments, same-request/recipe/source flags, hashes/IDs/policies/calls/gaps, one inspection time, privacy and unauthenticated scope. Existing live controls/Inspector stay intact.
- Explicitly whitelist only the two new public modules; preserve existing static byte/no-overwrite guards. Existing Node134tests/19evals/31browser journeys remain passing; actual public artifacts verified after exact reviewed green merge.

## Review Focus

1. A failed/malformed right export must not expose a partial valid-left comparison or stale old download (Tasks1/2 both-side real failures).
2. Replacing a selection or clearing during a pending read must not resurrect success, read the obsolete second file, overlap new reads or leave controls stuck (Task2 deterministic deferred File barrier).
3. Old favorable recorded decisions must remain distinct from current stale assessments and alternative requests must stay explicit (Tasks1/2 actual semantic reports).
4. Supplied summaries/IDs may contain hostile HTML and long unbroken text; DOM must remain inert/wrapping and exports must clearly disclose private supplied summaries (Task2 real DOM and390/768/1440/zoom).
5. Saved exports must never mutate live run/checkpoints or contact a source/API, including durable-local mode (Task2 offline requests/storage/run-identity assertions).

### Task 1: One portable validated comparison core

**Files:** public/studio/core/review-comparison.js (new); src/studio/review-comparison.mjs (compatibility re-export); test/studio/review-comparison.test.mjs.

**Interfaces:** consumes existing inspectReviewBytes/compareRuns/StudioError; produces compareReviewBytes with the exact current signature/result and both-input byte ownership before awaits. The old native import must refer to the identical function.

- [ ] Add `browser-safe and native entrypoints share the identical inspected comparison function`; dynamically import the new module, assert it exports a function and its identity equals the native entrypoint. Preserve all existing seven real semantic/ownership/error cases.
- [ ] Run `node --test test/studio/review-comparison.test.mjs`; Expected: new browser entrypoint assertion FAIL, existing tests pass.
- [ ] Move the existing implementation without semantic edits; fix only relative core imports and re-export the native path.
- [ ] Run focused tests then `npm test`; Expected: all pass (135tests). Commit.

### Task 2: Actual offline browser surface and lifecycle

**Files:** public/studio/saved-comparison-view.js (new); public/index.html; public/studio.js; public/studio.css; scripts/build-studio.mjs; package.json format scope; scripts/saved-comparison-browser.cjs (new); scripts/studio-browser.cjs.

**Interfaces:** mountSavedComparison() uses IDs saved-left-file,saved-right-file,saved-compare,saved-download,saved-clear,saved-result,saved-status,saved-badge. Consumes the shared byte function only; keeps no exported mutable report/controller API. Test helper exports async savedComparisonBrowser(page,{file,evidence,mode}) and is called in both existing harness modes after Inspector checks/before live alternative comparison.

- [ ] Write a real browser helper asserting the panel exists, explicit selection/button states and a valid standard/strict comparison; call it in the existing journey. Run `npm run test:browser`; Expected: missing left file input assertion FAIL, existing earlier journey steps pass.
- [ ] Before view implementation, extend the helper with actual generated fixture bytes, shared-report download equality at downloaded inspectedAt, alternatives/same-file, stale evidence, both-side invalid UTF8/duplicate/oversize/incomplete/rehashed projection cases, hostile summary text and current-state snapshots.
- [ ] Add deterministic pending-read barriers: Clear before first read resolves leaves empty/no download and does not read old right; selection replacement invalidates success, keeps one sequence and later permits current pair. Always release barriers/restore File.prototype in finally; no fixed sleep. Offline request list and full localStorage/current identity must remain unchanged.
- [ ] Implement mountSavedComparison, static panel and wrapping styles. Generation++ on selection/Clear; capture both File references at click, validate sizes before reads, one active flag, check ticket after each await/core comparison and in completion. Render a labelled result region and short status; download JSON.stringify(report,null,2)+'\n' only from current report.
- [ ] Mount once, add the two modules to PUBLIC_FILES and explicit formatting paths. Run browser helper/full journey, npm test, npm run studio:evaluate, npm run format:check. Expected: both modes/new checks and all old tests/evaluations pass. Commit.

### Task 3: Maintained guide, release verification and shipping

**Files:** README.md; docs/REVIEW_COMPARISON.md; docs/REVIEW_INSPECTOR.md; scripts/studio-deployed.cjs only if needed to cover the new public consumer.

**Interfaces:** browser uses the same report/current-time semantics as CLI; canonical CLI path remains unchanged. Public inventories/build bytes and deployed verifier must include the new modules without broadening release file selection.

- [ ] Document Compare tab → two exports → Compare → report/download/Clear, synthetic standard/strict/alternative walkthrough, privacy, current-time/unauthenticated scope, unchanged current run/storage, already-loaded offline requirement and single-read cancellation bound. No fabricated independent-policy/authentication/deployment claim.
- [ ] Build into a new explicit owned destination using existing buildStudio; verify exact inventory/digests, run read-only MCP smoke and fresh archive consumer without dependencies. Expected: all pass, bounded artifacts only.
- [ ] Run final full unit/evaluation/format/browser/static checks. Generate whole-branch review package from924e985..exactHEAD, dispatch one fresh independent reviewer, resolve Important findings by actual RED/GREEN and full checks; ledger all declined scope/minors.
- [ ] Attach PR, read hosted checks through connector tools, merge only exact reviewed green head; verify actual public source/build and browser behavior. No CLI CI reads, permission expansion, paid calls or unrelated worktree changes. Save exact-source/source-manifest/review/output checkpoint and actual-effort ledger. Preserve old checkpoints and clean only this plan's owned review scratch.
