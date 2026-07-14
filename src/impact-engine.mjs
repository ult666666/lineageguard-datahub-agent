const TYPE_FAMILIES = {
  numeric: new Set(["tinyint", "smallint", "int", "integer", "bigint", "float", "double", "decimal", "number", "numeric"]),
  text: new Set(["char", "varchar", "string", "text"]),
  temporal: new Set(["date", "datetime", "timestamp", "time"]),
  boolean: new Set(["bool", "boolean"]),
};

function family(type = "") {
  const normalized = String(type).toLowerCase().replace(/\(.*/, "").trim();
  return Object.entries(TYPE_FAMILIES).find(([, values]) => values.has(normalized))?.[0] || normalized;
}

function isBreakingTypeChange(from, to) {
  if (!from || !to) return true;
  return family(from) !== family(to);
}

function q(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_]/g, "");
}

function pointsForAsset(asset) {
  const type = String(asset.type || "dataset").toLowerCase();
  if (type.includes("ml") || type.includes("model")) return 25;
  if (type.includes("dashboard") || type.includes("chart")) return 15;
  if (type.includes("pipeline") || type.includes("job")) return 12;
  return 8;
}

function severityFor(score) {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function changeRisk(change) {
  const kind = String(change.kind || "").toLowerCase();
  if (kind === "drop") return { points: 30, reason: `Drops ${change.field}` };
  if (kind === "rename") return { points: 20, reason: `Renames ${change.field} to ${change.to}` };
  if (kind === "type_change") {
    const breaking = isBreakingTypeChange(change.from, change.to);
    return { points: breaking ? 40 : 22, reason: `${breaking ? "Breaking" : "Potential"} type change on ${change.field}: ${change.from} → ${change.to}` };
  }
  if (kind === "nullable") return { points: change.to === true ? 12 : 8, reason: `Changes nullability for ${change.field}` };
  if (kind === "add") return { points: change.required ? 12 : 3, reason: `Adds ${change.required ? "required" : "optional"} field ${change.field}` };
  return { points: 10, reason: `Unclassified change on ${change.field || "schema"}` };
}

function buildMigrationSql(dataset, changes) {
  const table = dataset.name || "target_table";
  const lines = [
    `-- LineageGuard staged migration for ${table}`,
    "-- Review in a non-production environment before execution.",
    "BEGIN;",
  ];

  for (const change of changes) {
    const field = q(change.field);
    if (change.kind === "rename") {
      const next = q(change.to);
      lines.push(
        `-- Additive rename: keep ${field} until every downstream consumer migrates.`,
        `ALTER TABLE ${table} ADD COLUMN ${next} ${change.type || "VARCHAR"};`,
        `UPDATE ${table} SET ${next} = ${field} WHERE ${next} IS NULL;`
      );
    } else if (change.kind === "type_change") {
      const shadow = `${field}__next`;
      lines.push(
        `-- Shadow-column conversion prevents an irreversible in-place cast.`,
        `ALTER TABLE ${table} ADD COLUMN ${shadow} ${change.to};`,
        `UPDATE ${table} SET ${shadow} = TRY_CAST(${field} AS ${change.to});`,
        `-- Block promotion when this query returns rows:`,
        `SELECT * FROM ${table} WHERE ${field} IS NOT NULL AND ${shadow} IS NULL;`
      );
    } else if (change.kind === "drop") {
      lines.push(
        `-- Deferred destructive change: do not run until owners approve and usage is zero.`,
        `-- ALTER TABLE ${table} DROP COLUMN ${field};`
      );
    } else if (change.kind === "add") {
      lines.push(`ALTER TABLE ${table} ADD COLUMN ${field} ${change.type || "VARCHAR"}${change.required ? " NOT NULL" : ""};`);
    }
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

function buildTests(dataset, changes) {
  const tests = [
    "Compare row count before and after migration.",
    "Compare primary-key uniqueness and null rates.",
    "Re-run known downstream queries and dashboards.",
  ];
  for (const change of changes) {
    if (change.kind === "rename") tests.push(`Assert ${change.field} and ${change.to} match during the compatibility window.`);
    if (change.kind === "type_change") tests.push(`Count failed casts from ${change.field} (${change.from}) to ${change.to}.`);
    if (change.kind === "drop") tests.push(`Confirm zero recent queries reference ${change.field} before removal.`);
  }
  if (dataset.qualitySignals?.length) tests.push("Re-run DataHub quality assertions tied to the dataset.");
  return [...new Set(tests)];
}

function buildPrMarkdown({ dataset, score, severity, reasons, impactedAssets, changes, tests }) {
  const impacted = impactedAssets.map((asset) => `- **${asset.name}** (${asset.type}) — owner: ${asset.owner || "unassigned"}`).join("\n") || "- No downstream assets returned.";
  const changeList = changes.map((change) => `- ${changeRisk(change).reason}`).join("\n");
  return `# LineageGuard change review\n\n## Decision\n\n**${severity.toUpperCase()} RISK — ${score}/100**\n\n## Proposed changes\n\n${changeList}\n\n## DataHub blast radius\n\n${impacted}\n\n## Risk signals\n\n${reasons.map((reason) => `- ${reason}`).join("\n")}\n\n## Required validation\n\n${tests.map((test) => `- [ ] ${test}`).join("\n")}\n\n## Rollout recommendation\n\nUse an additive compatibility window, notify every listed owner, validate downstream behavior, and remove legacy fields only after usage reaches zero.\n\n_Dataset: ${dataset.urn}_\n`;
}

export function analyzeImpact({ dataset, changes = [] }) {
  const impactedAssets = dataset.downstream || [];
  const reasons = [];
  let score = 0;

  for (const change of changes) {
    const risk = changeRisk(change);
    score += risk.points;
    reasons.push(`${risk.reason} (+${risk.points})`);
  }

  const assetPoints = Math.min(30, impactedAssets.reduce((sum, asset) => sum + pointsForAsset(asset), 0));
  if (assetPoints) {
    score += assetPoints;
    reasons.push(`${impactedAssets.length} downstream assets across DataHub lineage (+${assetPoints})`);
  }

  const missingOwners = impactedAssets.filter((asset) => !asset.owner).length;
  if (missingOwners) {
    const ownerPoints = Math.min(15, missingOwners * 5);
    score += ownerPoints;
    reasons.push(`${missingOwners} downstream assets have no assigned owner (+${ownerPoints})`);
  }

  const weeklyQueries = Number(dataset.weeklyQueries || 0);
  if (weeklyQueries >= 10) {
    const usagePoints = weeklyQueries >= 50 ? 15 : 10;
    score += usagePoints;
    reasons.push(`${weeklyQueries} recent weekly queries indicate active usage (+${usagePoints})`);
  }

  if ((dataset.tags || []).some((tag) => /pii|sensitive|financial/i.test(tag))) {
    score += 12;
    reasons.push("Sensitive-data tag increases rollout and validation risk (+12)");
  }

  score = Math.min(100, score);
  const severity = severityFor(score);
  const tests = buildTests(dataset, changes);
  const migrationSql = buildMigrationSql(dataset, changes);
  const prMarkdown = buildPrMarkdown({ dataset, score, severity, reasons, impactedAssets, changes, tests });

  return {
    dataset: { urn: dataset.urn, name: dataset.name, owner: dataset.owner, platform: dataset.platform },
    score,
    severity,
    decision: score >= 75 ? "block" : score >= 50 ? "approval-required" : "proceed-with-checks",
    reasons,
    impactedAssets,
    ownerNotifications: [...new Set(impactedAssets.map((asset) => asset.owner).filter(Boolean))],
    tests,
    migrationSql,
    prMarkdown,
    writeBackPlan: {
      status: "proposed",
      targetUrn: dataset.urn,
      summary: `LineageGuard ${severity} risk review (${score}/100)`,
      actions: [
        "Attach review summary to the dataset as a DataHub context document or proposal.",
        "Notify downstream owners before merge.",
        "Record the compatibility-window end date after approvals.",
      ],
    },
  };
}
