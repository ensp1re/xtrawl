#!/usr/bin/env python3
"""Measure declared harness context budgets."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    manifest = json.loads((ROOT / ".harness/manifest.json").read_text(encoding="utf-8"))
    failures: list[str] = []
    for budget in manifest.get("budgets", []):
        total = 0
        for relative in budget.get("paths", []):
            path = ROOT / relative
            total += path.stat().st_size
        limit = int(budget.get("maxBytes", 0))
        print(f"budget={budget.get('name')} bytes={total} limit={limit}")
        if total > limit:
            failures.append(str(budget.get("name")))
    if failures:
        print("over_budget=" + ",".join(failures))
        return 1
    print("context_budget=passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
