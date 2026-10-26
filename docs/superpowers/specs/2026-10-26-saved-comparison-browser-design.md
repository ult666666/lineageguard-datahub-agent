# Compare two saved reviews in the browser

## Intent and existing evidence

The user requested another three hours of substantive GitHub portfolio engineering, continuing the AI-tools direction and prior delegated implementation/shipping scope. Current main924e985 already provides a semantic Inspector, a native two-export consumer and live alternative-plan controls. Browser users can inspect one saved JSON, but cannot compare two saved exports without Node. This project closes that concrete workflow gap. Implementation choices below are the author's, under the standing autonomy request; no new customer, production or authorization claim is introduced.

## Approaches

1. Link browser visitors to the existing CLI guide. Lowest change, but retains the Node-only gap.
2. Add a local file comparison surface to the existing Compare tab and share the existing byte-level consumer. Chosen: it makes saved-review comparisons accessible while retaining one semantic guard, existing comparisons and no new service.
3. Add an upload/comparison API and history import. Rejected: unnecessary data transfer and authority for this local inspection task.

## Contract

- Move the current compareReviewBytes(left,right,{now=Date.now()}) implementation unchanged into public/studio/core/review-comparison.js. Keep src/studio/review-comparison.mjs as a compatibility re-export. Existing report schema lineageguard.review-comparison/1, side-specific errors, owned-byte behavior and compareRuns semantics remain identical. Both packages must pass existing inspection and be completed before any comparison is shown.
- Add public/studio/saved-comparison-view.js, mounted once by studio.js. Place a separately labelled Compare saved exports panel in the Compare tab, before the existing live alternative controls. Two file inputs are labelled Left exported review JSON and Right exported review JSON; each is1–4,000,000bytes. Explicit Compare saved exports, Export comparison JSON and Clear saved comparison buttons; no auto-run on file selection.
- Compare is disabled until both files are selected and while one operation is active. Size validation happens before file reads. Own at most one active comparison/read sequence: read left then right, checking a generation ticket after each await; changing either selection or Clear invalidates the ticket immediately. Old reads may finish but cannot show a result, read the next stale file or enable an old download. A new comparison becomes available after the active sequence settles. There is no overlapping unbounded queue of reads.
- Clear empties both file inputs, successful report and download state immediately. Selection changes and errors remove any prior success before asynchronous work. The status is a short live region; detailed results are a labelled region with aria-busy during its current check. File inputs and Clear remain usable while reading.
- Render comparison flags, recorded decisions/risk/policy/call counts, source revision identity, left/right file hashes/run IDs, added/removed recorded gaps and the existing alternative-request explanation. Separately show both current embedded-evidence assessments, readiness and one shared inspection time. Render every supplied string through textContent; do not reuse runtime/history objects or HTML interpolation. Use wrapping fact lists and a two-column layout that stacks on small screens.
- Visible scope: internally consistent supplied exports are not authenticated or approved; no sources reread, no tool calls, no upload/import/resume or execution. Comparison JSON intentionally includes supplied summaries and run identities; tell users to keep private exports local. Downloads contain the exact shared report, with no filenames/raw package payloads added by the view.
- Keep saved comparison state only in module memory. No server/API, localStorage, sessionStorage, history checkpoint, database, credentials, provider calls, dependencies or package/version changes. The current live review, original Inspector and live comparisons remain untouched.
- Explicitly add the two public modules to the existing static inventory; preserve its no-overwrite and byte-verification rules. The original2.0.0 tag and checkpoint schema remain unchanged. New UI requires current main.

## Verification

Baseline134tests must pass before implementation. First add a failing shared-module compatibility assertion; preserve all existing comparison/Inspector/adversarial tests. Add a failing real-browser workflow for the missing panel, then implement it. Use actual fixture exports and the real DOM in both browser-session and durable-local modes. Verify offline networking with zero requests, unchanged checkpoint storage/current run identity, standard/strict and alternative comparisons, same-file comparison, downloaded shared-report parity at its recorded inspection time, stale versus recorded outcomes, malformed/duplicate/oversized/incomplete/rehashed-semantic failure on both sides, and no stale success/download after failure.

Use a deterministic deferred File.arrayBuffer barrier to exercise Clear and changed selection during a read without fixed sleeps. Release owned barriers and restore prototypes in finally. Confirm an invalidated left read never starts its old right read; a later current pair can be compared. Check keyboard access,390/768/1440px,200%zoom and text-only handling of hostile summaries. Existing31browser journeys and live comparisons must continue to pass. Full npm test,19evaluations, formatting, fresh static build/verification, read-only MCP smoke and hosted Node22/24/browser/CodeQL are required. Public deployment/source bytes and the real browser workflow must be verified after exact reviewed green merge. No Vercel credential expansion or paid calls.

## Limits

Consistency and shared-function replay are not source authentication, independent policy correctness or organizational approval. The browser must already be loaded before operating offline; this is not a PWA. Native filesystem safe-reader rules remain in the CLI. Browser APIs read user-selected files with the existing4MB bound; a cancelled view cannot abort File.arrayBuffer itself, so its single owned sequence is allowed to settle before another begins. No raw JSON is imported as executable runtime state. General cross-browser certification is not claimed from Chromium checks.
