#!/usr/bin/env python3
"""Compare identical stored-resource fixtures; not an installed-app size claim."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "5cf540467a718051b11aa39ab5469d263859393c"
SCRIPT = ROOT / "scripts/install-branding.py"
spec = importlib.util.spec_from_file_location("current_branding", SCRIPT)
current = importlib.util.module_from_spec(spec)
spec.loader.exec_module(current)
baseline = types.ModuleType("baseline_branding")
baseline.__file__ = str(SCRIPT)
exec(subprocess.check_output(
    ["git", "show", f"{BASELINE}:fluxion/scripts/install-branding.py"],
    cwd=ROOT, text=True,
), baseline.__dict__)
fixtures = json.loads((ROOT / "tests/fixtures/gecko-branding-155.json").read_text())
results = {}
with tempfile.TemporaryDirectory(prefix="fluxion-branding-size-") as temporary:
    for label, module in [("baseline", baseline), ("current", current)]:
        root = Path(temporary) / label
        (root / "browser").mkdir(parents=True)
        (root / "application.ini").write_text("[App]\nVersion=155.0.1\n")
        strings = json.loads((ROOT / "branding/strings.json").read_text())
        artwork = json.loads((ROOT / "branding/artwork.json").read_text())
        archives = sorted(set(strings["archives"]) | set(artwork["archives"]))
        for archive in archives:
            raw = {name: fixtures["archives"][archive][name].encode()
                   for name in strings["archives"].get(archive, {})}
            for name, rule in artwork["archives"].get(archive, {}).items():
                raw[name] = b"source artwork fixture"
                rule["sha256"] = hashlib.sha256(raw[name]).hexdigest()
            path = root / archive
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as output:
                for name, data in raw.items():
                    output.writestr(name, data)
            path.write_bytes(module.archive_tools.optimize_zip(path.read_bytes(), set(raw)))
        module.install(root, strings, artwork)
        results[label] = {archive: (root / archive).stat().st_size for archive in archives}
    # Check every decoded resource, not just aggregate sizes.
    for archive in archives:
        with current.archive_tools._archive.readable_archive(Path(temporary) / "baseline" / archive) as before:
            with current.archive_tools._archive.readable_archive(Path(temporary) / "current" / archive) as after:
                assert before.namelist() == after.namelist()
                assert before.testzip() is None and after.testzip() is None
                assert all(before.read(name) == after.read(name) for name in before.namelist())
before_size, after_size = (sum(results[label].values()) for label in ["baseline", "current"])
print(json.dumps({"baseline": BASELINE, "scope": "stored-resource fixture, identical decoded bytes",
                  "archives": results, "bytesSaved": before_size - after_size,
                  "percentSaved": round((before_size - after_size) * 100 / before_size, 2)}))
