#!/usr/bin/env python3
"""Keep explicit Fluxion Focus mode within Gecko's native fullscreen controller."""
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
ENTRY = "chrome/browser/content/browser/browser-fullScreenAndPointerLock.js"
SHA256 = "88464e8fef698473f4ad09036c4392845aaf61bc37f011fa9dd6054e48950748"
REPLACEMENTS = [
    ('''    if (!Services.prefs.getBoolPref("browser.fullscreen.autohide")) {
      return;
    }''', '''    // Fluxion's explicit, per-window Focus mode owns chrome visibility even
    // when an older profile retained autohide=false. Never change that pref,
    // bypass its managed lock, DOM fullscreen or kiosk policy, or affect
    // another window's behavior.
    const fluxionFocus = window.fullScreen &&
      document.documentElement.hasAttribute("data-fluxion-native-focus") &&
      !document.fullscreenElement &&
      !document.documentElement.hasAttribute("inDOMFullscreen") &&
      !BrowserHandler.kiosk;
    if (!Services.prefs.getBoolPref("browser.fullscreen.autohide") &&
        !(fluxionFocus && !Services.prefs.prefIsLocked("browser.fullscreen.autohide"))) {
      return;
    }'''),
    ('''      focused.localName == "input" &&
      !BrowserHandler.kiosk''', '''      focused.localName == "input" &&
      // Custom Settings/Library inputs belong to the page surface, not the
      // navigation toolbar. Native location/search editing still vetoes hide.
      (!fluxionFocus || gNavToolbox.contains(focused)) &&
      !BrowserHandler.kiosk'''),
]


def patch_source(data):
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Unrecognized pinned native fullscreen source")
    source = data.decode("utf-8")
    for before, after in REPLACEMENTS:
        if source.count(before) != 1:
            raise ValueError("Native Focus policy anchor drift")
        source = source.replace(before, after, 1)
    return source.encode("utf-8")


def install(resources):
    resources = Path(resources)
    archive = resources / "browser" / "omni.ja"
    if resources.is_symlink() or archive.parent.is_symlink() or archive.is_symlink() or not archive.is_file():
        raise ValueError("Refusing symlinked or non-regular fullscreen archive")
    identity = configparser.ConfigParser()
    identity.read(resources / "application.ini")
    if identity.get("App", "Version", fallback="") != VERSION:
        raise ValueError(f"Native Focus policy supports only Gecko {VERSION}")
    with archive.open("rb") as original:
        preload = struct.unpack("<I", original.read(4))[0]
    with archive_tools._archive.readable_archive(archive) as source:
        entries = source.infolist()
        names = [entry.filename for entry in entries]
        if len(set(names)) != len(names) or names.count(ENTRY) != 1:
            raise ValueError("Ambiguous or missing native fullscreen source")
        patched = patch_source(source.read(ENTRY))
        preload_members = {entry.filename for entry in entries if entry.header_offset < preload}
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", allowZip64=False) as target:
            for entry in entries:
                target.writestr(entry, patched if entry.filename == ENTRY else source.read(entry))
        result = archive_tools.optimize_zip(output.getvalue(), preload_members)
    descriptor, temporary = tempfile.mkstemp(prefix=".fluxion-focus-", dir=archive.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(result)
        with archive_tools._archive.readable_archive(temporary) as check:
            if check.testzip() is not None or check.read(ENTRY) != patched:
                raise ValueError("Native Focus archive validation failed")
        os.chmod(temporary, archive.stat().st_mode & 0o777)
        os.replace(temporary, archive)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: install-macos-focus-policy.py RUNTIME_RESOURCES")
    try:
        install(sys.argv[1])
    except (OSError, ValueError, configparser.Error, zipfile.BadZipFile) as error:
        sys.exit(f"Fluxion native Focus policy: {error}")
