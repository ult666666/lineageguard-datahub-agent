# Command line

Run these from the repository root with Node 24 (22.13 or later also works). Nothing needs installing: the application has no runtime npm dependencies. The two development dependencies are pinned browser-testing and formatting tools. Commands that write a file refuse to overwrite an existing one.

## Run Studio locally

`npm run studio:local` serves Studio at `http://127.0.0.1:4183` and stores SQLite checkpoints in the ignored `.lineageguard/` directory. Give an explicit private path for runs you want to keep:

```sh
npm run studio:local -- --port=4183 --store=/absolute/private/lineageguard-runs
```

Leave that terminal open; Ctrl+C stops the server. Two more commands work with a running service:

```sh
npm run studio:status   # read-only check; never opens the database or starts a server
npm run studio:open     # opens the running service in your browser
```

The launcher never kills another listener, changes ports on its own or swaps in a different storage directory. Status checks do not prove which process owns the port or which directory it uses. The [local launcher guide](LOCAL_LAUNCH.md) covers repeat starts, occupied ports and the JSON status report.

`npm start` serves the lighter browser-session preview at `http://127.0.0.1:4173`, the mode the hosted demo uses. The original interface is still at `/classic.html`. Its scorer is the historical one, not the Studio policy, and the classic APIs and the portable Codex skill remain for compatibility.

## Review without the UI

```sh
npm run studio:review -- --scenario=safe-add --output=./.lineageguard/review.json
```

This runs one review of a synthetic scenario and prints a one-line JSON summary. `--profile=strict` or `--profile=sequential` picks another recipe, and `--pause` stops the run before the policy step.

### Live DataHub capture

A capture from your own DataHub needs both an explicit flag and a validated request file, plus `DATAHUB_MCP_URL` and `DATAHUB_MCP_TOKEN` set in your environment:

```sh
npm run studio:review -- --live-datahub --request=./private-request.json --output=./.lineageguard/private-review.json
```

The hosted demo, the tests and the evaluations never use this mode. The command makes two read-only MCP calls once, then reviews the frozen capture. It is not a background sync. Unsupported schema fields, unverified column paths and missing weekly usage stay marked as incomplete evidence. Keep tenant exports private. The [DataHub integration profile](ARCHITECTURE.md#datahub-integration-profile) lists the supported MCP protocol version.

### dbt manifest

```sh
npm run studio:review -- \
  --dbt-manifest=public/studio/dbt/saas-analytics-warehouse/manifest.json \
  --dbt-catalog=public/studio/dbt/saas-analytics-warehouse/catalog.json \
  --request=examples/dbt/rename-mrr-usd.json \
  --output=./.lineageguard/dbt-review.json
```

`--dbt-catalog` is optional. To find the dataset URN to put in a request, list every model, seed, snapshot and source in a manifest:

```sh
npm run studio:review -- --dbt-manifest=target/manifest.json --list-dbt-targets
```

The [dbt example](../examples/dbt/README.md) walks through the output, and the [integration profile](ARCHITECTURE.md#dbt-manifest-integration-profile) explains the mapping and its limits. The Studio itself reviews only the bundled manifest; your own manifest goes through this command.

## Check and compare saved reviews

```sh
npm run studio:verify -- --file=/absolute/path/to/export.json
node scripts/studio-compare.mjs --left=/path/left.json --right=/path/right.json
```

`studio:verify` runs the Review Inspector on one export: it checks hashes and evidence contracts and reproduces the decision and the drafts. `studio-compare.mjs` inspects both files first, then shows the recorded policy and evidence differences. Neither command imports a review, calls a tool, writes a store or executes anything. See [Review Inspector](REVIEW_INSPECTOR.md) and [Compare two saved reviews](REVIEW_COMPARISON.md) for exit codes, file bounds and a reproducible synthetic pair.
