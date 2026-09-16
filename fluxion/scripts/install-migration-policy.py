#!/usr/bin/env python3
"""Keep Gecko's real import wizard reachable from Fluxion's custom preferences."""
import configparser
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import struct
import sys
import tempfile
import zipfile

_spec = importlib.util.spec_from_file_location("fluxion_archive_tools", Path(__file__).with_name("install-macos-session-policy.py"))
archive_tools = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(archive_tools)
VERSION = "155.0.1"
ENTRY = "modules/MigrationUtils.sys.mjs"
SHA256 = "716f00d79421bb4765fe406fb8aad953294edbf312513f78428d246c283c887a"
BEFORE = "    if (aOpener?.openPreferences) {"
AFTER = """    // Fluxion owns the preferences surface; preserve Gecko's native wizard
    // in its standalone window instead of hiding it behind custom Settings.
    if (aOpener?.FluxionUI && aOpener.document?.nodePrincipal?.isSystemPrincipal) {
      // The preferences route checks this before displaying its subdialog.
      if (Services.policies && !Services.policies.isAllowed("profileImport")) {
        return Promise.resolve();
      }
      return openStandaloneWindow(false /* blocking */);
    }

    if (aOpener?.openPreferences) {"""


def patch_source(data):
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Unrecognized pinned MigrationUtils source")
    source = data.decode("utf-8")
    if source.count(BEFORE) != 1:
        raise ValueError("Migration routing anchor drift")
    return source.replace(BEFORE, AFTER, 1).encode("utf-8")


def install(resources):
    resources = Path(resources)
    archive = resources / "browser" / "omni.ja"
    if resources.is_symlink() or archive.parent.is_symlink() or archive.is_symlink() or not archive.is_file():
        raise ValueError("Refusing symlinked or non-regular migration archive")
    identity = configparser.ConfigParser()
    identity.read(resources / "application.ini")
    if identity.get("App", "Version", fallback="") != VERSION:
        raise ValueError(f"Migration routing supports only Gecko {VERSION}")
    with archive.open("rb") as original:
        preload = struct.unpack("<I", original.read(4))[0]
    with archive_tools._archive.readable_archive(archive) as source:
        entries = source.infolist()
        names = [entry.filename for entry in entries]
        if len(set(names)) != len(names) or names.count(ENTRY) != 1:
            raise ValueError("Ambiguous or missing MigrationUtils source")
        patched = patch_source(source.read(ENTRY))
        preload_members = {entry.filename for entry in entries if entry.header_offset < preload}
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", allowZip64=False) as target:
            for entry in entries:
                target.writestr(entry, patched if entry.filename == ENTRY else source.read(entry))
        result = archive_tools.optimize_zip(output.getvalue(), preload_members)
    descriptor, temporary = tempfile.mkstemp(prefix=".fluxion-migration-", dir=archive.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(result)
        with archive_tools._archive.readable_archive(temporary) as check:
            if check.testzip() is not None or check.read(ENTRY) != patched:
                raise ValueError("Migration archive validation failed")
        os.chmod(temporary, archive.stat().st_mode & 0o777)
        os.replace(temporary, archive)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: install-migration-policy.py RUNTIME_RESOURCES")
    try:
        install(sys.argv[1])
    except (OSError, ValueError, configparser.Error, zipfile.BadZipFile) as error:
        sys.exit(f"Fluxion migration policy: {error}")
