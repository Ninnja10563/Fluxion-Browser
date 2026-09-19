#!/usr/bin/env python3
"""Apply Fluxion's narrow last-window policy to the pinned macOS Gecko archive.

No runtime monkeypatching or second session database. Upstream member hashes
must match exactly. Other archive members retain their data and metadata; the
Mozilla front directory/preload layout is retained after rebuilding the ZIP.
"""
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

_spec = importlib.util.spec_from_file_location("fluxion_archive", Path(__file__).with_name("install-default-bookmarks.py"))
_archive = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_archive)

VERSION = "155.0.1"
HASHES = {
    "modules/sessionstore/SessionStore.sys.mjs": "456cef74607b5abafc352909f6f4a67901140cb358cf606fc55c9f1f21d700a1",
    "modules/sessionstore/SessionSaver.sys.mjs": "c542e5d51cbf50bd27ffae0e294174444c87cbc8162eb2d51542ac72434ea374",
    "chrome/browser/content/browser/tabbrowser/tabbrowser.js": "b9b385572ad4652dd24093f3058d3cd530effa4ff69867962f2e4379a85eda8b",
}
DEPENDENCY_HASHES = {
    # uriToLoadPromise is a self-replacing getter in this exact browser-init.
    # Verify its interface too; it is not modified by this patch.
    "chrome/browser/content/browser/browser-init.js": "0ea807ebb883698d1798a29c628b3c8c8888c5ae0bdfbabb1911b2a37fe894e1",
}

STORE_REPLACEMENTS = [
    ('''  initializeWindow(aWindow, aInitialState = null) {''', '''  // Fluxion: retain Gecko restoration, but make macOS's last regular window
  // follow the explicit startup choice. Private windows never opt into this.
  get _fluxionRestoreLastWindow() {
    return AppConstants.platform == "macosx" &&
      !PrivateBrowsingUtils.permanentPrivateBrowsing &&
      Services.prefs.getIntPref("browser.startup.page", 1) == 3;
  },

  initializeWindow(aWindow, aInitialState = null) {'''),
    ('''          AppConstants.platform == "macosx" ||
          !lazy.SessionStartup.willRestore()''', '''          (AppConstants.platform == "macosx"
            ? !this._fluxionRestoreLastWindow
            : !lazy.SessionStartup.willRestore())'''),
    ('''    if (this._restoreLastWindow && aWindow.toolbar.visible) {''', '''    if (this._restoreLastWindow && aWindow.toolbar.visible &&
        (!this._fluxionRestoreLastWindow || isRegularWindow)) {'''),
    ('''      if (AppConstants.platform != "macosx") {
        // Until we decide otherwise elsewhere, this window is part of a series''', '''      if (AppConstants.platform != "macosx" ||
          (this._fluxionRestoreLastWindow && !winData.isPrivate &&
           !winData.isPopup && !winData.isTaskbarTab &&
           Object.values(this._windows).filter(data =>
             !data.isPrivate && !data.isPopup && !data.isTaskbarTab).length == 1)) {
        // Until we decide otherwise elsewhere, this window is part of a series'''),
    ('''  _clearRestoringWindows: function ssi_clearRestoringWindows() {
    for (let i = 0; i < this._closedWindows.length; i++) {''', '''  _clearRestoringWindows: function ssi_clearRestoringWindows() {
    // Private-only activity must not discard the normal last-window session.
    if (this._fluxionRestoreLastWindow && !Object.values(this._windows).some(
      data => !data.isPrivate && !data.isPopup && !data.isTaskbarTab)) {
      return;
    }
    for (let i = 0; i < this._closedWindows.length; i++) {'''),
    ('''          let options = { overwriteTabs: this._isCmdLineEmpty(aWindow, state) };
          this.restoreWindow(aWindow, newWindowState, options);''', '''          let options = { overwriteTabs: this._isCmdLineEmpty(aWindow, state) };
          if (this._fluxionRestoreLastWindow && options.overwriteTabs) {
            // browser-init caches the homepage URI before SessionStore sees
            // this new window. Initial-session policy cannot anticipate a
            // later last-window reopen: discard only that redundant default
            // request, never an explicit external URL or file argument.
            void aWindow.gBrowserInit.uriToLoadPromise;
            aWindow.gBrowserInit.uriToLoadPromise = null;
          }
          this.restoreWindow(aWindow, newWindowState, options);'''),
]

