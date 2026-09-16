/* global Services, SessionStore, IOUtils, PathUtils, Cu */
(function verifyTabLinks(window) {
  "use strict";
  if (Services.env.get("FLUXION_TAB_LINKS_TEST") !== "1") return;
  const prefix = "fluxion.tabLinks.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const report = { input: "System Events Shift-F10/Down/Return; initial row focus from chrome", checks: [], menuEvents: [] };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const driver = Services.env.get("FLUXION_TAB_LINKS_DRIVER_DIR");
  const origin = Services.env.get("FLUXION_TAB_LINKS_ORIGIN");
  const token = Services.env.get("FLUXION_TAB_LINKS_TOKEN");
  const wait = async (check, message) => {
    const deadline = Date.now() + 20000;
    do {
      if (await IOUtils.exists(PathUtils.join(driver, "clipboard.error"))) throw new Error("Native clipboard byte verification failed");
      const result = await check(); if (result) return result;
      await new Promise(resolve => window.setTimeout(resolve, 30));
    } while (Date.now() < deadline);
    throw new Error(message);
  };
  const request = async name => {
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native driver did not acknowledge ${name}`);
  };
  let sequence = 0;
  async function key(action) {
    if (action !== "activate") assert(Services.focus.activeWindow === window, "Native menu lost the owned foreground window");
    const name = `${++sequence}-${action}`;
    assert(sequence <= 40 && ["activate", "open", "down", "return", "escape"].includes(action), "Unexpected keyboard request");
    await request(name);
  }
  async function run() {
    assert(driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "driver") &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && /^[A-Za-z0-9.-]+$/.test(token), "Fixture paths are not isolated");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionTabLinks && window.FluxionUI, "Copy links module did not initialize");
    await key("activate");
    await wait(() => document.hasFocus() && Services.focus.activeWindow === window, "Fixture did not gain foreground");
    window.FluxionUI.setSidebarState("expanded");
    const popup = document.getElementById("fluxion-tab-context"), item = document.getElementById("fluxion-copy-tab-links");
    let active = null, commandCount = 0;
    popup.addEventListener("DOMMenuItemActive", event => {
      if (event.isTrusted && event.target.parentNode === popup) {
        active = event.target;
        report.menuEvents.push({ label: active.getAttribute("label"), trusted: true });
      }
    });
    item.addEventListener("command", event => { assert(event.isTrusted, "Copy action was not a native command"); commandCount++; });
    const create = (url, lazy = false) => {
      const tab = gBrowser.addTrustedTab(url, { skipAnimation: true, createLazyBrowser: lazy });
      window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace()); return tab;
    };
    const singleURL = `https://reader:secret@fluxion-link-fixture.invalid/first?token=${token}&raw=%2f+#part%2f`;
    const single = create(singleURL, true);
    const openMenu = async tab => {
      const row = await wait(() => [...document.querySelectorAll(".fluxion-tab")].find(node => node._fluxionTab === tab), "Missing native tab row");
      row.scrollIntoView({ block: "nearest", behavior: "instant" }); row.focus({ preventScroll: true });
      assert(document.activeElement === row, "Context row did not receive focus");
      active = null; await key("open");
      await wait(() => popup.state === "open", "Native tab context menu did not open");
      assert(popup.isNativeMenu, "Copy links gate requires the actual macOS menu");
    };
    const copy = async (tab, label, clipboardCheck) => {
      const selection = gBrowser.selectedTab, before = [...gBrowser.tabs], uris = before.map(t => t.linkedBrowser.currentURI.spec);
      const commandsBefore = commandCount;
      await openMenu(tab);
      assert(item.getAttribute("label") === label && !item.disabled, "Copy command label/state differs from selection");
      assert(popup.children[0].getAttribute("label").startsWith("Duplicate") && popup.children[1] === item,
        "Duplicate must remain first, followed by the Copy native leaf");
      // Cocoa may already highlight the first item when the keyboard opens a
      // menu. Follow trusted native selection instead of assuming its origin.
      if (!active) {
        await key("down");
        await wait(() => active?.parentNode === popup, "Native menu did not highlight a leaf");
      }
      assert(active === popup.children[0] || active === item, "Native menu highlighted an unexpected initial leaf");
      if (active !== item) await key("down");
      await wait(() => active === item, "Copy action did not receive trusted native selection");
      await key("return");
      await wait(() => commandCount === commandsBefore + 1 && popup.state === "closed", "Native Return did not invoke Copy exactly once");
      await request(clipboardCheck);
      assert(gBrowser.selectedTab === selection && before.length === gBrowser.tabs.length && before.every((t, i) =>
        gBrowser.tabs[i] === t && t.linkedBrowser.currentURI.spec === uris[i]), "Copy navigated, selected, reordered or changed tabs");
    };
    await wait(() => single.linkedBrowser.currentURI.spec === singleURL, "Native lazy URI was not retained");
    await request("read-initial");
    await copy(single, "Copy Tab Link", "read-single");
    report.checks.push("native-single-copy-strips-authority-credentials-and-preserves-query-fragment-bytes");
    const oneURL = `${origin}/transfer?token=${token}&tab=one#first`, twoURL = `${origin}/transfer?token=${token}&tab=two#second`;
    const one = create(oneURL), two = create(twoURL);
    await wait(() => [one, two].every((tab, index) => tab.linkedBrowser.currentURI.spec === [oneURL, twoURL][index] && !tab.hasAttribute("busy")),
      "Loopback copy fixtures did not finish loading");
    gBrowser.selectedTab = one;
    gBrowser.addToMultiSelectedTabs(one); gBrowser.addToMultiSelectedTabs(two);
    await copy(two, "Copy 2 Tab Links", "read-multiple");
    report.checks.push("native-multiselection-copies-newline-separated-tab-order-without-browser-mutation");
    gBrowser.clearMultiSelectedTabs();
    const blank = create("about:blank");
    await openMenu(blank);
    assert(item.disabled, "Privileged/non-web tab Copy action must be disabled");
    await key("escape"); await wait(() => popup.state === "closed", "Disabled menu did not dismiss");
    await request("read-disabled");
    report.checks.push("non-http-tab-disabled-and-no-automatic-clipboard-write", "native-pasteboard-exact-bytes-verified");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-tab-link-command-and-clipboard-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack || ""}`); Cu.reportError(error); })
    .finally(() => { Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null); });
})(window);
