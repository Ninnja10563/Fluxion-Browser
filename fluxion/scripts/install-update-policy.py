#!/usr/bin/env python3
"""Merge Fluxion's app-update boundary without discarding inherited policies."""
import json
import os
import pathlib
import sys
import tempfile


def install(directory, template):
    directory = pathlib.Path(directory)
    if directory.is_symlink():
        raise ValueError("Refusing to write policies through a distribution directory symlink")
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "policies.json"
    existing = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    required = json.loads(pathlib.Path(template).read_text(encoding="utf-8"))
    if not isinstance(existing, dict) or not isinstance(existing.get("policies", {}), dict):
        raise ValueError("Existing Firefox policies must be a JSON object")
    existing.setdefault("policies", {}).update(required["policies"])
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as output:
            temporary = pathlib.Path(output.name)
            json.dump(existing, output, indent=2)
            output.write("\n")
        temporary.chmod(0o644)
        # Replace an inherited file symlink, never mutate the upstream Firefox.
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: install-update-policy.py distribution-directory policy-template")
    install(sys.argv[1], sys.argv[2])