SAVER_REPLACEMENTS = [
    ('''    // Clear cookies and storage on clean shutdown.
    this._maybeClearCookiesAndStorage(state);''', '''    // Fluxion: project only the last regular window into the next startup.
    // Work on the serialized snapshot: keep the live native closed-window
    // record intact for undoCloseWindow and subsequent background saves.
    if (AppConstants.platform == "macosx" &&
        !lazy.PrivateBrowsingUtils.permanentPrivateBrowsing &&
        Services.prefs.getIntPref("browser.startup.page", 1) == 3 &&
        !state.windows.some(win => !win.isPrivate && !win.isPopup && !win.isTaskbarTab)) {
      const index = state._closedWindows.findIndex(win =>
        win._shouldRestore && !win.isPrivate && !win.isPopup && !win.isTaskbarTab);
      if (index >= 0) {
        const restored = { ...state._closedWindows[index] };
        delete restored._shouldRestore;
        delete restored.closedAt;
        delete restored.closedId;
        state._closedWindows.splice(index, 1);
        state.windows.unshift(restored);
        state.selectedWindow = 1;
      }
    }

    // Clear cookies and storage on clean shutdown.
    this._maybeClearCookiesAndStorage(state);'''),
]

TAB_REPLACEMENTS = [
    ('''      if (newTab) {
        this.addTrustedTab(BROWSER_NEW_TAB_URL, {''', '''      if (newTab) {
        const replacementTab = this.addTrustedTab(BROWSER_NEW_TAB_URL, {'''),
    ('''          tabIndex: 0,
        });
      } else {
        TabBarVisibility.update();''', '''          tabIndex: 0,
        });
        // Only Gecko's automatic last-tab replacement is an empty workspace.
        // Explicit blank tabs remain ordinary user tabs, including for undo.
        replacementTab.setAttribute("fluxion-empty-workspace", "true");
        try {
          window.FluxionEmptyWorkspace?.adopt(replacementTab);
        } catch (error) {
          console.error("Fluxion empty workspace adoption", error);
        }
      } else {
        TabBarVisibility.update();'''),
    ('''          adoptedBy: adoptedByTab,
          skipSessionStore,
          metricsContext,''', '''          adoptedBy: adoptedByTab,
          skipSessionStore: skipSessionStore || aTab.hasAttribute("fluxion-empty-workspace"),
          metricsContext,'''),
    ('''        this.tabs.length == tabs.length &&
        Services.prefs.getBoolPref("browser.tabs.closeWindowWithLastTab")''', '''        this.tabs.length == tabs.length &&
        !window.toolbar.visible &&
        Services.prefs.getBoolPref("browser.tabs.closeWindowWithLastTab")'''),
    ('''      return (
        !window.toolbar.visible ||
        Services.prefs.getBoolPref("browser.tabs.closeWindowWithLastTab")
      );''', '''      // Fluxion keeps a normal browser window available after its final tab
      // closes. Popup teardown remains native; explicit window-close and Quit
      // do not use this tab-removal decision.
      return !window.toolbar.visible;'''),
    ('''        closeWindow =
          closeWindowWithLastTab ?? this.#shouldCloseWindowWithLastTab;

        if (closeWindow) {''', '''        closeWindow =
          closeWindowWithLastTab ?? this.#shouldCloseWindowWithLastTab;

        // This archive belongs to Fluxion: the policy must also hold before
        // its sidebar initializes and while workspace metadata is restoring.
        // Preserve explicit cross-window adoption teardown, not ordinary tab
        // closing. Beforeunload has already run through Gecko above this point.
        if (closeWindow && !adoptedByTab && window.toolbar.visible) {
          closeWindow = false;
        }

        if (closeWindow) {'''),
]

REPLACEMENTS = {
    "modules/sessionstore/SessionStore.sys.mjs": STORE_REPLACEMENTS,
    "modules/sessionstore/SessionSaver.sys.mjs": SAVER_REPLACEMENTS,
    "chrome/browser/content/browser/tabbrowser/tabbrowser.js": TAB_REPLACEMENTS,
}


