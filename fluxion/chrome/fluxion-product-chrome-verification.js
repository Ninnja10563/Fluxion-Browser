/* global Services, SessionStore, PathUtils, IOUtils, Cc, Ci, Cu, ChromeUtils */
(function verifyFluxionProductChrome(window) {
  "use strict";
  if (Services.env.get("FLUXION_PRODUCT_CHROME_TEST") !== "1") return;
  const prefix = "fluxion.productChrome.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const driver = Services.env.get("FLUXION_PRODUCT_CHROME_DRIVER_DIR");
  const { document, gBrowser, gURLBar } = window;
  const report = { checks: [], captures: [], geometry: [], input: "Native macOS System Events Cmd-L and typed bookmark restriction; actual Gecko Places results and layout; no OS trackpad input claimed" };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const rect = node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  const painted = node => {
    if (!node) return false;
    const box = rect(node), style = window.getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
  };
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.75 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.75;
  const contains = (outer, inner, tolerance = 1) => inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  async function capture(name) {
    // Refocusing while a native popup is open can change Cocoa window ordering.
    // Capture the existing state; the driver only activates normal captures.
    await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    report.captureStates ||= [];
    report.captureStates.push({ name, documentVisibility: document.visibilityState,
      windowState: window.windowState, activeWindow: Services.focus.activeWindow === window,
      urlbarOpen: gURLBar.view.isOpen });
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Product chrome capture was not acknowledged: ${name}`, 20000);
    report.captures.push(name);
  }
  async function nativeQuery(width) {
    const name = `query-product-suggestions-${width}`;
    const keys = [], inputs = [];
    const onKey = event => {
      if (event.metaKey && event.key.toLowerCase() === "l") keys.push({ key: event.key,
        trusted: event.isTrusted, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey, control: event.ctrlKey });
    };
    const onInput = event => inputs.push({ trusted: event.isTrusted, value: gURLBar.inputField.value });
    window.addEventListener("keydown", onKey, true);
    gURLBar.inputField.addEventListener("input", onInput);
    try {
      await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
      await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)),
        `Native URL-bar input driver did not acknowledge ${name}`, 20000);
      report.nativeQueries ||= [];
      report.nativeQueries.push({ width, keys, inputs });
      await wait(() => keys.length >= 1 && inputs.some(event => event.trusted &&
        event.value.endsWith("Fluxion navigation geometry fixture")),
      "Native key delivery did not complete the URL-bar query");
      assert(keys.length === 1 && keys[0].trusted && keys[0].meta && !keys[0].shift && !keys[0].alt && !keys[0].control,
        "URL-bar query did not receive exactly one native Cmd-L");
      assert(inputs.some(event => event.trusted && event.value.endsWith("Fluxion navigation geometry fixture")),
        "Complete URL-bar fixture text did not arrive through native trusted input");
    } finally {
      window.removeEventListener("keydown", onKey, true);
      gURLBar.inputField.removeEventListener("input", onInput);
    }
  }
  const routePointer = (x, y, type = "mousemove", buttons = 0) => {
    assert(typeof window.synthesizeMouseEvent === "function", "Gecko native widget input router is unavailable");
    window.synthesizeMouseEvent(type, x, y, {
      identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons,
      clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
    }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
  };
  function workspaceMenuEvidence(menu, workspaces, current) {
    assert(menu.state === "open", "Workspace menu did not open as a native popup");
    const items = [...menu.children].filter(node => ["menu", "menuitem"].includes(node.localName));
    const evidence = items.map(node => ({ label: node.getAttribute("label"), kind: node.localName,
      disabled: node.getAttribute("disabled") === "true", type: node.getAttribute("type"),
      name: node.getAttribute("name"), checked: node.getAttribute("checked") === "true" }));
    for (const label of ["Rename Workspace…", "Change Icon", "Change Accent", "Edit Workspace Theme…", "Move Workspace Earlier",
      "Move Workspace Later", "New Workspace…", "Delete Workspace…"]) {
      const node = items.find(item => item.getAttribute("label") === label);
      assert(node && !node.hidden && node.getAttribute("hidden") !== "true", `Workspace menu action is missing: ${label}`);
      if (label === "Change Icon" || label === "Change Accent") {
        assert(node.localName === "menu" && node.querySelector("menupopup")?.children.length > 1,
          `Workspace appearance command has no native choices: ${label}`);
      }
    }
    const radio = evidence.filter(item => item.name === "fluxion-workspace-switch");
    assert(radio.length === workspaces.length && radio.every((item, index) =>
      item.label === workspaces[index].name && item.type === "radio" &&
      item.checked === (workspaces[index].id === current)), "Workspace radio entries do not match live workspace order and selection");
    const index = workspaces.findIndex(workspace => workspace.id === current);
    assert(index >= 0, "Current workspace is absent from the native menu fixture");
    const disabled = label => evidence.find(item => item.label === label).disabled;
    assert(disabled("Delete Workspace…") === (workspaces.length === 1), "Last-workspace deletion safety is incorrect");
    assert(disabled("Move Workspace Earlier") === (index === 0) &&
      disabled("Move Workspace Later") === (index === workspaces.length - 1), "Workspace reorder bounds are incorrect");
    assert(!disabled("Rename Workspace…") && !disabled("New Workspace…"), "Workspace rename/create command is unexpectedly disabled");
    return { state: menu.state, isNativeMenu: menu.isNativeMenu, items: evidence };
  }
  async function nativeWorkspaceKey(action) {
    const name = `key-product-workspace-${action}`;
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)),
      `Native workspace key driver did not acknowledge ${name}`, 20000);
  }
  function workspaceDock(count) {
    const flow = document.getElementById("fluxion-flow"), outer = rect(flow);
    const buttons = [...flow.querySelectorAll(".fluxion-workspace-list > .fluxion-workspace")].filter(painted);
    assert(buttons.length === count, "Bottom workspace dock has stale or hidden workspace symbols");
    const boxes = buttons.map(rect), symbols = buttons.map(button => {
      const symbol = button.querySelector(".fluxion-workspace-symbol");
      assert(painted(symbol), "Centered workspace dock is missing a visible symbol");
      return rect(symbol);
    });
    const left = Math.min(...symbols.map(box => box.left)), right = Math.max(...symbols.map(box => box.right));
    const center = (left + right) / 2, sidebarCenter = (outer.left + outer.right) / 2;
    const evidence = { count, center, sidebarCenter, offset: center - sidebarCenter, buttons: boxes, symbols };
    report.workspaceDock ||= [];
    report.workspaceDock.push(evidence);
    assert(Math.abs(evidence.offset) <= 1, `Workspace symbols are not centered in the sidebar: ${JSON.stringify(evidence)}`);
    for (const box of boxes) assert(contains(outer, box), "Centered workspace dock clips a symbol outside the sidebar");
    for (let index = 1; index < boxes.length; index++) assert(!overlaps(boxes[index - 1], boxes[index]), "Centered workspace symbols overlap");
  }
  async function workspaceHeading() {
    stage("native-workspace-heading-menu");
    const ui = window.FluxionUI;
    const heading = document.querySelector(".fluxion-workspace-heading");
    const label = heading?.querySelector(":scope > span");
    const button = heading?.querySelector(".fluxion-workspace-more");
    const menu = document.getElementById("fluxion-workspace-context");
    assert(painted(heading) && painted(label) && button && menu, "Workspace heading controls are missing");
    assert(button.getAttribute("aria-haspopup") === "menu" && button.getAttribute("aria-controls") === menu.id &&
      button.getAttribute("aria-expanded") === "false", "Workspace heading menu accessibility contract is missing");
    const evidence = report.workspaceHeading = { pointer: "Gecko Window.synthesizeMouseEvent routing; no OS pointer movement claimed",
      keyboard: "macOS System Events Escape and ArrowDown", states: [], menus: [] };
    const baseline = rect(label);
    const state = name => {
      const labelBox = rect(label), buttonStyle = window.getComputedStyle(button), headingStyle = window.getComputedStyle(heading);
      const entry = { name, label: labelBox, button: rect(button), opacity: buttonStyle.opacity,
        pointerEvents: buttonStyle.pointerEvents, background: headingStyle.backgroundColor,
        hover: heading.matches(":hover"), focusWithin: heading.matches(":focus-within"),
        expanded: button.getAttribute("aria-expanded"), menuOpen: heading.dataset.menuOpen || null };
      evidence.states.push(entry);
      assert(["left", "right", "top", "bottom"].every(edge => Math.abs(labelBox[edge] - baseline[edge]) <= 1),
        `Workspace label shifts when heading controls change: ${JSON.stringify(entry)}`);
      return entry;
    };
    const outside = rect(gBrowser.selectedBrowser);
    const moveAway = () => routePointer(outside.left + outside.width / 2, outside.top + Math.min(140, outside.height / 2));
    gBrowser.selectedBrowser.focus(); moveAway();
    await wait(() => !heading.matches(":hover") && !heading.matches(":focus-within") &&
      Number(window.getComputedStyle(button).opacity) === 0, "Workspace ellipsis remains visible outside hover or focus");
    const idle = state("idle");
    workspaceDock(1);
    assert(idle.pointerEvents === "none" && idle.button.width >= 24 && idle.button.height >= 24,
      "Hidden workspace ellipsis must reserve its hit-target geometry without intercepting clicks");
    await capture("capture-product-workspace-idle");
    const headingBox = rect(heading);
    routePointer(headingBox.left + 12, headingBox.top + headingBox.height / 2);
    await wait(() => heading.matches(":hover") && Number(window.getComputedStyle(button).opacity) === 1,
      "Gecko-routed heading hover did not reveal the ellipsis");
    const hover = state("hover");
    assert(hover.background !== idle.background && hover.pointerEvents === "auto", "Workspace hover lacks meaningful highlight or usable control");
    await capture("capture-product-workspace-hover");
    const buttonBox = rect(button), x = buttonBox.left + buttonBox.width / 2, y = buttonBox.top + buttonBox.height / 2;
    assert(button.contains(document.elementFromPoint(x, y)), "Workspace ellipsis is clipped or obscured");
    routePointer(x, y); routePointer(x, y, "mousedown", 1); routePointer(x, y, "mouseup", 0);
    await wait(() => menu.state === "open", "Routed ellipsis click did not open the native workspace menu");
    assert(button.getAttribute("aria-expanded") === "true" && heading.dataset.menuOpen === "true",
      "Open native workspace menu is not reflected in the heading state");
    state("pointer-menu-open");
    evidence.menus.push(workspaceMenuEvidence(menu, ui.workspaces(), ui.currentWorkspace()));
    await capture("capture-product-workspace-menu");
    await nativeWorkspaceKey("escape-pointer");
    await wait(() => menu.state === "closed" && document.activeElement === button &&
      button.getAttribute("aria-expanded") === "false" && !heading.hasAttribute("data-menu-open"),
    "Native Escape did not dismiss the workspace popup and restore ellipsis focus");
    moveAway();
    await wait(() => !heading.matches(":hover") && Number(window.getComputedStyle(button).opacity) === 1,
      "Focused workspace ellipsis disappeared when the pointer left");
    const focused = state("focus-without-hover");
    assert(focused.focusWithin && focused.background !== idle.background, "Keyboard focus lacks the workspace heading highlight");
    // Seed only through the product's workspace manager, then require the next
    // native popup to rebuild its radio choices from the actual updated state.
    assert(ui.workspaces().length === 1, "Fresh product fixture must begin with one workspace");
    ui.createWorkspace("Workspace menu fixture", { activate: false });
    await wait(() => ui.workspaces().length === 2, "Workspace manager did not create the menu fixture");
    await wait(() => document.querySelectorAll(".fluxion-workspace-list > .fluxion-workspace").length === 2,
      "Bottom workspace dock did not render the second workspace");
    workspaceDock(2);
    button.focus({ preventScroll: true });
    await nativeWorkspaceKey("down");
    await wait(() => menu.state === "open", "Native ArrowDown did not open the focused workspace menu");
    state("keyboard-menu-open");
    evidence.menus.push(workspaceMenuEvidence(menu, ui.workspaces(), ui.currentWorkspace()));
    await capture("capture-product-workspace-menu-updated");
    await nativeWorkspaceKey("escape-keyboard");
    await wait(() => menu.state === "closed" && document.activeElement === button &&
      button.getAttribute("aria-expanded") === "false" && !heading.hasAttribute("data-menu-open"),
    "Native keyboard popup dismissal did not restore its heading anchor");
    state("keyboard-escape-restored");
    report.checks.push("workspace-heading-hover-and-focus-reveal-without-label-shift",
      "native-workspace-menu-actions-dynamic-radio-order-and-last-workspace-safety",
      "native-workspace-arrowdown-open-and-escape-anchor-focus-restoration");
  }
  async function workspaceTheme() {
    stage("native-workspace-theme-editor");
    await wait(() => window.FluxionWorkspaceTheme && window.FluxionColors, "Workspace theme editor did not initialize");
    const ui = window.FluxionUI, id = ui.currentWorkspace(), other = ui.workspaces().find(workspace => workspace.id !== id).id;
    const anchor = document.querySelector(".fluxion-workspace-more"), root = document.documentElement;
    const panel = document.getElementById("fluxion-workspace-theme");
    const field = name => document.getElementById(`fluxion-workspace-theme-${name}`);
    const workspace = () => ui.workspaces().find(item => item.id === id);
    const persisted = () => JSON.parse(Services.prefs.getStringPref("fluxion.workspaces")).find(item => item.id === id);
    const projection = () => root.style.getPropertyValue("--fluxion-bg").trim();
    const baseline = projection(), globalBefore = JSON.stringify(window.FluxionColors.current());
    const evidence = report.workspaceTheme = { input: "Supported privileged editor API, real HTML form clicks, native macOS typed hex input; OS color-picker dialog not tested",
      baseline, geometry: [], inputEvents: [] };
    async function open() {
      window.FluxionWorkspaceTheme.open(id, anchor);
      await wait(() => panel.state === "open" && painted(field("hex")), "Native workspace theme panel did not open");
      const panelBox = rect(panel);
      const controls = ["mode", "color", "hex", "save", "cancel", "reset"].map(name => {
        const node = field(name); assert(painted(node), `Workspace theme control is not painted: ${name}`);
        return { name, ...rect(node) };
      });
      evidence.geometry.push({ panel: panelBox, controls });
      for (const box of controls) assert(contains(panelBox, box), `Workspace theme control is clipped: ${box.name}`);
      for (let first = 0; first < controls.length; first++) for (let second = first + 1; second < controls.length; second++) {
        assert(!overlaps(controls[first], controls[second]), `Workspace theme controls overlap: ${controls[first].name}/${controls[second].name}`);
      }
      assert(field("color").type === "color", "Workspace theme swatch does not expose the native color input");
    }
    async function type(mode, value, action) {
      field("mode").value = mode;
      field("mode").dispatchEvent(new window.Event("change", { bubbles: true }));
      field("hex").focus();
      await wait(() => document.activeElement === field("hex"), "Workspace hex field did not receive focus");
      const events = [], onInput = event => events.push({ trusted: event.isTrusted, value: field("hex").value });
      field("hex").addEventListener("input", onInput);
      try {
        const name = `type-product-workspace-${action}`;
        await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
        await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native theme input was not acknowledged: ${action}`, 20000);
        await wait(() => events.some(event => event.trusted && event.value === value), "Native theme hex input did not arrive through trusted events");
        assert(field("color").value === value, "Native color control did not synchronize with the hex input");
        evidence.inputEvents.push({ mode, value, events });
      } finally { field("hex").removeEventListener("input", onInput); }
    }
    await open();
    await type("dark", "#304050", "dark");
    await type("light", "#dde6dc", "light");
    assert(!workspace().theme && projection() === baseline, "Unsaved workspace color draft leaked into persistence or browser chrome");
    await capture("capture-product-workspace-theme");
    field("save").click();
    await wait(() => panel.state === "closed" && workspace().theme?.dark === "#304050" && workspace().theme?.light === "#dde6dc",
      "Workspace theme Save did not commit both appearance modes");
    await wait(() => projection().includes("#304050") && projection().includes("#dde6dc"), "Saved workspace bases did not project into browser chrome");
    assert(persisted().theme?.dark === "#304050" && persisted().theme?.light === "#dde6dc", "Workspace theme was not persisted with workspace state");
    const saved = projection(); evidence.savedProjection = saved; evidence.persistedTheme = persisted().theme;
    ui.switchWorkspace(other);
    await wait(() => ui.currentWorkspace() === other && projection() === baseline, "Unthemed workspace inherited another workspace's colors");
    ui.switchWorkspace(id);
    await wait(() => ui.currentWorkspace() === id && projection() === saved, "Returning to workspace did not restore its saved color projection");
    await open();
    await type("dark", "#405060", "cancel");
    field("cancel").click();
    await wait(() => panel.state === "closed", "Workspace theme Cancel did not dismiss the editor");
    assert(workspace().theme?.dark === "#304050" && persisted().theme?.dark === "#304050" && projection() === saved,
      "Canceled workspace theme draft changed persistence or active colors");
    await open();
    field("reset").click();
    await wait(() => panel.state === "closed" && !workspace().theme && projection() === baseline, "Workspace theme Reset did not restore inherited appearance");
    assert(!persisted().theme && JSON.stringify(window.FluxionColors.current()) === globalBefore,
      "Workspace theme controls changed global colors or left reset data behind");
    evidence.resetProjection = projection();
    report.checks.push("workspace-dock-symbol-group-centered-with-one-and-two-workspaces",
      "native-workspace-theme-controls-visible-contained-and-nonoverlapping",
      "workspace-theme-native-hex-save-persistence-switch-restoration-cancel-and-reset");
  }
  function sidebarColumns(label) {
    const flow = document.getElementById("fluxion-flow");
    assert(flow?.dataset.state === "expanded", "Sidebar column check requires expanded Flow");
    const targets = [
      ["workspace-heading", flow.querySelector(".fluxion-workspace-heading > span")],
      ["ungrouped-tab-title", flow.querySelector('.fluxion-tabs[role="tree"] > .fluxion-tab[aria-level="1"] .fluxion-title')],
      ["new-tab-label", flow.querySelector(".fluxion-new-tab > span:not([aria-hidden])")],
    ];
    const origin = rect(flow).left;
    const columns = targets.map(([id, node]) => {
      assert(painted(node), `Sidebar column target is missing or hidden: ${id}`);
      return { id, left: rect(node).left - origin };
    });
    report.geometry.push({ label: `${label}-sidebar-columns`, columns });
    const positions = columns.map(column => column.left);
    assert(Math.max(...positions) - Math.min(...positions) <= 1,
      `Workspace, ungrouped tab and New tab labels do not share a common column: ${JSON.stringify(columns)}`);
  }
  function geometry(label) {
    sidebarColumns(label);
    const nav = document.getElementById("nav-bar");
    const input = document.querySelector("#urlbar > .urlbar-input-container");
    assert(painted(nav) && painted(input), "Native navigation bar or actual Gecko address input is not painted");
    const navBox = rect(nav), inputBox = rect(input);
    const topPadding = inputBox.top - navBox.top, bottomPadding = navBox.bottom - inputBox.bottom;
    const controls = [...nav.querySelectorAll("toolbarbutton, button")].filter(node => {
      if (!painted(node) || input.contains(node)) return false;
      if (node.closest("panel, panelview, menupopup, .urlbarView")) return false;
      return !node.parentElement?.closest("toolbarbutton, button");
    });
    const boxes = [{ id: "native-address-input", ...inputBox }, ...controls.map(node => ({
      id: node.id || node.getAttribute("aria-label") || node.localName, ...rect(node),
    }))];
    const evidence = { label, outerWidth: window.outerWidth, innerWidth: window.innerWidth, nav: navBox,
      input: inputBox, topPadding, bottomPadding, controls: boxes };
    report.geometry.push(evidence);
    assert(topPadding >= 2 && bottomPadding >= 2 && Math.abs(topPadding - bottomPadding) <= 1.5,
      `Address bar has unbalanced vertical spacing: ${JSON.stringify(evidence)}`);
    assert(inputBox.height >= 28 && inputBox.width >= 120, `Address field is compressed: ${JSON.stringify(inputBox)}`);
    for (const box of boxes) assert(contains(navBox, box), `Toolbar control is clipped outside the nav bar: ${JSON.stringify(box)}`);
    for (let first = 0; first < boxes.length; first++) for (let second = first + 1; second < boxes.length; second++) {
      assert(!overlaps(boxes[first], boxes[second]), `Toolbar controls overlap: ${JSON.stringify([boxes[first], boxes[second]])}`);
    }
    for (const id of ["back-button", "forward-button", "unified-extensions-button", "fluxion-toolbar-menu"]) {
      assert(controls.some(node => node.id === id), `Expected native/product toolbar control is missing: ${id}`);
    }
    assert(controls.some(node => ["reload-button", "stop-button"].includes(node.id)), "Native reload/stop control is missing");
    return inputBox;
  }
  async function run() {
    assert(/\/fluxion-product-chrome-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Product chrome gate requires its isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Product chrome driver must own the isolated profile");
    assert(Services.prefs.getStringPref("fluxion.productChrome.fixture.seeded", "") === "inherited-vpn-enabled",
      "Existing-profile VPN preference was not seeded before application launch");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionUI && window.FluxionChromeLayout && window.FluxionTheme,
      "Product chrome layout modules did not initialize");
    stage("existing-profile-product-gate");
    const feature = "browser.ipProtection.enabled";
    assert(Services.prefs.getBoolPref(feature, true) === false &&
      Services.prefs.getDefaultBranch("").getBoolPref(feature, true) === false && Services.prefs.prefIsLocked(feature),
    "Existing enabled VPN profile escaped the effective locked product gate");
    const { IPProtectionService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs");
    assert(IPProtectionService.featureEnabled === false && IPProtectionService.state === "uninitialized",
      "Firefox VPN service initialized despite the product gate");
    assert(!painted(document.getElementById("ipprotection-button")), "Firefox VPN promotion still occupies toolbar space");
    const panel = document.getElementById("PanelUI-ipprotection");
    assert(!painted(panel), "Firefox VPN enrollment panel is visible");
    assert(document.getElementById("aboutName")?.getAttribute("label") === "About Fluxion", "Native About command is not Fluxion branded");
    assert(Services.prefs.getBoolPref("browser.urlbar.groupLabels.enabled", true) === false,
      "Native Firefox Suggest group labels are not disabled by product configuration");
    report.checks.push("inherited-vpn-enabled-pref-overridden-on-both-branches-and-locked", "native-vpn-service-uninitialized-widget-unpainted-and-panel-closed", "native-about-command-is-fluxion");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    // Keep this layout fixture entirely local; suggestions come from the native
    // Places bookmark provider, not an external search or AI service.
    Services.prefs.setBoolPref("browser.search.suggest.enabled", false);
    Services.prefs.setBoolPref("browser.urlbar.suggest.searches", false);
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    // Session restoration does not await the fresh-profile bookmark import.
    // As in our native defaults/Library gates, seed only after that import has
    // finished so it cannot replace the fixture's newly inserted bookmark.
    const { PlacesBrowserStartup } = ChromeUtils.importESModule(
      "moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs");
    await wait(() => PlacesBrowserStartup._placesBrowserInitComplete,
      "Native Places startup and default bookmark import did not complete", 20000);
    const fixtureURL = "https://example.org/fluxion-product-chrome";
    const fixtureTitle = "Fluxion navigation geometry fixture";
    const bookmark = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.menuGuid,
      url: fixtureURL, title: fixtureTitle });
    // Model a visited bookmark, using the native history API rather than
    // inserting a result into the URL-bar provider or editing ranking scores.
    const transition = PlacesUtils.history.TRANSITIONS.TYPED;
    const inserted = await PlacesUtils.history.insert({ url: fixtureURL, title: fixtureTitle,
      visits: [{ date: new Date(), transition }] });
    report.historyInsert = { guid: inserted.guid, visits: inserted.visits,
      historyEnabled: Services.prefs.getBoolPref("places.history.enabled", true) };
    // Native history completion does not guarantee read-only connections have
    // caught up. PlacesTestUtils also waits for history.fetch after insertion.
    await wait(async () => {
      const observed = await PlacesUtils.history.fetch(fixtureURL, { includeVisits: true });
      report.historyRead = observed ? { guid: observed.guid, visits: observed.visits } : null;
      return observed?.visits?.length === 1 && observed.visits[0].transition === transition;
    }, "Native read-only history did not observe the fixture's exact typed visit");
    // Places defers bookmark frecency updates; the real address-bar provider
    // excludes zero-frecency pages. Await Gecko's native fixture-readiness API
    // instead of depending on an idle task firing during this short check.
    // The exported symbol is the component class, not its running singleton.
    // Use the same existing-service access as Gecko's PlacesTestUtils.
    const frecency = Cc["@mozilla.org/places/frecency-recalculator;1"]
      .getService(Ci.nsIObserver).wrappedJSObject;
    await frecency.recalculateAnyOutdatedFrecencies();
    const db = await PlacesUtils.promiseDBConnection();
    await wait(async () => {
      const stored = await db.executeCached(`SELECT h.url, h.frecency, h.alt_frecency,
        h.visit_count, b.title AS bookmark_title,
        (SELECT count(*) FROM moz_historyvisits WHERE place_id = h.id) AS stored_visits,
        (SELECT visit_type FROM moz_historyvisits WHERE place_id = h.id ORDER BY id DESC LIMIT 1) AS visit_type
        FROM moz_places h JOIN moz_bookmarks b ON b.fk = h.id WHERE h.url = :url AND b.guid = :guid`,
      { url: fixtureURL, guid: bookmark.guid });
      if (stored.length !== 1) { report.placesFixture = { matchingRows: stored.length }; return false; }
      report.placesFixture = Object.fromEntries(["url", "frecency", "alt_frecency", "visit_count", "bookmark_title", "stored_visits", "visit_type"]
        .map(name => [name, stored[0].getResultByName(name)]));
      report.placesFixture.alternativeEnabled = PlacesUtils.history.isAlternativeFrecencyEnabled;
      report.placesFixture.bookmarkSuggestionsEnabled = Services.prefs.getBoolPref("browser.urlbar.suggest.bookmark", false);
      const rank = report.placesFixture.alternativeEnabled ? report.placesFixture.alt_frecency : report.placesFixture.frecency;
      return report.placesFixture.bookmarkSuggestionsEnabled && report.placesFixture.visit_count === 1 &&
        report.placesFixture.stored_visits === 1 && report.placesFixture.visit_type === transition &&
        report.placesFixture.bookmark_title === fixtureTitle && rank > 0;
    }, "Native visited-bookmark fixture did not become visible to the read-only Places connection");
    window.FluxionUI.setSidebarState("expanded");
    window.FluxionSidebarWidth?.setWidth(232);
    await window.FluxionTheme.set("dark");
    window.moveTo(window.screen.availLeft, window.screen.availTop);
    for (const width of [1280, 800]) {
      stage(`native-toolbar-${width}`);
      window.resizeTo(width, Math.min(850, window.screen.availHeight));
      await wait(() => Math.abs(window.outerWidth - width) <= 2, `Native window did not reach requested ${width}px width`);
      gURLBar.view.close();
      gURLBar.searchMode = null;
      gBrowser.selectedBrowser.focus();
      await delay(350);
      geometry(`${width}-normal`);
      await capture(`capture-product-chrome-${width}`);
      // The owned macOS driver sends Cmd-L and the fixed bookmark restriction
      // as actual key input. Do not refocus or call programmatic search before
      // capturing the first popup that this real interaction opens.
      await nativeQuery(width);
      await wait(() => document.activeElement === gURLBar.inputField, "Native Cmd-L did not focus the address input");
      const focused = geometry(`${width}-focused`);
      await wait(() => {
        const rows = [...document.querySelectorAll(".urlbarView-row")];
        report.suggestions = {
          width, open: gURLBar.view.isOpen, panelPainted: painted(gURLBar.view.panel),
          value: gURLBar.value, searchString: gURLBar.view.queryContext?.searchString,
          searchMode: gURLBar.searchMode,
          results: (gURLBar.view.queryContext?.results || []).slice(0, 12).map(result => ({
            type: result.type, source: result.source, provider: result.providerName,
            title: result.payload?.title, url: result.payload?.url,
          })),
          rows: rows.slice(0, 12).map(row => ({ painted: painted(row), hidden: row.hidden,
            type: row.getAttribute("type"), text: row.textContent.slice(0, 220) })),
        };
        return gURLBar.view.isOpen && painted(gURLBar.view.panel) && rows.some(row =>
          painted(row) && row.getAttribute("type") === "bookmark" && row.textContent.includes(fixtureTitle));
      },
      "Native Places suggestion did not render in the real address-bar view");
      const view = rect(gURLBar.view.panel), input = rect(document.querySelector("#urlbar > .urlbar-input-container"));
      const viewStyle = window.getComputedStyle(gURLBar.view.panel);
      const borders = ["Top", "Right", "Bottom", "Left"].map(side => Number.parseFloat(viewStyle[`border${side}Width`]));
      const resultRows = [...document.querySelectorAll(".urlbarView-row")].filter(painted);
      assert(resultRows.every(row => !row.hasAttribute("label") && !row.querySelector(".urlbarView-group-aria-label")),
        "Native results still expose a Firefox Suggest group label visually or to accessibility");
      assert(borders.every(value => value === 0) && viewStyle.boxShadow === "none",
        `Suggestion view adds a duplicate inner frame: ${JSON.stringify({ borders, shadow: viewStyle.boxShadow })}`);
      report.suggestions.innerFrame = { borders, shadow: viewStyle.boxShadow };
      report.suggestions.rowLabels = resultRows.map(row => row.getAttribute("label"));
      report.geometry.push({ label: `${width}-native-suggestions`, view, input, focused });
      assert(view.top >= input.bottom - 1.5 && view.left <= input.left + 16 && view.right >= input.right - 16 &&
        view.left >= -1 && view.right <= window.innerWidth + 1,
      `Native suggestion view lost its address-field anchor: ${JSON.stringify({ view, input })}`);
      await capture(`capture-product-suggestions-${width}`);
      gURLBar.view.close();
      gURLBar.handleRevert();
      gBrowser.selectedBrowser.focus();
    }
    report.checks.push("normal-and-focused-address-field-balanced-at-1280-and-800", "visible-toolbar-controls-contained-with-no-pairwise-overlap", "expanded-workspace-tab-and-new-tab-labels-share-one-column", "native-places-suggestions-retain-address-field-anchor", "native-suggestion-group-branding-disabled-without-duplicate-inner-frame");
    await workspaceHeading();
    await workspaceTheme();
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-product-policy-and-toolbar-geometry-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null);
      await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
