# Policy evaluation

The scenario suite (`npm run studio:evaluate`) checks that the runtime behaves: retries,
outages, pause and resume, tamper detection. It does not tell you whether the policy
makes the right call across many different changes. The labelled benchmark does that.

```sh
npm run studio:benchmark
```

The command runs every labelled case in [`evals/policy-cases.json`](../evals/policy-cases.json)
through the same interpreter, evidence contracts and policy as Studio, then compares each
result with its label. It takes a few seconds and needs no network or credentials.

CI runs `npm run studio:benchmark -- --check` on Node 22 and 24. The check fails when:

- any decision is more permissive than its label, or
- the results differ from the pinned report in
  [`evals/policy-report.json`](../evals/policy-report.json), or from the generated text
  below and in the README.

A policy change therefore shows up in review as a diff of one line per affected case.
To accept a change on purpose, run `npm run studio:benchmark -- --write` and commit the diff.

## Results

<!-- policy-benchmark:results:start -->
89 labelled cases: 85 decisions match the label (95.5%), 0 are more permissive than the label and 4 are stricter.

Reason codes: precision 0.96, recall 0.96. Evidence gaps: precision 1.00, recall 1.00. Adversarial twins with identical outcomes: 5 of 5.

| Outcome | Labelled | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `block` | 32 | 36 | 0.89 | 1.00 | 0.94 |
| `needs-evidence` | 16 | 16 | 1.00 | 1.00 | 1.00 |
| `failed` | 7 | 7 | 1.00 | 1.00 | 1.00 |
| `review-required` | 25 | 21 | 1.00 | 0.84 | 0.91 |
| `proceed-with-checks` | 9 | 9 | 1.00 | 1.00 | 1.00 |

Confusion matrix (rows: label, columns: policy output):

| Label | `block` | `needs-evidence` | `failed` | `review-required` | `proceed-with-checks` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `block` | 32 | 0 | 0 | 0 | 0 |
| `needs-evidence` | 0 | 16 | 0 | 0 | 0 |
| `failed` | 0 | 0 | 7 | 0 | 0 |
| `review-required` | 4 | 0 | 0 | 21 | 0 |
| `proceed-with-checks` | 0 | 0 | 0 | 0 | 9 |

| Case | Label | Policy output | Direction |
| --- | --- | --- | --- |
| `int-to-wide-decimal` | `review-required` | `block` | stricter |
| `timestamp-precision-widen` | `review-required` | `block` | stricter |
| `float-to-double` | `review-required` | `block` | stricter |
| `boolean-alias` | `review-required` | `block` | stricter |
<!-- policy-benchmark:results:end -->

## What the metrics mean

- **Decision accuracy**: the share of cases whose decision equals the label.
- **More permissive**: the policy let a change further than the label allows, for
  example `proceed-with-checks` where the label says `block`. For a review gate this is
  the number that matters most. CI requires it to be zero.
- **Stricter**: the policy stopped a change that the label would send to review or clear.
  This costs reviewer time but does not let a breaking change through.
- **Per-outcome precision and recall**: computed from the confusion matrix. `failed`
  means the run stopped because evidence broke its contract, so no decision exists.
- **Reason codes and evidence gaps**: each case also labels the exact compatibility codes
  and evidence gaps it expects. Precision and recall count them as multisets, so a batch
  with two additions must produce two `ADDITIVE_CHANGE` reasons.
- **Adversarial twins**: five cases repeat another case with hostile text in owner names,
  asset names, the platform label or the change summary. A twin holds when its decision,
  reasons and gaps are identical to the clean case.

## Labelling rules

The labels describe what a careful reviewer should decide. They were written from these
rules before the cases were run, and no label was changed after the first run.

Decision order:

1. `block` if any change cannot be applied safely as written.
2. Otherwise `needs-evidence` if any required observation is missing, partial, unknown,
   stale or dated in the future, or if any returned asset has no owner.
3. Otherwise `review-required` if any change needs a person to decide, or the strict
   profile is used.
4. Otherwise `proceed-with-checks`. Only optional additions reach this outcome.
5. `failed` if the evidence breaks its own contract: a different target, a lineage count
   that does not add up, an edge to a node that was not returned, duplicate columns, or a
   usage window that is not 7 days. The run must stop without a decision.

