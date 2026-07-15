#!/usr/bin/env python3
"""Deterministically score a LineageGuard schema-change manifest."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


BASE_RISK = {
    "drop_field": 35,
    "narrow_type": 30,
    "rename_column": 28,
    "change_semantics": 25,
    "add_required_field": 18,
    "other": 12,
    "widen_type": 6,
    "add_nullable_field": 4,
}


def nonnegative_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise ValueError(f"{field} must be a non-negative number")
    return float(value)


def optional_count(signals: dict[str, Any], field: str) -> int | None:
    if field not in signals or signals[field] is None:
        return None
    value = signals[field]
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"signals.{field} must be a non-negative integer or null")
    return value


def optional_number(signals: dict[str, Any], field: str) -> float | None:
    if field not in signals or signals[field] is None:
        return None
    return nonnegative_number(signals[field], f"signals.{field}")


def score_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    change = manifest.get("change")
    signals = manifest.get("signals")
    if not isinstance(change, dict) or not isinstance(signals, dict):
        raise ValueError("manifest must contain object fields: change and signals")

    entity = change.get("entity")
    kind = change.get("kind")
    if not isinstance(entity, str) or not entity.strip():
        raise ValueError("change.entity must be a non-empty string")
    if kind not in BASE_RISK:
        allowed = ", ".join(sorted(BASE_RISK))
        raise ValueError(f"change.kind must be one of: {allowed}")

    downstream = optional_count(signals, "downstream_assets")
    critical = optional_count(signals, "critical_assets")
    weekly_queries = optional_count(signals, "weekly_queries")
    incidents = optional_count(signals, "open_quality_incidents")
    owners = optional_count(signals, "owners_identified")
    coverage = optional_number(signals, "test_coverage")
    rollback = signals.get("rollback_ready") if "rollback_ready" in signals else None
    deprecation = optional_number(signals, "deprecation_days")

    if coverage is not None and coverage > 1:
        raise ValueError("signals.test_coverage must be between 0 and 1")
    if rollback is not None and not isinstance(rollback, bool):
        raise ValueError("signals.rollback_ready must be true, false, or omitted")
    if "breaking" in change and not isinstance(change["breaking"], bool):
        raise ValueError("change.breaking must be true, false, or omitted")

    components: list[dict[str, Any]] = []

    def add(label: str, points: float) -> None:
        if points:
            components.append({"factor": label, "points": round(points, 2)})

    raw = float(BASE_RISK[kind])
    add(f"base risk: {kind}", raw)

    if bool(change.get("breaking")) and kind not in {"drop_field", "rename_column", "narrow_type"}:
        raw += 8
        add("explicitly breaking change", 8)

    critical_points = min(30.0, (critical or 0) * 8.0)
    downstream_points = min(20.0, (downstream or 0) * 2.0)
    usage_points = min(15.0, 4.0 * math.log10((weekly_queries or 0) + 1.0))
    incident_points = min(10.0, (incidents or 0) * 4.0)
    raw += critical_points + downstream_points + usage_points + incident_points
    add("critical consumers", critical_points)
    add("downstream breadth", downstream_points)
    add("weekly usage", usage_points)
    add("open quality incidents", incident_points)

    if owners in (None, 0):
        raw += 8
        add("owner unknown or unassigned", 8)

    missing = []
    if owners is None:
        missing.append("owners_identified")
    for field, value, penalty in (
        ("downstream_assets", downstream, 8),
        ("critical_assets", critical, 12),
        ("weekly_queries", weekly_queries, 6),
        ("open_quality_incidents", incidents, 4),
    ):
        if value is None:
            missing.append(field)
            raw += penalty
            add(f"missing blast-radius evidence: {field}", penalty)
    for field, value in (("test_coverage", coverage), ("rollback_ready", rollback), ("deprecation_days", deprecation)):
        if value is None:
            missing.append(field)
            raw += 4
            add(f"missing safety evidence: {field}", 4)

    if coverage is not None:
        credit = min(10.0, coverage * 10.0)
        raw -= credit
        add("test coverage mitigation", -credit)
    if rollback is True:
        raw -= 8
        add("rollback-ready mitigation", -8)
    if deprecation is not None:
        credit = min(8.0, deprecation / 30.0 * 8.0)
        raw -= credit
        add("deprecation-window mitigation", -credit)

    score = max(0, min(100, round(raw)))
    decision = "APPROVE" if score <= 29 else "CONDITIONAL" if score <= 59 else "BLOCK"
    conditions = []
    if decision != "APPROVE":
        if coverage is None or coverage < 0.8:
            conditions.append("Reach at least 80% coverage for affected contracts and consumers.")
        if rollback is not True:
            conditions.append("Prepare and rehearse a bounded rollback plan.")
        if deprecation is None or deprecation < 14:
            conditions.append("Provide a compatibility or deprecation window of at least 14 days.")
        if owners in (None, 0):
            conditions.append("Identify an accountable owner and downstream approvers.")
        if critical is not None and critical > 0:
            conditions.append("Validate every critical consumer before production rollout.")

    return {
        "entity": entity,
        "change_kind": kind,
        "decision": decision,
        "risk_score": score,
        "signals": {
            "downstream_assets": downstream,
            "critical_assets": critical,
            "weekly_queries": weekly_queries,
            "open_quality_incidents": incidents,
            "owners_identified": owners,
        },
        "components": components,
        "missing_evidence": missing,
        "conditions": conditions,
        "evidence": manifest.get("evidence", []),
    }


def to_markdown(report: dict[str, Any]) -> str:
    signals = report["signals"]
    lines = [
        f"# LineageGuard decision: {report['decision']}",
        "",
        f"**Entity:** `{report['entity']}`  ",
        f"**Change:** `{report['change_kind']}`  ",
        f"**Risk score:** {report['risk_score']}/100",
        "",
        "## Blast radius",
        "",
        f"- Downstream assets: {signals['downstream_assets'] if signals['downstream_assets'] is not None else 'unknown'}",
        f"- Critical assets: {signals['critical_assets'] if signals['critical_assets'] is not None else 'unknown'}",
        f"- Weekly queries: {signals['weekly_queries'] if signals['weekly_queries'] is not None else 'unknown'}",
        f"- Open quality incidents: {signals['open_quality_incidents'] if signals['open_quality_incidents'] is not None else 'unknown'}",
        "",
        "## Score components",
        "",
    ]
    lines.extend(f"- {item['factor']}: {item['points']:+g}" for item in report["components"])
    if report["conditions"]:
        lines.extend(["", "## Required conditions", ""])
        lines.extend(f"- {item}" for item in report["conditions"])
    if report["missing_evidence"]:
        lines.extend(["", "## Missing evidence", ""])
        lines.extend(f"- `{item}`" for item in report["missing_evidence"])
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", help="JSON manifest path, or - for stdin")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        raw = sys.stdin.read() if args.manifest == "-" else Path(args.manifest).read_text(encoding="utf-8")
        manifest = json.loads(raw)
        if not isinstance(manifest, dict):
            raise ValueError("manifest root must be a JSON object")
        report = score_manifest(manifest)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"lineageguard: {exc}", file=sys.stderr)
        return 2

    if args.format == "markdown":
        sys.stdout.write(to_markdown(report))
    else:
        json.dump(report, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
