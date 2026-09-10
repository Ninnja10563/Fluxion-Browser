#!/usr/bin/env python3
"""Install an exact local chrome override, leaving Gecko's archive untouched."""

import os
from pathlib import Path
import sys
import tempfile
import zipfile

ENTRY = "chrome/browser/content/browser/default-bookmarks.html"
MANIFEST = "override chrome://browser/content/default-bookmarks.html default-bookmarks.html\n"


def install(resources, asset):
    resources = Path(resources)
    archive = resources / "browser" / "omni.ja"
    # Fail rather than silently shipping inherited defaults if upstream moves
    # this resource. Reading a symlinked Linux archive is safe; never rewrite it.
    with zipfile.ZipFile(archive) as source:
        matches = [entry for entry in source.infolist() if entry.filename == ENTRY]
        if len(matches) != 1 or matches[0].is_dir():
            raise ValueError("Unsupported Gecko default-bookmarks resource layout")
        if matches[0].file_size > 1024 * 1024:
            raise ValueError("Unexpected Gecko default-bookmarks resource size")
        source.read(matches[0])  # Validate the selected entry's CRC as well.
    data = Path(asset).read_bytes()
    if not data or len(data) > 16384:
        raise ValueError("Invalid Fluxion default bookmark asset")
    destination = resources / "fluxion-defaults"
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise ValueError("Refusing a non-directory Fluxion defaults destination")
    destination.mkdir(mode=0o755, exist_ok=True)
    for name, contents in (("default-bookmarks.html", data), ("chrome.manifest", MANIFEST.encode("utf-8"))):
        target = destination / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError("Refusing a non-regular Fluxion defaults file")
        descriptor, temporary = tempfile.mkstemp(prefix=".fluxion-default-", dir=destination)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(contents)
            os.chmod(temporary, 0o644)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: install-default-bookmarks.py RUNTIME_RESOURCES BOOKMARK_ASSET")
    try:
        install(*sys.argv[1:])
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        sys.exit(f"Fluxion default bookmarks: {error}")
