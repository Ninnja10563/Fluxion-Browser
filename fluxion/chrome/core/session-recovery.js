/* global globalThis */
(function exposeSessionRecoveryPolicy(scope) {
  "use strict";

  const URLS = Object.freeze({
    groupA: "https://example.com/?fluxion-session=group-a",
    groupB: "https://example.org/?fluxion-session=group-b",
    splitA: "https://example.com/?fluxion-session=split-a",
    splitB: "https://example.org/?fluxion-session=split-b",
    pinned: "https://example.com/?fluxion-session=pinned",
    focusIdle: "https://example.org/?fluxion-session=focus-idle",
    focusActive: "https://example.com/?fluxion-session=focus-active",
    privateOnly: "https://example.com/?fluxion-private-only=1",
  });
  const EXPECTED_NORMAL_URLS = Object.freeze([
    URLS.groupA, URLS.groupB, URLS.splitA, URLS.splitB, URLS.pinned,
    URLS.focusIdle, URLS.focusActive,
  ]);
  const EXPECTED_WORKSPACES = Object.freeze({
    [URLS.groupA]: "build",
    [URLS.groupB]: "build",
    [URLS.splitA]: "build",
    [URLS.splitB]: "build",
    [URLS.pinned]: "build",
    [URLS.focusIdle]: "focus",
    [URLS.focusActive]: "focus",
  });
  const EXPECTED_WORKSPACE_LIST = Object.freeze([
    Object.freeze({ id: "focus", name: "Focus", accent: "slate", icon: "circle" }),
    Object.freeze({ id: "build", name: "Build", accent: "blue", icon: "diamond" }),
    Object.freeze({ id: "research-desk", name: "Research Desk", accent: "sage", icon: "square" }),
    Object.freeze({ id: "life", name: "Life", accent: "ochre", icon: "arc" }),
  ]);

  function clean(value, limit = 4096) {
    return String(value ?? "").trim().slice(0, limit);
  }

  function normaliseTab(tab) {
    return Object.freeze({
      url: clean(tab?.url),
      workspace: clean(tab?.workspace, 80),
      pinned: Boolean(tab?.pinned),
      group: clean(tab?.group, 120),
      split: clean(tab?.split, 4096),
      splitOrientation: clean(tab?.splitOrientation, 24),
      active: Boolean(tab?.active),
      selected: Boolean(tab?.selected),
    });
  }

  function validateNormal(snapshot, { requirePrivateAbsence = false } = {}) {
    const tabs = (snapshot?.tabs || []).map(normaliseTab);
    const workspaces = (snapshot?.workspaces || []).map(workspace => ({
      id: clean(workspace?.id, 80),
      name: clean(workspace?.name, 80),
      accent: clean(workspace?.accent, 24),
      icon: clean(workspace?.icon, 24),
    }));
    const reasons = [];
    if (snapshot?.isPrivate) reasons.push("restored window is private");
    if (clean(snapshot?.currentWorkspace, 80) !== "build") reasons.push("active workspace was not restored");
    for (const url of EXPECTED_NORMAL_URLS) {
      if (!tabs.some(tab => tab.url === url)) reasons.push(`missing ${url}`);
    }
    const pinned = tabs.find(tab => tab.url === URLS.pinned);
    if (!pinned?.pinned) reasons.push("pinned tab state was not restored");
    const grouped = [URLS.groupA, URLS.groupB].map(url => tabs.find(tab => tab.url === url));
    if (grouped.some(tab => !tab || tab.group !== "Recovery Lab")) {
      reasons.push("native tab group was not restored");
    }
    const split = [URLS.splitA, URLS.splitB].map(url => tabs.find(tab => tab.url === url));
    if (split.some(tab => !tab?.split) || split[0]?.split !== split[1]?.split) {
      reasons.push("native split pair was not restored");
    }
    if (split.some(tab => tab?.splitOrientation !== "stacked")) {
      reasons.push("stacked split orientation was not restored");
    }
    if (tabs.filter(tab => EXPECTED_NORMAL_URLS.includes(tab.url)).some(
      tab => tab.workspace !== EXPECTED_WORKSPACES[tab.url]
    )) {
      reasons.push("tab workspace membership was not restored");
    }
    for (const [workspace, expectedURL] of [["focus", URLS.focusActive], ["build", URLS.splitA]]) {
      const active = tabs.filter(tab => tab.workspace === workspace && tab.active);
      if (active.length !== 1 || active[0].url !== expectedURL) {
        reasons.push(`${workspace} active page was not restored`);
      }
    }
    if (!tabs.some(tab => tab.url === URLS.splitA && tab.selected)) {
      reasons.push("active Build page was not selected");
    }
    if (JSON.stringify(workspaces) !== JSON.stringify(EXPECTED_WORKSPACE_LIST)) {
      reasons.push("workspace names, symbols, accents, or order were not restored");
    }
    if (requirePrivateAbsence && tabs.some(tab => tab.url === URLS.privateOnly)) {
      reasons.push("private tab leaked into the normal session");
    }
    return Object.freeze({ ok: reasons.length === 0, reasons: Object.freeze(reasons) });
  }

  function validatePrivate(snapshot) {
    const reasons = [];
    if (!snapshot?.isPrivate) reasons.push("window is not private");
    if (snapshot?.memoryState !== "private") reasons.push("Browser Memory did not report private state");
    if (Number(snapshot?.memoryResults || 0) !== 0) reasons.push("Browser Memory returned private-window results");
    if (snapshot?.memoryEnabled === true) reasons.push("Browser Memory enabled inside a private window");
    return Object.freeze({ ok: reasons.length === 0, reasons: Object.freeze(reasons) });
  }

  function validatePrivateAbsence(snapshot) {
    const reasons = [];
    if (snapshot?.isPrivate) reasons.push("post-private verification window is private");
    if ((snapshot?.tabs || []).map(normaliseTab).some(tab => tab.url === URLS.privateOnly)) {
      reasons.push("private tab leaked into the normal session");
    }
    return Object.freeze({ ok: reasons.length === 0, reasons: Object.freeze(reasons) });
  }

  const api = Object.freeze({
    EXPECTED_NORMAL_URLS, EXPECTED_WORKSPACES, EXPECTED_WORKSPACE_LIST, URLS,
    clean, normaliseTab, validateNormal,
    validatePrivate, validatePrivateAbsence,
  });
  scope.FluxionSessionRecovery = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