def patch_source(name, data):
    if hashlib.sha256(data).hexdigest() != HASHES[name]:
        raise ValueError(f"Unrecognized Gecko {VERSION} source: {name}")
    source = data.decode("utf-8")
    replacements = REPLACEMENTS[name]
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError(f"Session policy anchor drift: {name}")
        source = source.replace(before, after, 1)
    return source.encode("utf-8")


def optimize_zip(data, preload_members):
    """Restore Mozilla's front-directory layout, keeping its preload boundary."""
    footer = bytearray(data[-22:])
    if footer[:4] != b"PK\x05\x06" or struct.unpack_from("<H", footer, 20)[0]:
        raise ValueError("Unsupported rebuilt archive footer")
    directory_start = struct.unpack_from("<I", footer, 16)[0]
    directory_size = struct.unpack_from("<I", footer, 12)[0]
    if directory_start + directory_size + 22 != len(data):
        raise ValueError("Unsupported rebuilt directory layout")
    directory = bytearray(data[directory_start:-22])
    local_start = 4 + len(directory) + 22
    offset = 0
    preload = local_start
    while offset < len(directory):
        if directory[offset:offset + 4] != b"PK\x01\x02":
            raise ValueError("Malformed rebuilt directory")
        name_size, extra_size, comment_size = struct.unpack_from("<3H", directory, offset + 28)
        local_offset = struct.unpack_from("<I", directory, offset + 42)[0]
        name = bytes(directory[offset + 46:offset + 46 + name_size]).decode("utf-8")
        if name in preload_members:
            local_name, local_extra = struct.unpack_from("<2H", data, local_offset + 26)
            compressed_size = struct.unpack_from("<I", directory, offset + 20)[0]
            preload = max(preload, local_start + local_offset + 30 + local_name + local_extra + compressed_size)
        struct.pack_into("<I", directory, offset + 42, local_offset + local_start)
        offset += 46 + name_size + extra_size + comment_size
    struct.pack_into("<I", footer, 16, 4)
    return struct.pack("<I", preload) + directory + footer + data[:directory_start] + footer


def install(resources):
    resources = Path(resources)
    archive = resources / "browser" / "omni.ja"
    if resources.is_symlink() or archive.parent.is_symlink() or archive.is_symlink() or not archive.is_file():
        raise ValueError("Refusing a symlinked or non-regular runtime archive")
    identity = configparser.ConfigParser()
    identity.read(resources / "application.ini")
    if identity.get("App", "Version", fallback="") != VERSION:
        raise ValueError(f"Session policy supports only Gecko {VERSION}")
    with archive.open("rb") as original:
        preload = struct.unpack("<I", original.read(4))[0]
    with _archive.readable_archive(archive) as source:
        entries = source.infolist()
        names = [entry.filename for entry in entries]
        if len(set(names)) != len(names) or any(names.count(name) != 1 for name in {**HASHES, **DEPENDENCY_HASHES}):
            raise ValueError("Ambiguous or missing Gecko session modules")
        for name, digest in DEPENDENCY_HASHES.items():
            if hashlib.sha256(source.read(name)).hexdigest() != digest:
                raise ValueError(f"Unrecognized Gecko {VERSION} startup interface: {name}")
        patches = {name: patch_source(name, source.read(name)) for name in HASHES}
        # Preserve upstream order and all ZipInfo metadata, including compression.
        preload_members = {entry.filename for entry in entries if entry.header_offset < preload}
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", allowZip64=False) as target:
            for entry in entries:
                target.writestr(entry, patches.get(entry.filename, source.read(entry)))
        result = optimize_zip(output.getvalue(), preload_members)
    descriptor, temporary = tempfile.mkstemp(prefix=".fluxion-session-", dir=archive.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(result)
        # Validate the rebuilt archive and the exact patched members before replacing.
        with _archive.readable_archive(temporary) as check:
            if check.testzip() is not None or any(check.read(name) != data for name, data in patches.items()):
                raise ValueError("Session policy archive validation failed")
        os.chmod(temporary, archive.stat().st_mode & 0o777)
        os.replace(temporary, archive)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: install-macos-session-policy.py RUNTIME_RESOURCES")
    try:
        install(sys.argv[1])
    except (OSError, ValueError, KeyError, configparser.Error, zipfile.BadZipFile) as error:
        sys.exit(f"Fluxion macOS session policy: {error}")
