# Compare two saved reviews

Two exported reviews of the same change can reach different decisions, for example under the standard and the strict policy. Compare saved reviews puts them side by side. The browser panel and the `studio:compare` command both run the [Review Inspector](REVIEW_INSPECTOR.md) on each file first, then compare the recorded results with Studio's own `compareRuns`. They share one function for reading, checking and comparing the bytes, and produce the same JSON report.

Neither runs an evidence tool again or imports a review into run history. The browser panel is separate from the Compare tab's live alternative-plan buttons. The command needs Node 22.13 to 24 and nothing else: no package installation, service, database, tenant or API credentials.

## In the browser

1. Open the Compare tab in the hosted or local Studio and go to Compare saved reviews. You do not need a current review.
2. Choose a Left review JSON and a Right review JSON, each between 1 and 4,000,000 bytes. Choosing files does not start the comparison.
3. Select Compare files. Both files must pass inspection and be completed reviews. If the right file is malformed, you get a refusal, never a half-finished result for the left file.
4. Read the flags for request, recipe and source revision, then the recorded decisions and the gaps that differ. Each side also shows how its embedded evidence looks now, at the inspection time shown once for both.
5. Download comparison saves the same `lineageguard.review-comparison/1` report as the command. It includes the request summaries and run identifiers from the files, so keep private files and reports local. The panel shows text from the files literally.
6. Changing either file discards the old result and its download at once. Clear also empties both file inputs. Neither changes the active workflow or saved checkpoints.

Once Studio has loaded, the panel works offline. Studio itself still has to be reachable to load; there is no service worker or offline install. Files are read one pair at a time, left then right. Clear or a new selection cancels pending work immediately, but the browser cannot abort a `File.arrayBuffer()` read already in progress, so a new comparison waits for that read to finish. A cancelled left read never goes on to read the right file. In both storage modes, no file is uploaded, stored, imported or executed.

You can select the same file on both sides.

## A synthetic pair to try

From the repository root, create two new exports with the fixture runner. It refuses to overwrite an existing file, so pick new names if you run it again.

```sh
npm run studio:review -- --scenario=safe-add --profile=standard --output=./.lineageguard/comparison-standard.json
npm run studio:review -- --scenario=safe-add --profile=strict --output=./.lineageguard/comparison-strict.json
node scripts/studio-compare.mjs --left=./.lineageguard/comparison-standard.json --right=./.lineageguard/comparison-strict.json
```

On these fictional inputs the standard policy records `proceed-with-checks` and the strict policy records `review-required`. The request and the source revision are the same; the recipes differ. These are policy examples, not an organisation's approval. Each run gets new run IDs and timestamps, but the comparison means the same thing. Selecting the two files in the browser, left then right, gives the same decisions and flags as the command.

Call the script with `node` directly, as above, when the output must not reveal file paths. `npm run studio:compare` prints a banner with the arguments, including file paths, before the script starts, so do not use it when a refusal message must stay private. `npm --silent run studio:compare -- ... --json` hides the banner. For a single JSON object:

```sh
node scripts/studio-compare.mjs --left=./.lineageguard/comparison-standard.json --right=./.lineageguard/comparison-strict.json --json
```

The command writes only to standard output and creates no file. A successful JSON report contains the request summaries, run IDs, bindings, recorded decisions and gaps, and the inspection hashes and checks from both files, so choose where you redirect it with care. A failure report never repeats file contents, private paths or raw exception text.

Comparing two different requests is allowed. The report labels it an alternative-plan comparison, not a repeat of the same input:

```sh
npm run studio:review -- --scenario=rename --output=./.lineageguard/comparison-rename.json
node scripts/studio-compare.mjs --left=./.lineageguard/comparison-standard.json --right=./.lineageguard/comparison-rename.json
```

## Reading the result

`comparison.sameRequest`, `sameRecipe` and `sameSourceRevision` mean what they mean in Studio's live comparison. The decisions, risk, gaps, call counts and policy names for `left` and `right` are the values recorded in each file, and `addedGaps` and `removedGaps` are the differences between the recorded gap sets.

