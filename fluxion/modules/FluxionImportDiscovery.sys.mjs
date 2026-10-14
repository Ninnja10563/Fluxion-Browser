// Local profile metadata only. Discovery never reads browsing databases,
// passwords, cookies or bookmark backups. Transfers require a separate action.
export function parseProfiles(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024) return [];
  const profiles = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const section = line.trim().match(/^\[([^\]]+)\]$/);
    if (section) {
      current = /^Profile\d+$/.test(section[1]) ? {} : null;
      if (current && profiles.length < 64) profiles.push(current);
      else current = null;
    } else if (current) {
      const entry = line.match(/^\s*(Name|Path|IsRelative)\s*=(.*)$/);
      if (entry) current[entry[1]] = entry[2].trim();
    }
  }
  return profiles.filter(p => p.Path && ["0", "1"].includes(p.IsRelative));
}

export function createImportDiscovery({ allowed, scan, latestBackup, confirm, importBackup, openWizard }) {
  let profiles = new Map(), busy = false, sequence = 0;
  const check = () => { if (!allowed()) throw new Error("Profile detection is unavailable in this window or disabled by your administrator."); };
  return Object.freeze({
    async discover() {
      check();
      if (busy) return { state: "busy" };
      busy = true;
      profiles.clear();
      try {
        const result = await scan();
        check();
        profiles = new Map(result.profiles.slice(0, 128).map(p => [String(++sequence), p]));
        return { state: "detected", profiles: [...profiles].map(([id, p]) => ({ id, source: p.source,
          name: String(p.name || "Default").slice(0, 160), kind: p.kind })), warnings: result.warnings };
      } finally { busy = false; }
    },
    async transfer(id) {
      check();
      if (busy) return { state: "busy" };
      const profile = profiles.get(id);
      if (!profile) throw new Error("Find profiles again and choose one from the list.");
      busy = true;
      try {
        if (profile.kind === "native") {
          await openWizard(profile);
          return { state: "wizard" };
        }
        if (!await confirm(profile)) return { state: "cancelled" };
        check();
        const backup = await latestBackup(profile);
        check();
        if (!backup) throw new Error("No readable bookmark backup was found. Export bookmarks as HTML in the source browser, then use Import bookmarks below.");
        const added = await importBackup(backup);
        return { state: "done", kind: "bookmarks", added: Number.isSafeInteger(added) ? added : 0 };
      } finally { busy = false; }
    },
  });
}

export function forWindow(window, { profileRoots, confirm } = {}) {
  const allowed = () => !window.closed && Services.policies?.isAllowed("profileImport") !== false &&
    !ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs").PrivateBrowsingUtils.isWindowPrivate(window);
  const normalise = path => {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path); file.normalize();
    return file;
  };
  const profileFolder = path => {
    const folder = normalise(path);
    if (!folder.isDirectory()) throw new Error("Profile folder is unavailable.");
    if (folder.equals(Services.dirsvc.get("ProfD", Ci.nsIFile))) return null;
    return folder.path;
  };
  return createImportDiscovery({
    allowed,
    async scan() {
      const profiles = [], warnings = [];
      const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
      const bases = Services.appinfo.OS === "Darwin"
        ? [["zen", PathUtils.join(home, "Library", "Application Support", "zen")],
          ["firefox", PathUtils.join(home, "Library", "Application Support", "Firefox")]]
        : Services.appinfo.OS === "WINNT"
          ? [["zen", PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "zen")],
            ["firefox", PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Mozilla", "Firefox")]]
          : [["zen", PathUtils.join(home, ".zen")], ["firefox", PathUtils.join(home, ".mozilla", "firefox")]];
      const seen = new Set();
      // Privileged callers may supply isolated roots for native verification;
      // the Settings caller always uses the platform's standard locations.
      for (const [source, base] of (profileRoots || bases)) {
        try {
          const registry = PathUtils.join(base, "profiles.ini");
          if (!await IOUtils.exists(registry)) continue;
          const stat = await IOUtils.stat(registry);
          if (stat.type !== "regular" || stat.size > 1024 * 1024) throw new Error("Invalid registry");
          const text = new TextDecoder().decode(await IOUtils.read(registry, { maxBytes: 1024 * 1024 }));
          for (const record of parseProfiles(text)) {
            try {
              // Registry paths are relative paths, not single leaf names.
              // PathUtils.join rejects separators in any component after base.
              const path = profileFolder(record.IsRelative === "1" ? PathUtils.joinRelative(base, record.Path) : record.Path);
              if (!path || seen.has(path)) continue;
              seen.add(path);
              profiles.push({ source, name: record.Name, path, kind: "backup" });
            } catch (_) { warnings.push(`${source}: a profile is missing or inaccessible.`); }
          }
        } catch (_) { warnings.push(`${source}: profile locations could not be read.`); }
      }
      // Native Chrome detection handles platform profile locations and access
      // requirements. Do not request OS permissions during discovery.
      try {
        const { MigrationUtils } = ChromeUtils.importESModule("resource:///modules/MigrationUtils.sys.mjs");
        const migrator = await MigrationUtils.getMigrator("chrome");
        if (migrator) {
          if (!await migrator.hasPermissions()) warnings.push("Chrome: use Choose browser data to grant access.");
          else for (const p of (await migrator.getSourceProfiles() || []).slice(0, 64)) {
            profiles.push({ source: "chrome", name: p.name || p.id, profileId: p.id, kind: "native" });
          }
        }
      } catch (_) { warnings.push("Chrome: profiles could not be detected. Use Choose browser data below."); }
      return { profiles, warnings: [...new Set(warnings)] };
    },
    async latestBackup(profile) {
      const path = profileFolder(profile.path);
      if (!path) return null;
      const folder = PathUtils.join(path, "bookmarkbackups");
      if (!await IOUtils.exists(folder)) return null;
      const candidates = (await IOUtils.getChildren(folder)).filter(file =>
        /^bookmarks-\d{4}-\d{2}-\d{2}(?:_[^/\\]+)?\.json(?:lz4)?$/.test(PathUtils.filename(file))).sort().reverse();
      for (const candidate of candidates.slice(0, 64)) {
        const info = await IOUtils.stat(candidate);
        if (info.type === "regular" && info.size > 0 && info.size <= 32 * 1024 * 1024) return candidate;
      }
      return null;
    },
    confirm: confirm || (profile => Services.prompt.confirm(window, "Import bookmarks",
      `Add bookmarks from the latest saved backup of ${profile.source === "zen" ? "Zen" : "Firefox"} — ${profile.name || "Default"}? Recent edits may not be in that backup. Existing Fluxion bookmarks will be kept. Repeating this import can add duplicates. Passwords, cookies and sessions are not copied.`)),
    importBackup: path => ChromeUtils.importESModule("resource://gre/modules/BookmarkJSONUtils.sys.mjs")
      .BookmarkJSONUtils.importFromFile(path, { replace: false }),
    openWizard: profile => {
      const { MigrationUtils } = ChromeUtils.importESModule("resource:///modules/MigrationUtils.sys.mjs");
      return MigrationUtils.showMigrationWizard(window, { entrypoint: MigrationUtils.MIGRATION_ENTRYPOINTS.PREFERENCES,
        migratorKey: "chrome", profileId: profile.profileId });
    },
  });
}
