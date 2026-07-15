import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../skills/lineageguard-schema-review/scripts/score_change.py", import.meta.url));

function run(manifest) {
  const result = spawnSync("python3", [script, "-", "--format", "json"], {
    encoding: "utf8",
    input: JSON.stringify(manifest),
  });
  return { ...result, report: result.status === 0 ? JSON.parse(result.stdout) : null };
}

test("Codex skill blocks a breaking high-blast-radius rename", () => {
  const { status, report } = run({
    change: { entity: "warehouse.orders", kind: "rename_column", breaking: true },
    signals: {
      downstream_assets: 12,
      critical_assets: 3,
      weekly_queries: 5000,
      open_quality_incidents: 1,
      test_coverage: 0.75,
      rollback_ready: true,
      deprecation_days: 14,
      owners_identified: 2,
    },
  });

  assert.equal(status, 0);
  assert.equal(report.decision, "BLOCK");
  assert.equal(report.risk_score, 72);
  assert.ok(report.conditions.some((item) => item.includes("critical consumer")));
});

test("Codex skill never treats unknown production evidence as zero", () => {
  const { status, report } = run({
    change: { entity: "warehouse.orders", kind: "other" },
    signals: {
      downstream_assets: null,
      critical_assets: null,
      weekly_queries: null,
      open_quality_incidents: null,
      test_coverage: null,
      rollback_ready: null,
      deprecation_days: null,
      owners_identified: null,
    },
  });

  assert.equal(status, 0);
  assert.equal(report.decision, "BLOCK");
  assert.ok(report.missing_evidence.includes("critical_assets"));
  assert.ok(report.missing_evidence.includes("owners_identified"));
});

test("Codex skill approves a controlled nullable addition", () => {
  const { status, report } = run({
    change: { entity: "warehouse.orders", kind: "add_nullable_field" },
    signals: {
      downstream_assets: 1,
      critical_assets: 0,
      weekly_queries: 25,
      open_quality_incidents: 0,
      test_coverage: 1,
      rollback_ready: true,
      deprecation_days: 30,
      owners_identified: 1,
    },
  });

  assert.equal(status, 0);
  assert.equal(report.decision, "APPROVE");
  assert.equal(report.risk_score, 0);
});

test("Codex skill rejects ambiguous boolean inputs", () => {
  const result = run({
    change: { entity: "warehouse.orders", kind: "other", breaking: "false" },
    signals: {},
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /change\.breaking must be true, false, or omitted/);
});