A change cannot be applied safely (`block`) when it:

- drops a column, or adds a required column without a validated backfill;
- adds a column or renames onto a name that already exists;
- names a column that the observed schema does not contain, or declares a source type
  that differs from the observed type;
- converts a type in a way that is not lossless (see below), including a rename that also
  declares a different type;
- tightens a nullable column to NOT NULL.

Column names compare case-insensitively. Unquoted identifiers resolve that way on
Snowflake, BigQuery, PostgreSQL, Redshift, Databricks and MySQL, so `ORDER_ID` and
`order_id` are the same column.

A type conversion is **lossless** only if every value of the old type is exactly
representable in the new type on every listed platform that supports both types. Lossless
conversions go to `review-required`, because consumers still need to validate them. Any
change of type family (number, string, date and time, boolean) is treated as lossy.
Examples: `INT → BIGINT` is lossless; `BIGINT → SMALLINT` is lossy because `SMALLINT` is
16 bits on PostgreSQL; an unsized `VARCHAR` is lossy because SQL Server reads it as one
character; `CHAR → VARCHAR` is lossy because platforms disagree about trailing spaces.

Evidence rules come from the documented policy: observations must be at most 24 hours old
(1 hour for the strict profile) and no more than 5 minutes in the future; the strict profile
also requires column-level paths.

## What the first run found

The first run used the policy on `main` at the time and these labels. It matched 78 of 89
decisions (87.6%). Five decisions were more permissive than the label:

| Case | Label | Policy output |
| --- | --- | --- |
| `add-existing-column-uppercase` | `block` | `proceed-with-checks` |
| `add-existing-column-mixed-case` | `block` | `proceed-with-checks` |
| `batch-addition-colliding-by-case` | `block` | `proceed-with-checks` |
| `rename-onto-existing-column-uppercase` | `block` | `review-required` |
| `rename-with-lossy-type` | `block` | `review-required` |

Two causes explained all five. The policy looked up columns with exact case, so adding
`ORDER_ID` next to an existing `order_id` looked like a new column. It also ignored the
type declared on a rename, so a rename from `DECIMAL(12,2)` to a `VARCHAR(5)` column went
to review instead of being blocked. Both are fixed in
[`policy.js`](../public/studio/core/policy.js) with regression tests in
[`policy.test.mjs`](../test/studio/policy.test.mjs). The fixes also removed two stricter
results and three reason-code mismatches.

The policy version stays `2.0.0`. Every stored checkpoint binds that version, so changing
it would make saved browser history unreadable. The fix only changes results for requests
that name an existing column with different letter case, or a rename that declares a
different type. A review exported before the fix that contains such a request no longer
replays in the Review Inspector, which reports `COMPATIBILITY_REPLAY_MISMATCH`.

## Accepted disagreements

Four lossless conversions are still blocked: `INT → DECIMAL(19,0)`,
`TIMESTAMP(3) → TIMESTAMP(6)`, `FLOAT → DOUBLE` and `BOOLEAN → BOOL`. The policy only
proves widening inside the integer ladder and within `DECIMAL`, `VARCHAR` and `CHAR`;
every other conversion fails closed. These cases keep their correct labels so the cost of
that choice stays visible: precision for `block` is below 1 while recall stays at 1.

## Limits

- The cases are synthetic and use one table, one lineage graph and one owner model.
- The same author wrote the rules, the labels and the policy fixes. The rules are written
  down so that others can challenge individual labels.
- The benchmark measures agreement with the rules above. It does not predict production
  incidents, and it says nothing about live DataHub metadata. Real Snowflake catalogs
  report types such as `VARCHAR(16777216)` and `TIMESTAMP_NTZ`, which the current type
  vocabulary does not accept.

## Add a case

Add an entry to `evals/policy-cases.json` with an `id`, a `group`, a one-sentence
`rationale`, the `changes`, optional `evidence` overrides and the `expected` decision,
reasons and gaps. Write the label from the rules above before you run it. Then run
`npm run studio:benchmark`, investigate any disagreement, and use `--write` to pin the
result. The loader rejects unknown fields, codes and node names, so a typo fails loudly.
