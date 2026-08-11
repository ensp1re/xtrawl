#!/usr/bin/env python3
"""Small project-local harness validator with no third-party dependencies."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / ".harness" / "manifest.json"
PLACEHOLDER = re.compile(r"__[A-Z][A-Z0-9_]*__|\[TODO(?::[^\]]*)?\]", re.I)
SECRET = re.compile(r"(-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|sk-[A-Za-z0-9_-]{24,})")


def git(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def strings(value: object):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)


def main() -> int:
    errors: list[str] = []
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("status") != "operational":
        errors.append("manifest must be operational schema version 1")
    if manifest.get("project", {}).get("root") != ".":
        errors.append("manifest project root must be '.'")
    sources = manifest.get("sources", {})
    references: list[str] = []
    for value in sources.values():
        if isinstance(value, str):
            references.append(value)
        elif isinstance(value, list):
            references.extend(item for item in value if isinstance(item, str))
    for budget in manifest.get("budgets", []):
        references.extend(budget.get("paths", []))
    for relative in references:
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"missing referenced path: {relative}")
        elif path.stat().st_size > 2_000_000:
            errors.append(f"referenced path too large: {relative}")
    handoff = ROOT / sources.get("handoff", "")
    if not handoff.is_file():
        errors.append("handoff is missing")
    else:
        value = json.loads(handoff.read_text(encoding="utf-8"))
        for key in ("updatedAt", "goal", "status", "scope", "completed", "nextActions", "decisions", "openQuestions", "risks", "touchedPaths", "doNotRepeat", "contextSources", "verification", "git"):
            if key not in value:
                errors.append(f"handoff missing {key}")
        for text in strings(value):
            if PLACEHOLDER.search(text):
                errors.append("unresolved placeholder in handoff")
            if SECRET.search(text):
                errors.append("secret-like text in handoff")
    for text in strings(manifest):
        if PLACEHOLDER.search(text):
            errors.append("unresolved placeholder in manifest")
        if SECRET.search(text):
            errors.append("secret-like text in manifest")
    if git("status", "--short") == "":
        pass
    print(f"harness_validation={'passed' if not errors else 'failed'}")
    for error in errors:
        print(f"error={error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
