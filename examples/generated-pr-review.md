# LineageGuard change review

## Decision

**CRITICAL RISK — 100/100**

## Proposed changes

- Renames order_total to gross_amount
- Breaking type change on order_total: DECIMAL(12,2) → VARCHAR
- Drops currency

## DataHub blast radius

- **prod.finance.fct_revenue** (dataset) — owner: Finance Analytics
- **Executive Revenue Dashboard** (dashboard) — owner: Finance Analytics
- **Customer Lifetime Value Model** (mlModel) — owner: ML Platform
- **Monthly Revenue Close** (pipeline) — owner: unassigned

## Risk signals

- Renames order_total to gross_amount (+20)
- Breaking type change on order_total: DECIMAL(12,2) → VARCHAR (+40)
- Drops currency (+30)
- 4 downstream assets across DataHub lineage (+30)
- 1 downstream assets have no assigned owner (+5)
- 64 recent weekly queries indicate active usage (+15)
- Sensitive-data tag increases rollout and validation risk (+12)

## Required validation

- [ ] Compare row count before and after migration.
- [ ] Compare primary-key uniqueness and null rates.
- [ ] Re-run known downstream queries and dashboards.
- [ ] Assert order_total and gross_amount match during the compatibility window.
- [ ] Count failed casts from order_total (DECIMAL(12,2)) to VARCHAR.
- [ ] Confirm zero recent queries reference currency before removal.
- [ ] Re-run DataHub quality assertions tied to the dataset.

## Rollout recommendation

Use an additive compatibility window, notify every listed owner, validate downstream behavior, and remove legacy fields only after usage reaches zero.

_Dataset: urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.analytics.orders,PROD)_
