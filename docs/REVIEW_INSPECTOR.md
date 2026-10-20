# Review Inspector

A portable review should remain inspectable after leaving the running application. The Inspector is a local-only extension of Studio's existing export flow. It does not add an import-to-run endpoint, a catalog connection or an approval mechanism.

## Try it in Studio

Open **Review package → Review Inspector**. Select **Inspect current review**, or choose an exported run JSON file. The file is read in the current browser; it is not uploaded or written into run history. A downloaded inspection summary contains the run identity, hashes, check outcomes and evidence freshness—not the raw SQL, request summary, target URN, reviewer name or catalog payloads.

The panel separates the recorded decision from **the current assessment of the embedded evidence at the displayed inspection time**. An internally consistent old review can now need fresh evidence. A failed or paused checkpoint stays incomplete; inspection does not generate a favorable decision or resume it. Clear discards only the inspection view, not the active review or saved checkpoints. A file read already in flight cannot repopulate the view after Clear.

The loaded Inspector also works with the browser set offline. Loading Studio itself still needs the local or hosted application to be reachable; this is not an offline-installed PWA.

## Verify a file from the terminal

Requires the Inspector update on current `main`; the original `v2.0.0` tag remains unchanged. No package installation, database or tenant is required for this command.

```sh
npm run studio:verify -- --file=/absolute/path/to/export.json
node scripts/studio-inspect.mjs --file=/absolute/path/to/export.json --json
```

Exit **0** means internal consistency checks passed. It does **not** mean approved, authentic, safe to migrate, or even that its evidence is still current. Exit **2** means arguments, file reading or review validation were refused. Errors do not echo the input file's contents, private path or supplied error strings. The command reads a single regular, unlinked file and does not overwrite it, write SQLite, start a listener or contact a tool.

Input is bounded to 4,000,000 bytes of UTF-8. Duplicate object members—including differently escaped spellings—are refused rather than silently taking the last value. Existing structural limits reject deep/oversized objects, accessors, hidden fields and poison keys. CLI file handling checks path links, regular-file identity, byte limits and before/after metadata; it rejects directories, symlinks and FIFOs. This is not protection against a hostile operating-system owner able to replace files or change the running process.

## What the Inspector verifies

1. **Checkpoint integrity:** supported schema, request/recipe binding, checkpoint checksum, completed-output hashes and the hash-linked event chain.
2. **Evidence contracts:** exact requested target, evidence kind, source mode/revision, declared coverage, bounded structures and the evidence's own digest.
3. **Deterministic consistency:** compatibility reproduces from the embedded schema; policy matches a freshness-consistent time within its declared execution window; artifacts regenerate from the bound inputs.
4. **Result projection:** exported policy, artifacts and evidence equal their completed step outputs. Recomputing an outer checksum alone does not repair a mismatched result.
5. **Current assessment:** the policy is evaluated again at inspection time using the same embedded evidence. Sources are not reread. Recorded and current judgments remain distinct.

Policy replay considers every relevant freshness transition within the recorded policy step's time window, not just its endpoints. A regression constructs two evidence transitions where the recorded policy is consistent only in the interior. This avoids falsely rejecting a legitimate result merely because a timestamp crossed a boundary during the step.

The same inspection guard runs before Studio exports run JSON, Markdown or SQL drafts. Changed input during inspection cancels the obsolete export. The guard does not alter the stored workflow or execute the SQL.

## Trust boundaries

**Consistent is not authentic.** SHA-256 digests and hash chains are unkeyed, not signatures. A party who can reconstruct an entire self-consistent package can also reconstruct its hashes. Passing inspection does not authenticate the author, verify real catalog truth, establish an independently observed execution history, prove completeness beyond supplied evidence, or grant organizational approval.

The Inspector shares the existing policy and artifact functions with Studio; it checks replay consistency, not an independent implementation of those algorithms. An acknowledgement remains `local-unverified` and `executionAuthorized=false`. The report always sets `sourceAuthenticated=false`, `toolCalls=0` and `resumableImport=false`.

Imported packages never enter the execution runtime, server store or browser checkpoint store. There is no upload or restore endpoint. All content shown in the panel uses text nodes, not HTML from the file. An invalid selection clears the old successful report and disables its download, preventing a stale success from being mistaken for a new result.

Inspector version/schema are `1.0.0` / `lineageguard.inspection/1`. The application, policy, original runtime interpreter, database format and `lineageguard.run/2` checkpoint schema remain 2.0.0. This follow-up does not retroactively change the original tagged release.

## Reproducible checks

```sh
node --test test/studio/inspection.test.mjs test/studio/inspection-cli.test.mjs
npm test
npm run test:browser
npm run studio:evaluate
npm run build
node scripts/build-studio.mjs --verify dist
```

Build into a fresh output directory; the existing build refuses overwriting `dist`. The public inventory now explicitly includes the two Inspector modules. `npm run verify:deployed` verifies the matching published bytes and exercises the same Inspector UI against a fresh synthetic browser context; it is an opt-in hosted check, not part of offline CI.

Tests cover tampering with and without a recomputed checksum, invented policy and drafts, wrong evidence targets/digests/modes, stale and incomplete reviews, strict policy, malformed encodings and duplicate keys, accessor refusal, CLI no-write behavior and exact byte preservation. Browser checks run inspection with networking disabled, assert zero requests and unchanged local checkpoint bytes, check late-read/Clear handling and stale-result invalidation, and validate the panel at 390, 768 and 1440 pixels. A separate test deliberately modifies only its own synthetic browser checkpoint to prove all draft exports are guarded; it restores the original test bytes afterward.
