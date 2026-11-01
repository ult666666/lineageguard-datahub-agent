# dbt manifest fixture and example

LineageGuard can review a schema change against a dbt project's `manifest.json`, with
`catalog.json` as an optional source of observed column types. This folder documents the
committed fixture that the tests, the labelled benchmark and the Studio's dbt scenario
read, and gives one end-to-end example.

## Provenance

The fixture is a trimmed copy of the artifacts that dbt wrote for
[saas-analytics-warehouse](https://github.com/ult666666/saas-analytics-warehouse), a dbt
and DuckDB project by the same author. Its data is synthetic: it describes Tallyloom, a
fictional SaaS company. The project is MIT licensed.

| Item | Value |
| --- | --- |
| Source commit | `28b75e8c1545da0d64ac26231045b80009f2fe5e` (`main`, 2026-10-27) |
| dbt | dbt-core 1.12.6 with dbt-duckdb 1.11.0 and DuckDB 1.5.6, Python 3.12.3 via uv 0.11.32 |
| Artifact schemas | manifest v12, catalog v1 |
| Generated at | manifest `2026-11-01T23:07:04Z`, catalog `2026-11-01T23:07:06Z` |
| Files | [`manifest.json`](../../public/studio/dbt/saas-analytics-warehouse/manifest.json) (172,462 bytes, trimmed from 1,234,335) and [`catalog.json`](../../public/studio/dbt/saas-analytics-warehouse/catalog.json) (15,598 bytes, trimmed from 27,184) |

The source project declares no exposures, groups or owners. To exercise those manifest
fields, the fixture was generated with the two files in [`overlay/`](saas-analytics-warehouse/overlay):

- [`lineageguard_overlay.yml`](saas-analytics-warehouse/overlay/lineageguard_overlay.yml)
  declares two exposures and two groups. The exposures describe consumers that exist in
  the source repository: `src/saasreport/data.py` and `src/saasreport/churn.py` query
  exactly the marts each exposure lists. The owner names are synthetic team names, like
  the company.
- [`dbt_project.yml.patch`](saas-analytics-warehouse/overlay/dbt_project.yml.patch)
  assigns the core marts to the `revenue` group, the reporting marts to
  `finance_reporting`, and a `meta.owner` to the staging models. Intermediate models,
  the seed and the sources stay without an owner, so the fixture also shows that gap.

## Reproduce

Run from a scratch directory with a clone of each repository. The commands are the ones
used to produce the committed files.

```sh
git -C saas-analytics-warehouse archive 28b75e8c1545da0d64ac26231045b80009f2fe5e | tar -x -C saw
cp lineageguard-datahub-agent/examples/dbt/saas-analytics-warehouse/overlay/lineageguard_overlay.yml saw/dbt/models/
patch -p1 -d saw < lineageguard-datahub-agent/examples/dbt/saas-analytics-warehouse/overlay/dbt_project.yml.patch
cd saw
uv sync --locked
make data MONTHS=24 SCALE=0.25   # synthetic CSVs, seed 42, the size the source CI uses
make build                       # dbt build: PASS=173, ERROR=0
(cd dbt && DBT_PROFILES_DIR=$PWD uv run dbt docs generate)
cd ../lineageguard-datahub-agent
node scripts/trim-dbt-manifest.mjs --manifest=../saw/dbt/target/manifest.json \
  --catalog=../saw/dbt/target/catalog.json --out=public/studio/dbt/saas-analytics-warehouse
node scripts/trim-dbt-manifest.mjs --compare --manifest=../saw/dbt/target/manifest.json \
  --catalog=../saw/dbt/target/catalog.json --trimmed=public/studio/dbt/saas-analytics-warehouse
```

`dbt docs generate` works offline here because the warehouse is a local DuckDB file. A
fresh run gets new `generated_at` times, so its evidence revisions differ from the
committed ones.

The trim keeps only the fields LineageGuard reads: resource identity, relation names,
columns and their declared types, `depends_on`, owners, groups, exposures, test metadata,
`parent_map` and `child_map`. It drops SQL, descriptions, macros, docs and local paths.
dbt itself cannot load the result. `--compare` checks that the trim is lossless for
LineageGuard: for each of the 30 models, seeds and sources, with and without the
catalog, the full and trimmed files must give the same evidence revision. The committed
files passed: `{"targets":30,"identical":30}`.

## End-to-end example: rename a revenue column

[`rename-mrr-usd.json`](rename-mrr-usd.json) renames `fct_mrr.mrr_usd`, the monthly
recurring revenue column, to `mrr_amount_usd`.

```sh
npm run studio:review -- \
  --dbt-manifest=public/studio/dbt/saas-analytics-warehouse/manifest.json \
  --dbt-catalog=public/studio/dbt/saas-analytics-warehouse/catalog.json \
  --request=examples/dbt/rename-mrr-usd.json \
  --output=./.lineageguard/dbt-review.json
```

The command prints one JSON line. These are its `decision` and `dbt` fields from a run
on 2026-11-01, within a day of the manifest's generation time:

```json
{
  "decision": "needs-evidence",
  "downstream": [
    { "name": "SaaS metrics report", "type": "analysis", "owner": "Finance Reporting (synthetic)" },
    { "name": "dim_customers", "type": "dataset", "owner": "Revenue Analytics (synthetic)" },
    { "name": "fct_mrr_movements", "type": "dataset", "owner": "Revenue Analytics (synthetic)" },
    { "name": "rpt_cohort_retention", "type": "dataset", "owner": "Finance Reporting (synthetic)" },
    { "name": "rpt_mrr_bridge", "type": "dataset", "owner": "Finance Reporting (synthetic)" },
    { "name": "rpt_unit_economics", "type": "dataset", "owner": "Finance Reporting (synthetic)" },
    { "name": "Customer-level churn investigation", "type": "analysis", "owner": "Revenue Analytics (synthetic)" }
  ],
  "reasons": ["RENAME_CONTRACT"],
  "gaps": ["schema:INCOMPLETE_EVIDENCE", "lineage:INCOMPLETE_EVIDENCE", "usage:INCOMPLETE_EVIDENCE"]
}
```

Five downstream models and both exposures read `fct_mrr`, and each has an owner. The
`checks` field lists the 12 dbt tests that read the model, including
`not_null_fct_mrr_mrr_usd`, which must move with the rename. The decision stays at
`needs-evidence` because a manifest cannot show query usage, column nullability or
consumers outside the project. Once the manifest is more than 24 hours old, the same
command also reports `STALE_EVIDENCE` for each kind: a manifest is a point-in-time file,
and its `generated_at` is the observation time.

The saved review passes the Review Inspector:

```sh
npm run studio:verify -- --file=./.lineageguard/dbt-review.json
```

To review your own project, pass your `target/manifest.json` (and `target/catalog.json`
after `dbt docs generate`). `--list-dbt-targets` prints the dataset URN to put in the
request for every model, seed, snapshot and source:

```sh
npm run studio:review -- --dbt-manifest=target/manifest.json --list-dbt-targets
```
