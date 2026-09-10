/* global Services, ChromeUtils, PathUtils, SessionStore, Cu */
(function verifyTabTransfer(window) {
  "use strict";
  if (Services.env.get("FLUXION_TAB_TRANSFER_TEST") !== "1") return;
  const prefix = "fluxion.tabTransfer.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const origin = Services.env.get("FLUXION_TAB_TRANSFER_ORIGIN");
  const report = { checks: [] }, ownedWindows = [], ownedTabs = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const write = (name, value) => { Services.prefs.setStringPref(`${prefix}.${name}`, value); Services.prefs.savePrefFile(null); };
  async function waitFor(predicate, message) {
    const deadline = Date.now() + 30000;
    do {
      const value = await predicate();
      if (value) return value;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(message);
  }
  const read = (tab, command = "Read") => tab.linkedBrowser.browsingContext.currentWindowGlobal
    .getActor("FluxionTabTransferVerification").sendQuery(`FluxionTabTransfer:${command}`, { origin });
  async function newWindow(privateMode = false) {
    const result = window.OpenBrowserWindow({ private: privateMode });
    ownedWindows.push(result);
    await waitFor(() => result.FluxionTabTransfer && result.FluxionUI && result.gBrowserInit?.delayedStartupFinished,
      "Transfer destination did not initialize");
    return result;
  }
  async function page(owner, { pinned = false, userContextId = 0 } = {}) {
    const tab = owner.gBrowser.addTrustedTab(`${origin}/transfer`, { userContextId, skipAnimation: true });
    ownedTabs.push(tab);
    owner.FluxionUI.selectTab(tab);
    await waitFor(async () => {
      if (tab.hasAttribute("busy") || tab.linkedBrowser.currentURI.spec !== `${origin}/transfer`) return false;
      try { return !!(await read(tab)).nonce; } catch { return false; }
    }, "Transfer source document did not render");
    const state = await read(tab, "Seed");
    assert(state.counter === 1 && state.draft === "Unsaved transfer draft — café" && state.nonce,
      "Source live document was not seeded");
    if (pinned) owner.gBrowser.pinTab(tab);
    return { tab, state };
  }
  function sameDocument(before, after) {
    assert(after.nonce === before.nonce && after.draft === before.draft && after.counter === before.counter &&
      after.historyLength === before.historyLength, "Native transfer lost the live document, draft, JavaScript state, or history");
  }
  const closedCount = owner => SessionStore.getClosedTabCountForWindow(owner);
  const loads = async () => {
    const response = await window.fetch(`${origin}/state`, { credentials: "omit", cache: "no-store" });
    assert(response.ok, "Transfer HTTP evidence unavailable");
    return (await response.json()).loads;
  };
  async function move(owner, tab, destination, extra = {}) {
    const before = await read(tab), oldClosed = closedCount(owner);
    const result = await owner.FluxionTabTransfer.move([tab], destination,
      { workspaceId: "build", selectTab: tab, ...extra });
    assert(result.complete && result.tabs.length === 1, `Native move incomplete: ${result.error || "unknown"}`);
    const moved = result.tabs[0]; ownedTabs.push(moved);
    assert(destination.gBrowser.tabs.includes(moved) && !owner.gBrowser.tabs.includes(tab), "Tab was not adopted between windows");
    sameDocument(before, await read(moved));
    assert(destination.FluxionUI.tabWorkspace(moved) === "build", "Destination workspace was not retained");
    assert(closedCount(owner) === oldClosed, "Moving produced a spurious source closed-tab record");
    return moved;
  }
  async function run() {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "") &&
      /\/fluxion-tab-transfer-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Transfer gate requires an isolated loopback profile");
    await waitFor(() => window.FluxionTabTransfer, "Transfer adapter did not load");
    write("stage", "live-document-adoption");
    const destination = await newWindow();
    const source = await page(window, { pinned: true, userContextId: 1 });
    const initialLoads = await loads();
    const moved = await move(window, source.tab, destination);
    assert(moved.pinned && Number(moved.getAttribute("usercontextid")) === 1 &&
      moved.linkedBrowser.contentPrincipal.originAttributes.userContextId === 1,
    "Pinned or container identity was lost");
    moved.linkedBrowser.goBack();
    await waitFor(() => moved.linkedBrowser.currentURI.spec === `${origin}/transfer`, "Adopted back history is broken");
    sameDocument(source.state, await read(moved));
    moved.linkedBrowser.goForward();
    await waitFor(() => moved.linkedBrowser.currentURI.spec === `${origin}/transfer?step=1`, "Adopted forward history is broken");
    sameDocument(source.state, await read(moved));
    assert(await loads() === initialLoads, "Adoption or history traversal reloaded the source URL");
    report.checks.push("live-document-draft-javascript-back-forward-pin-container-workspace-and-no-closed-record");

    write("stage", "group-and-stacked-split");
    const grouped = [await page(window), await page(window)];
    const group = window.gBrowser.addTabGroup(grouped.map(item => item.tab), { label: "Transfer research", color: "blue" });
    window.gBrowser.selectedTab = [...window.gBrowser.tabs].find(tab => !grouped.some(item => item.tab === tab));
    group.collapsed = true;
    const groupClosed = closedCount(window);
    const groupResult = await window.FluxionTabTransfer.move(grouped.map(item => item.tab), destination,
      { workspaceId: "build", selectTab: false });
    assert(groupResult.complete && groupResult.tabs.length === 2, "Native group transfer did not complete");
    ownedTabs.push(...groupResult.tabs);
    const adoptedGroup = groupResult.tabs[0].group;
    assert(adoptedGroup && groupResult.tabs.every(tab => tab.group === adoptedGroup) &&
      adoptedGroup.label === "Transfer research" && adoptedGroup.color === "blue" && adoptedGroup.collapsed,
    "Transferred group metadata or membership was lost");
    for (let index = 0; index < 2; index++) sameDocument(grouped[index].state, await read(groupResult.tabs[index]));
    assert(closedCount(window) === groupClosed, "Group adoption added closed-tab records");
    const splitPages = [await page(window), await page(window)];
    const split = window.FluxionUI.createSplitView(splitPages[0].tab, splitPages[1].tab, { orientation: "stacked" });
    assert(split?.tabs.length === 2, "Source native stacked split was not created");
    const splitResult = await window.FluxionTabTransfer.move([splitPages[0].tab], destination,
      { workspaceId: "build", selectTab: splitPages[0].tab });
    assert(splitResult.complete && splitResult.tabs.length === 2, "Split companion was not transferred with its pane");
    ownedTabs.push(...splitResult.tabs);
    assert(splitResult.tabs[0].splitview && splitResult.tabs.every(tab => tab.splitview === splitResult.tabs[0].splitview) &&
      destination.FluxionUI.splitOrientation(splitResult.tabs[0]) === "stacked", "Native split or stacked orientation was lost");
    for (let index = 0; index < 2; index++) sameDocument(splitPages[index].state, await read(splitResult.tabs[index]));
    report.checks.push("native-group-membership-name-color-collapse-and-stacked-split-retained");

    const peek = await page(window);
    peek.tab.setAttribute("fluxion-peek", "true");
    const peekCount = destination.gBrowser.tabs.length;
    const peekResult = await window.FluxionTabTransfer.move([peek.tab], destination);
    assert(!peekResult.complete && window.gBrowser.tabs.includes(peek.tab) &&
      peek.tab.hasAttribute("fluxion-peek") && destination.gBrowser.tabs.length === peekCount,
    "Temporary Peek transfer was not rejected without mutation");
    peek.tab.removeAttribute("fluxion-peek");
    report.checks.push("temporary-peek-rejected-without-mutation");

    write("stage", "private-boundaries");
    const privateA = await newWindow(true), privateB = await newWindow(true);
    const privateSource = await page(privateA);
    const beforeNormal = destination.gBrowser.tabs.length, beforePrivate = privateA.gBrowser.tabs.length;
    let rejected = false;
    try { rejected = !(await privateA.FluxionTabTransfer.move([privateSource.tab], destination)).complete; }
    catch { rejected = true; }
    assert(rejected && privateA.gBrowser.tabs.includes(privateSource.tab) &&
      destination.gBrowser.tabs.length === beforeNormal && privateA.gBrowser.tabs.length === beforePrivate,
    "Private-to-normal transfer mutated browser state");
    rejected = false;
    try { rejected = !(await destination.FluxionTabTransfer.move([moved], privateA)).complete; }
    catch { rejected = true; }
    assert(rejected && destination.gBrowser.tabs.includes(moved) &&
      destination.gBrowser.tabs.length === beforeNormal && privateA.gBrowser.tabs.length === beforePrivate,
    "Normal-to-private transfer mutated browser state");
    const privateMoved = await move(privateA, privateSource.tab, privateB);
    assert(privateMoved.linkedBrowser.contentPrincipal.originAttributes.privateBrowsingId === 1,
      "Same-private transfer lost private browsing identity");
    report.checks.push("both-private-boundary-directions-rejected-and-same-private-document-adopted");

    write("stage", "detach-new-window");
    const detachable = await page(window);
    const beforeDetach = closedCount(window);
    const detached = await window.FluxionTabTransfer.detach([detachable.tab], { workspaceId: "build", selectTab: detachable.tab });
    assert(detached.window && detached.complete && detached.tabs.length === 1, "New-window detach did not complete");
    ownedWindows.push(detached.window); ownedTabs.push(...detached.tabs);
    assert(detached.window !== window && detached.window.gBrowser.tabs.includes(detached.tabs[0]) &&
      !window.gBrowser.tabs.includes(detachable.tab) && closedCount(window) === beforeDetach,
    "Detach did not retain unique tab ownership without closed history");
    sameDocument(detachable.state, await read(detached.tabs[0]));
    assert(detached.window.FluxionUI.tabWorkspace(detached.tabs[0]) === "build", "Detached workspace was lost");
    report.checks.push("new-window-detach-retains-live-document");

    write("stage", "shipped-flow-menu-command");
    await waitFor(() => window.FluxionWindowTabs?.ready, "Shipped Flow transfer controls did not load");
    window.FluxionUI.switchWorkspace("focus");
    destination.FluxionUI.switchWorkspace("build");
    const menuPage = await page(window);
    const menuWorkspace = destination.FluxionUI.currentWorkspace();
    assert(window.FluxionUI.tabWorkspace(menuPage.tab) !== menuWorkspace,
      "Menu fixture requires distinct source and destination workspaces");
    const sourceClosed = closedCount(window);
    const destinationBefore = new Set(destination.gBrowser.tabs);
    const row = await waitFor(() => [...window.document.querySelectorAll(".fluxion-tab")]
      .find(item => item._fluxionTab === menuPage.tab), "Source Flow row was not rendered");
    const context = window.document.getElementById("fluxion-tab-context");
    const menu = window.document.getElementById("fluxion-move-window-menu");
    const popup = window.document.getElementById("fluxion-move-window-popup");
    assert(context && menu && popup, "Shipped Move to Window menu is missing");
    try {
      // Exercise shipped listeners and menu command routing. These are Gecko DOM
      // events, not proof of physical OS mouse input or native menu focus.
      row.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true,
        screenX: window.screenX + 40, screenY: window.screenY + 120 }));
      context.dispatchEvent(new window.Event("popupshowing", { bubbles: true }));
      assert(window.FluxionUI.contextTabs().includes(menuPage.tab), "Flow context menu did not capture the requested tab");
      const targetIndex = window.FluxionTabTransfer.eligibleWindows([menuPage.tab]).indexOf(destination);
      assert(targetIndex >= 0, "Expected destination was not offered by the shipped menu");
      popup.dispatchEvent(new window.Event("popupshowing", { bubbles: true }));
      const item = popup.querySelector(`[data-fluxion-window-target="${targetIndex}"]`);
      assert(item && !item.disabled, "Move to Window destination command was not populated");
      item.dispatchEvent(new window.Event("command", { bubbles: true }));
      const adopted = await waitFor(() => [...destination.gBrowser.tabs]
        .find(tab => !destinationBefore.has(tab) && !window.gBrowser.tabs.includes(menuPage.tab)),
      "Shipped Flow menu command did not adopt the page");
      ownedTabs.push(adopted);
      sameDocument(menuPage.state, await read(adopted));
      assert(destination.FluxionUI.tabWorkspace(adopted) === menuWorkspace && closedCount(window) === sourceClosed,
        "Menu transfer lost workspace or created a closed record");
      report.checks.push("shipped-flow-context-menu-dom-command-adopts-live-document");
      report.menuInput = "Gecko DOM contextmenu/popupshowing/command; not physical OS input";
    } finally {
      popup.hidePopup();
      context.hidePopup();
    }
  }
  run().then(() => write("health", "native-adoption-live-state-privacy-and-detach-verified"))
    .catch(error => { write("error", `${error?.message || error}\n${error?.stack || ""}`); Cu.reportError(error); })
    .finally(() => {
      write("report", JSON.stringify(report));
      for (const target of ownedWindows.reverse()) { try { if (!target.closed) target.close(); } catch (error) { Cu.reportError(error); } }
      for (const tab of ownedTabs) {
        try { if (window.gBrowser.tabs.includes(tab)) window.gBrowser.removeTab(tab, { animate: false }); } catch (error) { Cu.reportError(error); }
      }
    });
})(window);
