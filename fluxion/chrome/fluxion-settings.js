/* global gBrowser, Services, FluxionSettings */
(function initialiseFluxionSettings(window) {
  "use strict";

  if (!window.FluxionUI || window.document.getElementById("fluxion-settings")) return;
  const { document } = window;
  const HTML = "http://www.w3.org/1999/xhtml";
  const browser = document.getElementById("browser");
  const contentDeck = document.getElementById("tabbrowser-tabbox");
  if (!browser || !contentDeck) return;
  const { SearchService: searchService } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  );

  const create = (tag, className, text) => {
    const element = document.createElementNS(HTML, tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const pref = {
    bool: (name, fallback) => Services.prefs.getBoolPref(name, fallback),
    int: (name, fallback) => Services.prefs.getIntPref(name, fallback),
    string: (name, fallback) => Services.prefs.getStringPref(name, fallback),
    setBool(name, value) { Services.prefs.setBoolPref(name, Boolean(value)); this.save(); },
    setInt(name, value) { Services.prefs.setIntPref(name, Number(value)); this.save(); },
    setString(name, value) { Services.prefs.setStringPref(name, String(value)); this.save(); },
    save() { Services.prefs.savePrefFile(null); },
  };

  const style = create("style");
  style.id = "fluxion-settings-style";
  style.textContent = `
    #fluxion-settings[hidden] { display: none !important; }
    :root[data-fluxion-settings-visible] #identity-icon-box { display: none !important; }
    #fluxion-settings {
      min-width: 0; flex: 1; display: grid; grid-template-columns: 184px minmax(420px, 720px) 1fr;
      color: var(--fluxion-ink); background: var(--fluxion-bg-raised); overflow: auto;
      font: menu; font-size: 13px;
    }
    .fluxion-settings-nav {
      position: sticky; top: 0; height: 100%; min-height: 520px; padding: 28px 14px;
      background: var(--fluxion-bg); border-inline-end: 1px solid var(--fluxion-line);
    }
    .fluxion-settings-nav h1 { margin: 0 8px 22px; font-size: 16px; letter-spacing: -.02em; }
    .fluxion-settings-nav button {
      width: 100%; height: 31px; padding: 0 9px; border: 0; border-radius: 4px;
      color: var(--fluxion-muted); background: transparent; text-align: start; font: inherit;
    }
    .fluxion-settings-nav button:hover { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-settings-nav button[aria-current="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); font-weight: 600; }
    .fluxion-settings-main { padding: 34px 36px 80px; }
    .fluxion-settings-section[hidden] { display: none; }
    .fluxion-settings-section > h2 { margin: 0 0 6px; font-size: 22px; font-weight: 650; letter-spacing: -.025em; }
    .fluxion-settings-intro { margin: 0 0 26px; color: var(--fluxion-muted); line-height: 1.45; }
    .fluxion-setting { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(190px, 260px); gap: 28px; align-items: center; padding: 15px 0; border-top: 1px solid var(--fluxion-line); }
    .fluxion-setting:first-of-type { border-top: 0; }
    .fluxion-setting-copy b { display: block; margin-bottom: 3px; font-size: 13px; font-weight: 600; }
    .fluxion-setting-copy small { display: block; color: var(--fluxion-muted); line-height: 1.4; }
    .fluxion-settings-control { justify-self: stretch; min-width: 0; }
    .fluxion-settings-control:is(input, select), .fluxion-settings-button {
      box-sizing: border-box; width: 100%; min-height: 30px; border: 1px solid var(--fluxion-line);
      border-radius: 4px; padding: 5px 8px; color: var(--fluxion-ink); background: var(--fluxion-bg);
      font: inherit; box-shadow: none;
    }
    .fluxion-settings-control:focus-visible, .fluxion-settings-button:focus-visible, .fluxion-settings-nav button:focus-visible {
      outline: 2px solid var(--fluxion-accent); outline-offset: 1px;
    }
    .fluxion-settings-button { cursor: default; text-align: center; }
    .fluxion-settings-button:hover { background: var(--fluxion-hover); }
    .fluxion-settings-button.danger { color: light-dark(#8e2f2b, #ef9690); }
    .fluxion-switch { justify-self: end; display: inline-flex; align-items: center; gap: 8px; color: var(--fluxion-muted); }
    .fluxion-switch input { width: 15px; height: 15px; accent-color: var(--fluxion-accent); }
    .fluxion-shortcut { font-family: ui-monospace, monospace; font-size: 12px; color: var(--fluxion-muted); text-align: end; }
    .fluxion-settings-note { min-height: 18px; margin-top: 12px; color: var(--fluxion-muted); font-size: 12px; }
    @media (max-width: 760px) {
      #fluxion-settings { grid-template-columns: 150px minmax(360px, 1fr); }
      .fluxion-settings-main { padding-inline: 24px; }
      .fluxion-setting { grid-template-columns: 1fr; gap: 8px; }
      .fluxion-switch { justify-self: start; }
    }
    @media (prefers-reduced-motion: reduce) { #fluxion-settings * { scroll-behavior: auto !important; } }
  `;
  document.documentElement.appendChild(style);

  const root = create("section");
  root.id = "fluxion-settings";
  root.hidden = true;
  root.setAttribute("aria-label", "Fluxion Settings");
  const nav = create("nav", "fluxion-settings-nav");
  nav.appendChild(create("h1", "", "Fluxion Settings"));
  const main = create("main", "fluxion-settings-main");
  root.append(nav, main);
  browser.appendChild(root);

  const sections = new Map();
  let activeSection = "general";
  const notes = new Map();

  function showSection(id) {
    if (!sections.has(id)) id = "general";
    activeSection = id;
    for (const [key, entry] of sections) {
      entry.panel.hidden = key !== id;
      entry.button.setAttribute("aria-current", String(key === id));
    }
  }

  function section(id, title, description) {
    const button = create("button", "", title);
    button.type = "button";
    button.addEventListener("click", () => showSection(id));
    nav.appendChild(button);
    const panel = create("section", "fluxion-settings-section");
    panel.dataset.section = id;
    panel.append(create("h2", "", title), create("p", "fluxion-settings-intro", description));
    main.appendChild(panel);
    sections.set(id, { button, panel });
    return panel;
  }

  function row(panel, title, description, control) {
    const wrapper = create("div", "fluxion-setting");
    const copy = create("div", "fluxion-setting-copy");
    copy.append(create("b", "", title), create("small", "", description));
    control.classList.add("fluxion-settings-control");
    wrapper.append(copy, control);
    panel.appendChild(wrapper);
    return control;
  }

  function select(options, value, onChange) {
    const control = create("select");
    for (const [optionValue, label] of options) {
      const option = create("option", "", label);
      option.value = optionValue;
      option.selected = String(optionValue) === String(value);
      control.appendChild(option);
    }
    control.addEventListener("change", () => onChange(control.value));
    return control;
  }

  function toggle(label, checked, onChange) {
    const wrapper = create("label", "fluxion-switch");
    const input = create("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    wrapper.append(input, create("span", "", label));
    return wrapper;
  }

  const general = section("general", "General", "Startup, home, and everyday browsing behaviour.");
  row(general, "When Fluxion starts", "Choose whether to begin fresh or restore your previous windows and tabs.", select([
    ["1", "Open home page"], ["3", "Restore previous session"], ["0", "Open a blank page"],
  ], FluxionSettings.startupPage(pref.int("browser.startup.page", 1)), value => {
    pref.setInt("browser.startup.page", FluxionSettings.startupPage(value));
  }));
  const homepage = create("input");
  homepage.type = "text";
  const savedHomepage = pref.string("browser.startup.homepage", "about:newtab");
  homepage.value = savedHomepage === pref.string("fluxion.newtab.url", "")
    ? "about:newtab"
    : savedHomepage;
  homepage.spellcheck = false;
  homepage.addEventListener("change", () => {
    homepage.value = FluxionSettings.homepage(homepage.value);
    pref.setString("browser.startup.homepage", homepage.value);
  });
  row(general, "Home page", "Use a web address, about:newtab, or about:blank.", homepage);
  row(general, "Open links in tabs", "Keep links from other applications in the current Fluxion window.", toggle("Enabled", pref.int("browser.link.open_newwindow", 3) !== 2, checked => {
    pref.setInt("browser.link.open_newwindow", checked ? 3 : 2);
  }));
  const searchEngine = create("select");
  searchEngine.appendChild(create("option", "", "Loading search engines…"));
  searchEngine.disabled = true;
  row(general, "Default search engine", "Used for text entered in the address field.", searchEngine);
  Promise.resolve(searchService.init()).then(async () => {
    const engines = await searchService.getVisibleEngines();
    const current = searchService.defaultEngine;
    searchEngine.replaceChildren();
    for (const engine of engines) {
      const option = create("option", "", engine.name);
      option.value = engine.id || engine.name;
      option.selected = engine === current;
      searchEngine.appendChild(option);
    }
    searchEngine.disabled = false;
    searchEngine.addEventListener("change", async () => {
      const engine = engines.find(item => (item.id || item.name) === searchEngine.value);
      if (!engine) return;
      await searchService.setDefault(engine, searchService.CHANGE_REASON.USER);
      setNote(`Default search engine changed to ${engine.name}.`, "general");
    });
  }).catch(error => {
    searchEngine.replaceChildren(create("option", "", "Search engines unavailable"));
    setNote(`Could not load search engines: ${error.message}`, "general");
  });

  const appearance = section("appearance", "Appearance", "Tune information density without turning the browser into a theme dashboard.");
  row(appearance, "Flow sidebar", "Expanded shows titles; compact keeps the rail; focus leaves a reveal edge.", select([
    ["expanded", "Expanded"], ["compact", "Compact"], ["focus", "Focus"],
  ], FluxionSettings.normaliseSidebar(pref.string("fluxion.sidebar.state", "expanded")), value => {
    window.FluxionUI.setSidebarState(value);
  }));
  row(appearance, "Tab density", "Adjust the vertical rhythm of tabs in Flow.", select([
    ["compact", "Compact"], ["standard", "Standard"], ["roomy", "Roomy"],
  ], FluxionSettings.normaliseDensity(pref.string("fluxion.tabs.density", "standard")), value => {
    window.FluxionUI.setTabDensity(value);
  }));
  row(appearance, "Interface motion", "Short transitions remain disabled when macOS Reduce Motion is active.", toggle("Enabled", pref.bool("fluxion.animations.enabled", true), checked => {
    pref.setBool("fluxion.animations.enabled", checked);
    document.documentElement.toggleAttribute("data-fluxion-no-motion", !checked);
  }));

  const tabs = section("tabs", "Tabs", "Control tab prompts and the behaviour of large sessions.");
  row(tabs, "Sleep inactive tabs", "Release memory through Gecko after a tab has stayed unused. Pinned, audio, shared, split, private, and unsaved-form tabs are protected.", select([
    ["5", "After 5 minutes"], ["15", "After 15 minutes"], ["30", "After 30 minutes"],
    ["60", "After 1 hour"], ["0", "Never"],
  ], window.FluxionTabSleeping?.minutes() ?? 30, value => {
    window.FluxionTabSleeping?.setMinutes(value);
    setNote(value === "0" ? "Automatic tab sleeping disabled." : `Inactive tabs will sleep after ${value} minutes.`, "tabs");
  }));
  row(tabs, "Confirm closing many tabs", "Ask before closing a window with multiple open tabs.", toggle("Enabled", pref.bool("browser.tabs.warnOnClose", true), checked => pref.setBool("browser.tabs.warnOnClose", checked)));
  row(tabs, "Switch to new tabs", "Immediately focus links that request a new foreground tab.", toggle("Enabled", pref.bool("browser.tabs.loadInBackground", true) === false, checked => pref.setBool("browser.tabs.loadInBackground", !checked)));
  row(tabs, "Confirm quitting", "Protect the current browsing session when quitting with ⌘Q.", toggle("Enabled", pref.bool("browser.warnOnQuit", true), checked => pref.setBool("browser.warnOnQuit", checked)));

  const search = section("search", "Search & Memory", "Browser Memory is local, optional, and never runs in private windows.");
  const memoryToggle = toggle("Enabled", Boolean(window.FluxionMemory?.enabled()), async checked => {
    memoryToggle.querySelector("input").disabled = true;
    try {
      if (checked) await window.FluxionMemory?.enable();
      else await window.FluxionMemory?.clearAndDisable();
      setNote(checked ? "Browser Memory enabled. Indexing runs locally in the background." : "Browser Memory disabled and its local vector index cleared.");
    } catch (error) {
      memoryToggle.querySelector("input").checked = !checked;
      setNote(`Could not update Browser Memory: ${error.message}`);
    } finally { memoryToggle.querySelector("input").disabled = false; }
  });
  row(search, "Browser Memory", "Find previously visited pages by meaning as well as exact words.", memoryToggle);
  const domains = create("input");
  domains.type = "text";
  domains.placeholder = "example.com, private.example";
  domains.value = window.FluxionMemory?.excludedDomains().join(", ") || "";
  domains.addEventListener("change", async () => {
    const next = FluxionSettings.excludedDomains(domains.value);
    const saved = await window.FluxionMemory?.setExcludedDomains(next) || next;
    domains.value = saved.join(", ");
    setNote("Browser Memory exclusions saved.");
  });
  row(search, "Excluded domains", "These sites are removed from and never added to Browser Memory.", domains);
  const clearMemory = create("button", "fluxion-settings-button danger", "Clear Browser Memory");
  clearMemory.type = "button";
  clearMemory.addEventListener("click", async () => {
    if (!Services.prompt.confirm(window, "Clear Browser Memory", "Delete the local semantic index and turn Browser Memory off?")) return;
    await window.FluxionMemory?.clearAndDisable();
    memoryToggle.querySelector("input").checked = false;
    setNote("Browser Memory was cleared.");
  });
  row(search, "Delete semantic data", "This does not delete ordinary Gecko browsing history.", clearMemory);

  const privacy = section("privacy", "Privacy", "Manage locally stored browsing data using Gecko’s mature security services.");
  const clearHistory = create("button", "fluxion-settings-button danger", "Clear browsing history…");
  clearHistory.type = "button";
  clearHistory.addEventListener("click", async () => {
    if (!Services.prompt.confirm(window, "Clear Browsing History", "Delete all browsing and download history? This cannot be undone.")) return;
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    await PlacesUtils.history.clear();
    setNote("Browsing history cleared.");
  });
  row(privacy, "Browsing history", "Delete visited pages and download-history records from this profile.", clearHistory);
  const clearCookies = create("button", "fluxion-settings-button danger", "Clear cookies and site data…");
  clearCookies.type = "button";
  clearCookies.addEventListener("click", () => {
    if (!Services.prompt.confirm(window, "Clear Site Data", "Sign out of sites and delete all cookies and cached website data?")) return;
    Services.cookies.removeAll();
    Services.cache2.clear();
    setNote("Cookies and cached site data cleared.");
  });
  row(privacy, "Cookies and site data", "Clearing this data signs you out of most websites.", clearCookies);
  const permissions = create("button", "fluxion-settings-button danger", "Reset site permissions…");
  permissions.type = "button";
  permissions.addEventListener("click", () => {
    if (!Services.prompt.confirm(window, "Reset Site Permissions", "Remove every saved camera, microphone, notification, and location decision?")) return;
    Services.perms.removeAll();
    setNote("Saved site permissions reset.");
  });
  row(privacy, "Site permissions", "Reset saved allow and block decisions for all websites.", permissions);

  const keyboard = section("keyboard", "Keyboard", "Fluxion keeps common browser conventions while making Flow fast to navigate.");
  for (const [label, shortcut] of [
    ["Command palette", "⌘ K"], ["Search open tabs", "⌘ ⇧ A"], ["Cycle Flow sidebar", "⌘ ⇧ \\"],
    ["Next / previous workspace", "⌘ ⌥ ]  /  ⌘ ⌥ ["], ["New tab", "⌘ T"],
    ["Reopen closed tab", "⌘ ⇧ T"], ["Find in page", "⌘ F"], ["Downloads", "⌘ ⇧ J"],
  ]) row(keyboard, label, "", create("div", "fluxion-shortcut", shortcut));

  function setNote(message, sectionId = activeSection) {
    const panel = sections.get(sectionId)?.panel;
    if (!panel) return;
    let status = notes.get(sectionId);
    if (!status) {
      status = create("p", "fluxion-settings-note");
      status.setAttribute("role", "status");
      notes.set(sectionId, status);
      panel.appendChild(status);
    }
    status.textContent = message;
  }

  function isSettingsTab() {
    return gBrowser.selectedBrowser?.currentURI?.spec.startsWith("about:preferences");
  }

  function syncVisibility() {
    const visible = isSettingsTab();
    root.hidden = !visible;
    contentDeck.hidden = visible;
    document.documentElement.toggleAttribute("data-fluxion-settings-visible", visible);
    if (visible) {
      const hash = gBrowser.selectedBrowser.currentURI.spec.split("#")[1] || "general";
      showSection(hash === "privacy" ? "privacy" : activeSection);
      Services.prefs.setStringPref("fluxion.settings.visual.health", "settings-surface-visible");
      Services.prefs.savePrefFile(null);
    }
  }

  const progressListener = { onLocationChange: syncVisibility };
  gBrowser.addTabsProgressListener(progressListener);
  gBrowser.tabContainer.addEventListener("TabSelect", syncVisibility);
  window.addEventListener("unload", () => {
    gBrowser.removeTabsProgressListener(progressListener);
    gBrowser.tabContainer.removeEventListener("TabSelect", syncVisibility);
    root.remove();
    style.remove();
    document.documentElement.removeAttribute("data-fluxion-settings-visible");
  }, { once: true });
  showSection("general");
  syncVisibility();
  Services.prefs.setStringPref("fluxion.settings.health", "live-preferences-loaded");
  Services.prefs.savePrefFile(null);
  if (Services.env.get("FLUXION_VISUAL_SETTINGS_TEST") === "1") {
    const tab = gBrowser.addTrustedTab("about:preferences");
    tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
    window.requestAnimationFrame(syncVisibility);
  }
})(window);
