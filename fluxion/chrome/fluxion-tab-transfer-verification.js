/* global Services, ChromeUtils, PathUtils, IOUtils, SessionStore, Cu */
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
  let keyboardSequence = 0;
  async function nativeKey(action) {
    const driver = Services.env.get("FLUXION_TAB_TRANSFER_KEYBOARD_DIR");
    assert(driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "keyboard"),
      "Native keyboard driver is not isolated with the fixture profile");
    assert(["activate", "open", "down", "right", "escape"].includes(action) && ++keyboardSequence <= 128,
      "Invalid or excessive native keyboard request");
    if (action !== "activate") assert(Services.focus.activeWindow === window,
      "Native keyboard fixture lost its exact source window");
    write("keyboardRequest", `${keyboardSequence}:${action}`);
    await waitFor(() => IOUtils.exists(PathUtils.join(driver, `${keyboardSequence}.sent`)),
      `Owned-process native keyboard driver did not complete ${action}`);
  }
  async function keyboardMenu(anchor, contextId, moveMenuId, submenuId, kind) {
    const context = window.document.getElementById(contextId);
    const menu = window.document.getElementById(moveMenuId);
    const submenu = window.document.getElementById(submenuId);
    assert(anchor?.isConnected && context && menu && submenu, `${kind} keyboard menu fixture is missing`);
    const evidence = { kind, transport: "System Events native key codes; initial anchor focus set by chrome", highlighted: [] };
    (report.nativeKeyboard ||= []).push(evidence);
    let selectedItem = null;
    const observe = event => {
      if (!event.isTrusted || ![context, submenu].includes(event.target.parentNode)) return;
      selectedItem = event.target;
      evidence.highlighted.push({ parent: event.target.parentNode.id, label: event.target.getAttribute("label") });
    };
    context.addEventListener("DOMMenuItemActive", observe);
    try {
      window.focus();
      await nativeKey("activate");
      await waitFor(() => Services.focus.activeWindow === window && window.document.hasFocus(), "Owned source window did not become foreground");
      anchor.scrollIntoView({ block: "nearest", behavior: "instant" });
      anchor.focus({ preventScroll: true });
      assert(window.document.activeElement === anchor, `${kind} anchor could not receive keyboard focus`);
      await nativeKey("open");
      await waitFor(() => context.state === "open", `Native Shift+F10 did not open the ${kind} menu`);
      evidence.nativeMenu = context.isNativeMenu;
      assert(context.isNativeMenu, `${kind} context menu is not an OS-native menu`);
      await nativeKey("down");
      await waitFor(() => selectedItem?.parentNode === context, "Native menu did not expose its highlighted first entry");
      // Cocoa reports active leaf items, not highlighted submenu headers. Count
      // remaining enabled siblings from an observed native selection; never set
      // activeChild or pretend an attribute changed in response to the keyboard.
      const items = [...context.children].filter(item => ["menu", "menuitem"].includes(item.localName) &&
        !item.hidden && !item.disabled && window.getComputedStyle(item).display !== "none" &&
        window.getComputedStyle(item).visibility !== "collapse");
      const from = items.indexOf(selectedItem), target = items.indexOf(menu);
      assert(from >= 0 && target >= from && target - from <= 40, "Move to Window navigation sequence is not bounded");
      for (let index = from; index < target; index++) await nativeKey("down");
      await nativeKey("right");
      await waitFor(() => submenu.state === "open", "Native ArrowRight did not open Move to Window");
      selectedItem = null;
      await nativeKey("down");
      await waitFor(() => selectedItem?.parentNode === submenu && !selectedItem.disabled,
        "Native submenu ArrowDown did not highlight an enabled command");
      evidence.submenuLabel = selectedItem.getAttribute("label");
      await nativeKey("escape");
      await waitFor(() => submenu.state === "closed", "Native Escape did not close Move to Window");
      if (context.state !== "closed") await nativeKey("escape");
      await waitFor(() => context.state === "closed" && window.document.activeElement === anchor &&
        Services.focus.activeWindow === window, `Native Escape did not restore ${kind} anchor focus`);
      evidence.restoredAnchorFocus = true;
    } finally {
      context.removeEventListener("DOMMenuItemActive", observe);
      write("report", JSON.stringify(report));
      if (context.state !== "closed") context.hidePopup();
    }
  }
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
    report.navigation = {
      mode: "programmatic unactivated pushState entries; native goBack(false)/goForward(false)",
      before: {
        parentURI: moved.linkedBrowser.currentURI.spec,
        actorURI: (await read(moved)).url,
        canGoBack: moved.linkedBrowser.canGoBack,
        canGoBackIgnoringUserInteraction: moved.linkedBrowser.canGoBackIgnoringUserInteraction,
      },
    };
    write("report", JSON.stringify(report));
    // Seed's programmatic pushState is not a user gesture. Gecko 155's default
    // toolbar navigation intentionally skips unactivated entries; explicitly
    // traverse this fixture's entries without changing production preferences.
    moved.linkedBrowser.goBack(false);
    await waitFor(() => moved.linkedBrowser.currentURI.spec === `${origin}/transfer`, "Adopted back history is broken");
    sameDocument(source.state, await read(moved));
    moved.linkedBrowser.goForward(false);
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
    report.detach = [...detached.window.gBrowser.tabs].map(tab => ({
      adopted: detached.tabs.includes(tab), uri: tab.linkedBrowser.currentURI.spec,
      historyCount: tab.linkedBrowser.browsingContext?.sessionHistory?.count,
      busy: tab.hasAttribute("busy"), pinned: tab.pinned,
      grouped: Boolean(tab.group), split: Boolean(tab.splitview),
      documentURI: tab.linkedBrowser.browsingContext?.currentWindowGlobal?.documentURI?.spec,
      workspace: detached.window.FluxionUI.tabWorkspace(tab),
    }));
    write("report", JSON.stringify(report));
    assert(detached.window.gBrowser.tabs.length === 1,
      "Successful detach retained the untouched default new-tab placeholder");
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
      report.menuSource = {
        documentGlobalMatches: menuPage.tab.documentGlobal === window,
        legacyOwnerGlobalMatches: menuPage.tab.ownerGlobal === window,
        systemPrincipal: menuPage.tab.nodePrincipal.isSystemPrincipal,
        labels: [...popup.children].map(child => child.getAttribute("label")),
      };
      write("report", JSON.stringify(report));
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

    write("stage", "native-datatransfer-dom-routing");
    const dragPage = await page(window);
    const dropPage = await page(destination);
    window.gBrowser.clearMultiSelectedTabs();
    window.FluxionUI.selectTab(dragPage.tab);
    destination.FluxionUI.selectTab(dropPage.tab);
    const sourceRow = await waitFor(() => [...window.document.querySelectorAll(".fluxion-tab")]
      .find(item => item._fluxionTab === dragPage.tab), "Drag source Flow row was not rendered");
    const targetRow = await waitFor(() => [...destination.document.querySelectorAll(".fluxion-tab")]
      .find(item => item._fluxionTab === dropPage.tab), "Drop destination Flow row was not rendered");
    targetRow.scrollIntoView({ block: "nearest", behavior: "instant" });
    const rect = targetRow.getBoundingClientRect();
    assert(rect.width > 0 && rect.height > 0, "Drop target must have real rendered geometry");
    const payload = new window.DataTransfer();
    sourceRow.dispatchEvent(new window.DragEvent("dragstart", {
      bubbles: true, cancelable: true, dataTransfer: payload,
    }));
    assert(payload.mozItemCount === 1 && payload.mozGetDataAt("application/x-fluxion-tab", 0) === dragPage.tab,
      "Shipped dragstart did not encode the actual native tab in Gecko DataTransfer");
    const eventOptions = { bubbles: true, cancelable: true, dataTransfer: payload,
      clientX: rect.left + rect.width / 2, clientY: rect.top + 1 };
    const over = new destination.DragEvent("dragover", eventOptions);
    targetRow.dispatchEvent(over);
    assert(over.defaultPrevented && payload.dropEffect === "move", "Foreign native drag was not accepted as a move");
    const beforeDrop = new Set(destination.gBrowser.tabs), beforeDropClosed = closedCount(window);
    targetRow.dispatchEvent(new destination.DragEvent("drop", eventOptions));
    const dropped = await waitFor(() => [...destination.gBrowser.tabs]
      .find(tab => !beforeDrop.has(tab) && !window.gBrowser.tabs.includes(dragPage.tab)),
    "Native DataTransfer DOM drop did not adopt the source page");
    ownedTabs.push(dropped);
    sameDocument(dragPage.state, await read(dropped));
    assert(payload.dropEffect === "move" && destination.FluxionUI.tabWorkspace(dropped) ===
      destination.FluxionUI.tabWorkspace(dropPage.tab) && closedCount(window) === beforeDropClosed,
    "Native drop lost move/workspace/closed-history semantics");
    report.dragInput = "Native Gecko DataTransfer and DOM DragEvents; not physical OS drag or trusted dragend";
    report.checks.push("native-gecko-datatransfer-shipped-flow-dom-drop-retains-live-document");

    write("stage", "native-flow-keyboard-menus");
    const keyboardPage = await page(window);
    const keyboardRow = await waitFor(() => [...window.document.querySelectorAll(".fluxion-tab")]
      .find(item => item._fluxionTab === keyboardPage.tab), "Keyboard tab row did not render");
    await keyboardMenu(keyboardRow, "fluxion-tab-context", "fluxion-move-window-menu", "fluxion-move-window-popup", "tab");
    const groupPage = await page(window);
    const keyboardGroup = window.gBrowser.addTabGroup([keyboardPage.tab, groupPage.tab], { label: "Keyboard transfer fixture" });
    const heading = await waitFor(() => [...window.document.querySelectorAll(".fluxion-group-heading")]
      .find(item => item._fluxionGroup === keyboardGroup), "Keyboard group heading did not render");
    await keyboardMenu(heading, "fluxion-group-context", "fluxion-move-group-window-menu", "fluxion-move-group-window-popup", "group");
    report.checks.push("native-os-keyboard-tab-and-group-menu-open-navigation-and-escape-focus");

    write("stage", "last-visible-tab-with-hidden-workspace");
    const workspaceSource = await newWindow();
    workspaceSource.FluxionUI.switchWorkspace("focus");
    const retained = await page(workspaceSource);
    workspaceSource.FluxionUI.switchWorkspace("build");
    const lastVisible = await page(workspaceSource);
    workspaceSource.FluxionUI.setTabWorkspace(lastVisible.tab, "build");
    workspaceSource.FluxionUI.selectTab(lastVisible.tab);
    for (const tab of [...workspaceSource.gBrowser.tabs]) {
      if (tab !== retained.tab && tab !== lastVisible.tab) {
        workspaceSource.gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
      }
    }
    assert(retained.tab.hidden && !lastVisible.tab.hidden,
      "Last-visible fixture requires an actual hidden retained workspace page");
    const retainedClosed = closedCount(workspaceSource);
    const lastResult = await workspaceSource.FluxionTabTransfer.move([lastVisible.tab], destination,
      { workspaceId: "build" });
    ownedTabs.push(...lastResult.tabs);
    assert(lastResult.complete && lastResult.tabs.length === 1 && !workspaceSource.closed &&
      workspaceSource.gBrowser.tabs.includes(retained.tab) && closedCount(workspaceSource) === retainedClosed,
    "Moving the last visible tab closed the source window or lost a hidden workspace page");
    sameDocument(lastVisible.state, await read(lastResult.tabs[0]));
    workspaceSource.FluxionUI.selectTab(retained.tab);
    sameDocument(retained.state, await read(retained.tab));
    report.checks.push("last-visible-transfer-preserves-hidden-workspace-live-document-and-source-window");
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
