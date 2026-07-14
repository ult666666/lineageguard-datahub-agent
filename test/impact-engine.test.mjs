import test from "node:test";
import assert from "node:assert/strict";
import { analyzeImpact } from "../src/impact-engine.mjs";

const dataset = {
  urn: "urn:test:orders",
  name: "orders",
  owner: "Data",
  platform: "Snowflake",
  weeklyQueries: 55,
  tags: ["Financial"],
  qualitySignals: ["pk"],
  downstream: [
    { name: "Revenue Dashboard", type: "dashboard", owner: "Finance" },
    { name: "Value Model", type: "mlModel", owner: "ML" },
  ],
};

test("blocks a breaking, high-blast-radius migration", () => {
  const result = analyzeImpact({ dataset, changes: [
    { kind: "type_change", field: "amount", from: "DECIMAL", to: "VARCHAR" },
    { kind: "drop", field: "currency" },
  ] });
  assert.equal(result.severity, "critical");
  assert.equal(result.decision, "block");
  assert.ok(result.score >= 75);
  assert.match(result.migrationSql, /TRY_CAST/);
  assert.match(result.prMarkdown, /Revenue Dashboard/);
});

test("allows an optional additive field with checks", () => {
  const result = analyzeImpact({ dataset: { ...dataset, downstream: [], weeklyQueries: 0, tags: [] }, changes: [
    { kind: "add", field: "campaign_code", type: "VARCHAR", required: false },
  ] });
  assert.equal(result.severity, "low");
  assert.equal(result.decision, "proceed-with-checks");
  assert.match(result.migrationSql, /ADD COLUMN campaign_code VARCHAR/);
});
