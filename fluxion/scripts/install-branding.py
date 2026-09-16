#!/usr/bin/env python3
"""Apply audited product branding to the pinned runtime, never to user data."""
import base64
import configparser
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("session_archive", ROOT / "scripts/install-macos-session-policy.py")
archive_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive_tools)


def brand_svg(mark, state="normal"):
    # Inline raster data survives SVG-as-image's ban on external resources.
    image = base64.b64encode(mark).decode("ascii")
    badge = ""
    if state == "warning":
        badge = '<path d="M76 63 96 96H56Z" fill="#f5c451" stroke="#302817" stroke-width="2"/><path d="M76 74v10m0 5v1" stroke="#302817" stroke-width="3" stroke-linecap="round"/>'
    elif state == "disabled":
        badge = '<circle cx="78" cy="80" r="16" fill="#eee" stroke="#555" stroke-width="2"/><path d="m67 91 22-22" stroke="#555" stroke-width="3"/>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" viewBox="0 0 100 100">'
            f'<image width="100" height="100" xlink:href="data:image/png;base64,{image}"/>{badge}</svg>').encode()


def patch_text(data, rule, name):
    if hashlib.sha256(data).hexdigest() != rule["sha256"]:
        raise ValueError(f"Unrecognized branding source: {name}")
    text = data.decode("utf-8")
    for change in rule["replacements"]:
        before, after = change["before"], change["after"]
        if not before or text.count(before) != 1:
            raise ValueError(f"Ambiguous branding anchor: {name}")
        text = text.replace(before, after, 1)
    return text.encode()


def install(resources, manifest=None, artwork=None):
    resources = Path(resources)
    strings = json.loads((ROOT / "branding/strings.json").read_text()) if manifest is None else manifest
    images = json.loads((ROOT / "branding/artwork.json").read_text()) if artwork is None else artwork
    identity = configparser.ConfigParser()
    identity.read(resources / "application.ini")
    if identity.get("App", "Version", fallback="") != strings["version"] or strings["version"] != images["version"]:
        raise ValueError("Unsupported Gecko branding version")
    mark = (ROOT / "assets/app-icons/fluxion-mark.png").read_bytes()
    if hashlib.sha256(mark).hexdigest() != images["markSHA256"]:
        raise ValueError("Transparent Fluxion artwork digest changed")
    # PNG RGBA is required; the native gate independently checks decoded alpha.
    if mark[:8] != b"\x89PNG\r\n\x1a\n" or mark[25] != 6:
        raise ValueError("Fluxion artwork must retain its alpha channel")
    prepared = []
    try:
        for relative in sorted(set(strings["archives"]) | set(images["archives"])):
            if relative not in ("omni.ja", "browser/omni.ja"):
                raise ValueError("Unexpected branding archive target")
            archive = resources / relative
            if resources.is_symlink() or archive.parent.is_symlink() or archive.is_symlink() or not archive.is_file():
                raise ValueError("Refusing symlinked or non-regular branding archive")
            with archive.open("rb") as file:
                preload = struct.unpack("<I", file.read(4))[0]
            with archive_tools._archive.readable_archive(archive) as source:
                entries = source.infolist()
                names = [entry.filename for entry in entries]
                rules = strings["archives"].get(relative, {})
                art = images["archives"].get(relative, {})
                if len(set(names)) != len(names) or set(rules) & set(art) or not (set(rules) | set(art)) <= set(names):
                    raise ValueError("Missing, duplicate or overlapping branding targets")
                patches = {name: patch_text(source.read(name), rule, name) for name, rule in rules.items()}
                for name, rule in art.items():
                    if hashlib.sha256(source.read(name)).hexdigest() != rule["sha256"]:
                        raise ValueError(f"Unrecognized branding artwork: {name}")
                    kind = rule["kind"]
                    if kind == "png":
                        patches[name] = mark
                    elif kind in ("normal", "warning", "disabled"):
                        patches[name] = brand_svg(mark, kind)
                    elif kind == "wordmark":
                        patches[name] = b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="48" viewBox="0 0 200 48"><text x="0" y="36" font-family="system-ui,sans-serif" font-size="40" font-weight="600" fill="context-fill">Fluxion</text></svg>'
                    else:
                        raise ValueError("Unknown branding artwork kind")
                output = io.BytesIO()
                with zipfile.ZipFile(output, "w", allowZip64=False) as target:
                    for entry in entries:
                        target.writestr(entry, patches.get(entry.filename, source.read(entry)))
                result = archive_tools.optimize_zip(output.getvalue(), {entry.filename for entry in entries if entry.header_offset < preload})
            descriptor, temporary = tempfile.mkstemp(prefix=".fluxion-branding-", dir=archive.parent)
            prepared.append((archive, temporary))
            with os.fdopen(descriptor, "wb") as target:
                target.write(result)
            with archive_tools._archive.readable_archive(temporary) as check:
                if check.namelist() != names or check.testzip() is not None or any(check.read(name) != data for name, data in patches.items()):
                    raise ValueError("Rebuilt branding archive failed validation")
            os.chmod(temporary, archive.stat().st_mode & 0o777)
        # Validate all archives before replacing either. Packaging fails closed
        # on I/O failure; a partially built app is never signed or published.
        for archive, temporary in prepared:
            os.replace(temporary, archive)
    finally:
        for _, temporary in prepared:
            if os.path.exists(temporary):
                os.unlink(temporary)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: install-branding.py RUNTIME_RESOURCES")
    try:
        install(sys.argv[1])
    except (OSError, ValueError, KeyError, configparser.Error, zipfile.BadZipFile) as error:
        sys.exit(f"Fluxion branding: {error}")
