/* global Services, SessionStore, ChromeUtils, Cu */
(function verifyWorkspaceQuality(window) {
  "use strict";
  if (Services.env.get("FLUXION_WORKSPACE_TEST") !== "1") return;
  const prefix = "fluxion.workspaceVerification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const report = { checks: [] };
  let companion;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const pause = () => new Promise(resolve => window.setTimeout(resolve, 50));
  async function waitFor(check, message) {
    const deadline = Date.now() + 20000;
    do { const value = check(); if (value) return value; await pause(); } while (Date.now() < deadline);
    throw new Error(message);
  }
  const stage = value => {
    Services.prefs.setStringPref(`${prefix}.stage`, value);
    Services.prefs.savePrefFile(null);
  };
  const painted = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  const flowButton = name => [...document.querySelectorAll(".fluxion-workspace")].find(button => button.title === name);
  const settingsRow = id => document.querySelector(`.fluxion-settings-workspace-row[data-workspace-id="${id}"]`);
  const action = (row, label) => [...row.querySelectorAll("button")].find(button => button.textContent === label);
  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    const ui = await waitFor(() => window.FluxionUI, "Flow did not initialize");
    const { TabStateFlusher } = ChromeUtils.importESModule("resource:///modules/sessionstore/TabStateFlusher.sys.mjs");
    const a = ui.createWorkspace("Verification A", { activate: false });
    const b = ui.createWorkspace("Verification B", { activate: false });
    assert(a && b, "Fixture workspaces could not be created");
    for (const mode of ["native", "flow"]) {
      stage(`reopen-${mode}`);
      ui.switchWorkspace(a.id);
      const title = `Fluxion workspace ${mode} restore`;
      const url = `data:text/html,${encodeURIComponent(`<title>${title}</title><p>Gecko workspace restoration fixture</p>`)}`;
      const tab = gBrowser.addTrustedTab(url, { skipAnimation: true });
      ui.setTabWorkspace(tab, a.id); gBrowser.selectedTab = tab;
      await waitFor(() => tab.linkedBrowser.currentURI.spec === url && tab.label === title && !tab.hasAttribute("busy"),
        "Workspace fixture page did not render");
      await TabStateFlusher.flush(tab.linkedBrowser);
      gBrowser.removeTab(tab, { animate: false });
      await waitFor(() => ui.closedTabs().some(row => row.url === url), "Closed page did not enter real SessionStore");
      ui.switchWorkspace(b.id);
      await painted();
      if (mode === "native") {
        assert(ui.runNativeCommand("History:UndoCloseTab"), "Native undo-close command is unavailable");
      } else {
        const source = ui.closedTabs().find(row => row.url === url);
        assert(ui.reopenClosedTab(source.sourceIndex), "Flow Recently Closed did not restore its tab");
      }
      await waitFor(() => {
        const selected = gBrowser.selectedTab;
        return selected.linkedBrowser.currentURI.spec === url && selected.label === title &&
          !selected.hasAttribute("busy") && ui.currentWorkspace() === a.id && !selected.hidden &&
          [...document.querySelectorAll(".fluxion-tab")].some(row => row._fluxionTab === selected && row.dataset.active === "true");
      }, `${mode} restored page is not represented by the active Flow workspace`);
      report.checks.push(`${mode}-reopen-selected-page-visible`);
    }
    stage("cross-window-flow");
    const before = new Set(Services.wm.getEnumerator("navigator:browser"));
    window.OpenBrowserWindow();
    companion = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")]
      .find(candidate => !before.has(candidate) && candidate.FluxionUI), "Companion window did not initialize");
    window.focus(); await painted();
    const button = flowButton(a.name);
    assert(button, "Workspace button is missing");
    button.focus();
    companion.FluxionUI.updateWorkspace(a.id, { name: "Verification renamed", accent: "sage" });
    companion.FluxionUI.moveWorkspace(a.id, -1);
    await painted();
    assert(flowButton("Verification renamed") === button && document.activeElement === button,
      "Cross-window metadata changes discarded the focused workspace button");
    const orderedNames = [...document.querySelectorAll(".fluxion-workspace")].map(item => item.title);
    assert(JSON.stringify(orderedNames) === JSON.stringify(ui.workspaces().map(item => item.name)), "Flow workspace order is stale");
    report.checks.push("cross-window-flow-identity-focus-order");

    stage("settings-draft");
    const settingsTab = gBrowser.addTrustedTab("about:preferences?fluxion=workspaces", { skipAnimation: true });
    ui.setTabWorkspace(settingsTab, ui.currentWorkspace()); gBrowser.selectedTab = settingsTab;
    const row = await waitFor(() => {
      const item = settingsRow(a.id);
      return item?.getBoundingClientRect().height > 0 && item;
    }, "Workspace Settings editor did not become visible");
    const input = row.querySelector(".fluxion-settings-workspace-name");
    input.focus(); input.value = "My uncommitted workspace";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.setSelectionRange(3, 11, "backward");
    companion.FluxionUI.updateWorkspace(a.id, { name: "Remote workspace", icon: "diamond", accent: "rose" });
    companion.FluxionUI.moveWorkspace(a.id, 1);
    await painted();
    assert(settingsRow(a.id) === row && row.querySelector("input") === input && document.activeElement === input &&
      input.value === "My uncommitted workspace" && input.selectionStart === 3 && input.selectionEnd === 11 &&
      input.selectionDirection === "backward", "Cross-window changes discarded the Settings draft, selection, or focus");
    assert(ui.workspaces().find(item => item.id === a.id).name === "Remote workspace", "Uncommitted draft overwrote remote metadata");
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert(companion.FluxionUI.workspaces().find(item => item.id === a.id).name === input.value,
      "Explicit draft commit did not synchronize to the companion");
    report.checks.push("settings-draft-selection-and-explicit-commit");
    stage("settings-reorder-delete");
    const up = action(row, "Up");
    assert(up && !up.disabled, "Fixture workspace cannot move earlier");
    up.focus(); up.click(); await painted();
    assert(row.contains(document.activeElement) && !document.activeElement.disabled,
      "Settings reorder lost focus or focused a disabled control");
    const down = action(row, "Down");
    assert(down && !down.disabled, "Fixture workspace cannot move later");
    down.focus(); down.click(); await painted();
    assert(row.contains(document.activeElement) && !document.activeElement.disabled,
      "Settings reverse reorder lost valid focus");
    input.focus();
    companion.FluxionUI.deleteWorkspace(a.id, { confirm: false });
    await painted();
    assert(!settingsRow(a.id) && document.activeElement?.isConnected &&
      document.activeElement.classList.contains("fluxion-settings-workspace-name"),
      "Deleted workspace editor did not recover focus to a surviving name field");
    assert(gBrowser.selectedTab === settingsTab, "Workspace metadata editing unexpectedly changed the selected Settings tab");
    report.checks.push("settings-reorder-and-deleted-row-focus");
    Services.prefs.setStringPref(`${prefix}.health`, "native-workspace-restoration-and-cross-window-editing-verified");
  }
  run().catch(error => {
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => {
    if (companion && !companion.closed) companion.close();
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.savePrefFile(null);
  });
})(window);
