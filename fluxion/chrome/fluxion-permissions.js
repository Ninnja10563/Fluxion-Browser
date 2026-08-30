/* global Ci, Cu, Services, FluxionPermissionPolicy */
(function initialiseFluxionPermissions(window) {
  "use strict";

  if (window.FluxionPermissions) return;
  let recordsById = new Map();
  const listeners = new Set();

  function permissionRecord(permission) {
    try {
      const principal = permission.principal;
      if (!principal || principal.isSystemPrincipal) return null;
      return FluxionPermissionPolicy.normalise({
        origin: principal.originNoSuffix || principal.URI?.prePath || principal.origin,
        originAttributes: principal.originSuffix || "",
        type: permission.type,
        capability: permission.capability,
        expireType: permission.expireType,
        expireTime: permission.expireTime,
        modificationTime: permission.modificationTime,
        browserId: permission.browserId || 0,
      });
    } catch (_) {
      return null;
    }
  }

  function list() {
    const next = new Map();
    const records = [];
    for (const permission of Services.perms.all) {
      const record = permissionRecord(permission);
      if (!record) continue;
      next.set(record.id, permission);
      records.push(record);
    }
    recordsById = next;
    return records.sort((a, b) => a.site.localeCompare(b.site) || a.typeLabel.localeCompare(b.typeLabel));
  }

  function notify() {
    const records = list();
    for (const listener of listeners) {
      try { listener(records); } catch (error) { Cu.reportError(error); }
    }
  }

  function remove(id) {
    list();
    const permission = recordsById.get(String(id));
    if (!permission) return false;
    Services.perms.removePermission(permission);
    notify();
    return true;
  }

  function removeSite(siteKey) {
    list();
    const ids = [...recordsById.entries()]
      .filter(([id]) => id.startsWith(`${siteKey}\n`))
      .map(([id]) => id);
    for (const id of ids) {
      const permission = recordsById.get(id);
      if (permission) Services.perms.removePermission(permission);
    }
    notify();
    return ids.length;
  }

  function clear() {
    Services.perms.removeAll();
    notify();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const observer = { observe: notify };
  Services.obs.addObserver(observer, "perm-changed");
  window.addEventListener("unload", () => {
    Services.obs.removeObserver(observer, "perm-changed");
    listeners.clear();
  }, { once: true });

  const api = Object.freeze({ clear, list, remove, removeSite, subscribe });
  window.FluxionPermissions = api;
  Services.prefs.setStringPref("fluxion.permissions.health", "native-permission-manager-loaded");
  Services.prefs.savePrefFile(null);

  if (Services.env.get("FLUXION_VISUAL_PERMISSIONS_TEST") === "1") {
    window.setTimeout(() => {
      try {
        const origin = "https://permissions.fluxion.test";
        for (const record of api.list().filter(item => item.origin === origin)) api.remove(record.id);
        const principal = Services.scriptSecurityManager.createContentPrincipal(
          Services.io.newURI(`${origin}/`), {},
        );
        const manager = Ci.nsIPermissionManager;
        Services.perms.addFromPrincipal(principal, "camera", manager.ALLOW_ACTION, manager.EXPIRE_NEVER);
        Services.perms.addFromPrincipal(principal, "microphone", manager.DENY_ACTION, manager.EXPIRE_SESSION);
        Services.perms.addFromPrincipal(principal, "geo", manager.PROMPT_ACTION, manager.EXPIRE_NEVER);
        const location = api.list().find(item => item.origin === origin && item.type === "geo");
        if (!location || !api.remove(location.id)) throw new Error("real location permission could not be reset");
        const remaining = api.list().filter(item => item.origin === origin);
        if (remaining.length !== 2 || remaining.some(item => item.type === "geo")) {
          throw new Error("permission mutation was not reflected by Gecko");
        }
        Services.prefs.setStringPref(
          "fluxion.permissions.visual.health", "real-permissions-enumerated-and-reset",
        );
        Services.prefs.savePrefFile(null);
      } catch (error) {
        Services.prefs.setStringPref("fluxion.permissions.visual.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      }
    }, 17200);
  }
})(window);
