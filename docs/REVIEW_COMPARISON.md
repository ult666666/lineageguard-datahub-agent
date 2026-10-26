# Compare two saved reviews offline

The **Compare → Compare saved reviews** browser panel and native `studio:compare` command validate **both** saved JSON exports using the existing [Review Inspector](REVIEW_INSPECTOR.md), then applies Studio's existing `compareRuns` to their recorded results. They share one byte-validation/comparison function and the same JSON report. They do not rerun evidence tools or import packages into history. The browser panel is separate from the existing live alternative-plan controls. The native command requires Node22.13–24, with no package installation, service, database, tenant or API credentials.

## In the browser

1. Open **Compare → Compare saved reviews** in the hosted or local Studio. A current review is not required.
2. Select **Left exported review JSON** and **Right exported review JSON**, each 1–4,000,000 bytes. Selection alone does not start a comparison.
3. Choose **Compare saved exports**. Both files must pass inspection and be completed reviews. A malformed right file produces a refusal, never a partial left result.
4. Read the request/recipe/source-revision flags, recorded decisions and gap changes. Each side separately shows the current assessment of its embedded evidence at the shared displayed inspection time.
5. **Export comparison JSON** downloads the same `lineageguard.review-comparison/1` report as the CLI. It includes supplied request summaries and run identifiers; keep private files and reports local. The interface renders supplied text literally.
6. Changing either selection immediately discards the old result/download. **Clear saved comparison** also empties both file inputs. Neither changes the active workflow or saved checkpoints.

The already-loaded panel works offline; loading Studio still needs its hosted/local application. There is no service worker or offline installation. Only one left-then-right file-read sequence can run. Clear or a selection change invalidates pending work immediately, but the browser's `File.arrayBuffer()` read itself is not abortable: a new comparison waits for that one sequence to settle. An obsolete left read never starts the obsolete right read. No files are uploaded, stored, imported or executed, in either browser-session or durable-local mode.

Generate the synthetic standard/strict files below, select them in that order, and expect the same decisions and flags as the command. Selecting the same file on both sides is allowed. The synthetic rename export below demonstrates an explicitly labelled alternative plan.

## A reproducible synthetic pair

From the repository root, create two **new** export paths with the existing fixture runner. The generator refuses existing output files; choose fresh names when repeating the example.

```sh
npm run studio:review -- --scenario=safe-add --profile=standard --output=./.lineageguard/comparison-standard.json
npm run studio:review -- --scenario=safe-add --profile=strict --output=./.lineageguard/comparison-strict.json
node scripts/studio-compare.mjs --left=./.lineageguard/comparison-standard.json --right=./.lineageguard/comparison-strict.json
```

For these fictional inputs, the recorded standard decision is `proceed-with-checks` and strict is `review-required`. The request and source revision are the same; recipes differ. These are policy demonstration results, not organizational approval. Repeated execution creates different run IDs/timestamps, while the comparison's meaning remains the same.

Use the direct Node entrypoint above for the sanitized stdout contract. Plain `npm run studio:compare` prints an argument banner, including supplied paths, before the script starts; do not use that unsilenced wrapper for private refusal receipts. The optional `npm --silent run studio:compare -- ... --json` wrapper suppresses the banner. To consume one JSON object directly:

```sh
node scripts/studio-compare.mjs --left=./.lineageguard/comparison-standard.json --right=./.lineageguard/comparison-strict.json --json
```

The native command writes only stdout. It does not create an output file. Successful JSON intentionally contains supplied request summaries, run identities, bindings, recorded decisions/gaps and inspection hashes/checks. Choose any redirected destination accordingly. Failure reports do not echo supplied file contents, private paths or raw exception text.

Different requests remain permitted and explicitly labelled **alternative-plan comparisons**. They are not repeated results on identical inputs:

```sh
npm run studio:review -- --scenario=rename --output=./.lineageguard/comparison-rename.json
node scripts/studio-compare.mjs --left=./.lineageguard/comparison-standard.json --right=./.lineageguard/comparison-rename.json
```

## Read the result

