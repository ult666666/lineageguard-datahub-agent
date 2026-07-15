# Risk policy and manifest schema

## Manifest

Pass one JSON object:

```json
{
  "change": {
    "entity": "warehouse.orders",
    "kind": "rename_column",
    "field": "total",
    "new_field": "gross_total",
    "breaking": true
  },
  "signals": {
    "downstream_assets": 12,
    "critical_assets": 3,
    "weekly_queries": 5000,
    "open_quality_incidents": 1,
    "test_coverage": 0.75,
    "rollback_ready": true,
    "deprecation_days": 14,
    "owners_identified": 2
  },
  "evidence": [
    {"source": "DataHub get_lineage", "detail": "12 downstream assets"}
  ]
}
```

Required: `change.entity`, `change.kind`, and `signals`. Counts must be non-negative. `test_coverage` is 0–1.

Supported change kinds: `drop_field`, `rename_column`, `narrow_type`, `change_semantics`, `add_required_field`, `add_nullable_field`, `widen_type`, and `other`.

## Score

The deterministic script calculates a 0–100 score.

- Base change risk: drop 35; narrow type 30; rename 28; semantics 25; add required 18; other 12; widen type 6; add nullable 4.
- Explicit breaking flag: +8, except when already represented by drop, rename, or narrow type.
- Critical consumers: up to +30 at 8 points each.
- Downstream breadth: up to +20 at 2 points per consumer.
- Weekly usage: up to +15 using `4 × log10(queries + 1)`.
- Open quality incidents: up to +10 at 4 points each.
- No identified owner: +8.
- Unknown blast-radius evidence: +8 for downstream assets, +12 for critical assets, +6 for weekly usage, and +4 for incident count.
- Missing safety evidence: +4 for each absent field among test coverage, rollback readiness, and deprecation days.
- Mitigation credit: up to −10 for test coverage; −8 for rollback readiness; up to −8 for a deprecation window of 30 days or more.

Round to the nearest integer, then clamp to 0–100.

## Interpretation

- 0–29 `APPROVE`
- 30–59 `CONDITIONAL`
- 60–100 `BLOCK`

The score is a deployment guardrail, not proof of safety. Cite evidence and state uncertainty.

Use JSON `null` for a signal that was queried but remains unknown. Never omit or zero a production signal merely because the source did not return it.
