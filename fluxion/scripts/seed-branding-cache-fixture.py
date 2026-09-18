#!/usr/bin/env python3
"""Restore only the pinned old brand terms in an owned disposable test app."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def seed(resources):
    resources = Path(resources).resolve()
    if (resources.name != "Resources" or resources.parent.name != "Contents" or
            resources.parent.parent.name != "Fluxion.app" or
            not resources.parent.parent.parent.name.startswith("fluxion-branding-upgrade.")):
        raise ValueError("Only an isolated branding-upgrade fixture may be seeded")
    spec = importlib.util.spec_from_file_location("branding", ROOT / "scripts/install-branding.py")
    branding = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(branding)
    fixtures = json.loads((ROOT / "tests/fixtures/gecko-branding-155.json").read_text())
    rules = json.loads((ROOT / "branding/strings.json").read_text())["archives"]["browser/omni.ja"]
    archive = resources / "browser/omni.ja"
    names = ["localization/en-US/branding/brand.ftl", "chrome/en-US/locale/branding/brand.properties"]
    with archive.open("rb") as file:
        preload = struct.unpack("<I", file.read(4))[0]
    with branding.archive_tools._archive.readable_archive(archive) as source:
        entries = source.infolist()
        replacements = {}
        for name in names:
            original = fixtures["archives"]["browser/omni.ja"][name].encode()
            if hashlib.sha256(original).hexdigest() != rules[name]["sha256"]:
                raise ValueError("Fixture does not match the pinned original branding")
            if source.read(name) != branding.patch_text(original, rules[name], name):
                raise ValueError("Candidate branding is not the exact expected patched resource")
            replacements[name] = original
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", allowZip64=False) as target:
            for entry in entries:
                target.writestr(entry, replacements.get(entry.filename, source.read(entry)))
        result = branding.archive_tools.optimize_zip(output.getvalue(),
            {entry.filename for entry in entries if entry.header_offset < preload})
    archive.write_bytes(result)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: seed-branding-cache-fixture.py DISPOSABLE_APP_RESOURCES")
    seed(sys.argv[1])