- `comparison.sameRequest`, `sameRecipe` and `sameSourceRevision` retain the existing comparison semantics. The `left`/`right` decisions, risk, gaps, call counts and policy names are **recorded** values from the inspected exports. `addedGaps`/`removedGaps` are differences in those recorded gap sets.
- `inspections.left` and `inspections.right` separately report integrity/consistency, SHA-256 of the exact supplied bytes, completion and the **current assessment of embedded evidence at one displayed inspection time**. Evidence may now be stale even when its recorded decision was favorable. The comparison never replaces recorded decisions with current ones.
- Exit **0** means two internally consistent completed packages could be compared, including alternative requests. It does not establish authenticity, current catalog truth, approval or safety to migrate. Standalone `--help` also exits0. Exit **2** means arguments, reading, inspection or completion were refused; error `side` identifies left/right when applicable, with no comparison result.
- A paused/failed but internally consistent package can be inspected on its own; comparison requires completed reviews on both sides. A corrupted right package cannot leave a successful partial comparison of the left.

Human output shows recorded decisions, current assessments, comparison flags, gap counts and both file hashes without printing untrusted request summaries into the terminal. JSON escapes supplied strings. Identical file paths are permitted; each is safely read and inspected. Whitespace-different valid JSON may have different file hashes without changing request/recipe meaning.

## Bounds and trust

Each native CLI input must be an existing regular unlinked file,1–4,000,000 bytes. The browser receives user-selected `File` snapshots and does not claim to inspect filesystem links or paths. The shared reader preserves the original Inspector CLI behavior: reject symlink ancestors, hardlinks, directories, FIFOs, empty/oversized/absent files, and observed identity/metadata changes while reading. The inspector rejects invalid UTF-8/JSON, duplicate members, unsupported structures, checksum/contract/replay/projection mismatches. The comparison owns both plain byte snapshots before asynchronous validation, including when a caller supplies Node Buffers.

There are no catalog/DataHub calls, stores, listeners, SQLite writes, uploaded files, executable imports, resume operations or SQL execution. The command never modifies either input. Its shared library API is `compareReviewBytes(leftBytes,rightBytes,{now})` in `public/studio/core/review-comparison.js`, re-exported through the preserved native `src/studio/review-comparison.mjs` path; the optional inspection time supports deterministic callers/tests, while the CLI always uses the current time.

Unkeyed hashes and shared-function replay prove internal consistency, not signatures or an independent policy implementation. Source authentication, execution authorization and resumable import remain false; tool calls remain0. A locally acknowledged package stays locally unverified. The file boundary does not defend against a hostile operating-system owner who can replace files or change the process. Application/checkpoint/policy version2.0.0 and the original release tag are unchanged. Report schema is `lineageguard.review-comparison/1`; refusal schema is `lineageguard.comparison-error/1`.

## Verify the workflow

```sh
node --test test/studio/review-comparison.test.mjs test/studio/comparison-cli.test.mjs test/studio/inspection-cli.test.mjs
npm test
npm run studio:evaluate
npm run format:check
npm run build
node scripts/build-studio.mjs --verify dist
npm run test:browser
```

Build into a fresh output directory; the existing builder refuses to overwrite `dist`. The explicit static inventory includes the shared comparison core and browser view; no runtime/server module is added to the public payload. Tests use actual synthetic runs, both-side corruption (including a rehashed projection mismatch), incomplete exports, ambiguous encodings, bounds, Buffer mutation, alternative requests, current-versus-recorded freshness and real CLI file/argument failures. They verify unchanged input bytes/directories and safe failure output. Existing Inspector tests protect its shared-reader extraction.

The browser journey exercises this panel before a current review exists in both storage modes. It verifies exact browser/native JSON parity at the displayed inspection instant, same-file and alternative comparisons, separate stale-evidence judgments, both-side malformed/oversized/incomplete/rehashed refusals, literal hostile text, keyboard activation, 390/768/1440-pixel layouts and 200% zoom. Deferred real File-read barriers prove Clear/replacement invalidation without fixed waits; offline request and complete storage/current-run snapshots verify isolation. These are shared-implementation consistency checks, not independent source or policy certification.