`inspections.left` and `inspections.right` each report integrity and consistency, the SHA-256 of the exact bytes supplied, whether the review completed, and how the embedded evidence looks at the one inspection time shown. Evidence can be stale now even when its recorded decision was favourable. The report never replaces a recorded decision with the current one.

| Exit code | Meaning                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Two internally consistent, completed reviews were compared, including two different requests. This says nothing about authenticity, what the catalog contains now, approval or whether a migration is safe. `--help` on its own also exits 0. |
| 2         | The arguments, a file read, an inspection or the completion check was refused. The error's `side` says left or right where that applies, and there is no comparison result.                                                                   |

A paused or failed review that is internally consistent can be inspected on its own, but a comparison needs completed reviews on both sides. A corrupted right file never leaves a successful partial comparison of the left.

The terminal output shows the recorded decisions, current assessments, comparison flags, gap counts and both file hashes. It does not print request summaries from the files, which are untrusted input. JSON output escapes all text from the files. The same path can be given twice; each read is checked separately. Two valid JSON files that differ only in whitespace have different file hashes but the same request and recipe.

## Limits and trust

Each command-line input must be an existing regular file with no other links, between 1 and 4,000,000 bytes. The browser works on the `File` snapshots the user selects and makes no claim about links or paths. The shared reader keeps the Inspector command's rules: it rejects symlinked parent folders, hard links, directories, FIFOs, empty, oversized or missing files, and any change to the file's identity or metadata while it is read. The Inspector rejects invalid UTF-8 or JSON, repeated keys, unsupported structures, and any mismatch in checksums, evidence contracts, replay or projection. The comparison takes its own plain copy of both inputs before any asynchronous check, including when a caller passes Node `Buffer` objects.

There are no catalog or DataHub calls, stores, listeners, SQLite writes, uploads, executable imports, resumed runs or SQL execution, and the command never changes either input. The library function is `compareReviewBytes(leftBytes, rightBytes, { now })` in `public/studio/core/review-comparison.js`, also exported from `src/studio/review-comparison.mjs`. Callers and tests can pass the inspection time for repeatable results; the command always uses the current time.

Hashes without keys and replay through Studio's own functions show internal consistency. They are not signatures and not an independent implementation of the policy. Source authentication, execution authorisation and resumable import stay false, and the tool call count stays 0. A review acknowledged locally stays locally unverified. The file checks do not protect against someone who controls the operating system and can swap files or change the process. The application, checkpoint and policy stay at version 2.0.0, and the original release tag is unchanged. The report schema is `lineageguard.review-comparison/1` and the refusal schema is `lineageguard.comparison-error/1`.

## Tests

```sh
node --test test/studio/review-comparison.test.mjs test/studio/comparison-cli.test.mjs test/studio/inspection-cli.test.mjs
npm test
npm run studio:evaluate
npm run format:check
npm run build
node scripts/build-studio.mjs --verify dist
npm run test:browser
```

Build into a fresh output directory, because the builder refuses to overwrite `dist`. The static file inventory lists the shared comparison module and the browser view, and adds no runtime or server module to the public files.

The unit tests use real synthetic runs. They cover corruption on either side (including a projection mismatch with a recomputed hash), incomplete exports, ambiguous encodings, size limits, input buffers overwritten while the comparison is still running, different requests, current against recorded freshness, and real command-line file and argument failures. They check that inputs and folders are unchanged and that failure output stays safe. The existing Inspector tests cover the shared reader.

The browser journey uses the panel before any current review exists, in both storage modes. It checks that the browser and the command produce identical JSON for the same inspection time, compares a file with itself and two different requests, and shows each side's stale evidence separately. It also checks refusals for malformed, oversized, incomplete and rehashed files on either side, literal display of hostile text, keyboard use, layouts at 390, 768 and 1440 pixels, and 200% zoom. File reads held open by test barriers show that Clear and a new selection cancel pending work without fixed waits, and snapshots of network requests, storage and the current run show the panel stays isolated. These tests check consistency with Studio's own code, not an independent certification of the source or the policy.
