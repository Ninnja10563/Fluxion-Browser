/* global gBrowser, Services, FluxionSettings, FluxionAIProviders, FluxionPermissionPolicy */
(function initialiseFluxionSettings(window) {
  "use strict";

  if (!window.FluxionUI || window.document.getElementById("fluxion-settings")) return;
  const { document } = window;
  const HTML = "http://www.w3.org/1999/xhtml";
  const PRODUCT_VERSION = "0.21.0";
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
    .fluxion-shortcut-control { display: grid; grid-template-columns: 1fr 30px; gap: 5px; }
    .fluxion-shortcut-key, .fluxion-shortcut-reset {
      min-height: 30px; border: 1px solid var(--fluxion-line); border-radius: 4px;
      color: var(--fluxion-ink); background: var(--fluxion-bg); font: inherit;
    }
    .fluxion-shortcut-key { padding: 4px 8px; font-family: ui-monospace, monospace; font-size: 12px; }
    .fluxion-shortcut-reset { padding: 0; color: var(--fluxion-muted); font-size: 15px; }
    .fluxion-shortcut-key:hover, .fluxion-shortcut-reset:hover { background: var(--fluxion-hover); }
    .fluxion-shortcut-key[data-capturing="true"] { border-color: var(--fluxion-accent); color: var(--fluxion-muted); }
    .fluxion-settings-note { min-height: 18px; margin-top: 12px; color: var(--fluxion-muted); font-size: 12px; }
    .fluxion-settings-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .fluxion-permissions-toolbar {
      display: grid; grid-template-columns: minmax(220px, 1fr) auto; gap: 14px;
      align-items: center; margin: 0 0 12px;
    }
    .fluxion-permissions-toolbar input { min-height: 32px; }
    .fluxion-permissions-count { color: var(--fluxion-muted); font-size: 12px; white-space: nowrap; }
    .fluxion-permissions-list { border-bottom: 1px solid var(--fluxion-line); }
    .fluxion-permission-site { border-top: 1px solid var(--fluxion-line); }
    .fluxion-permission-site-head {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px;
      align-items: center; min-height: 46px; padding: 8px 0;
    }
    .fluxion-permission-site-copy { min-width: 0; }
    .fluxion-permission-site-copy b,
    .fluxion-permission-site-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-permission-site-copy b { font-size: 13px; font-weight: 650; }
    .fluxion-permission-site-copy small { margin-top: 2px; color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-permission-site-head .fluxion-settings-button,
    .fluxion-permission-row .fluxion-settings-button { width: auto; min-width: 58px; padding-inline: 9px; }
    .fluxion-permission-row {
      display: grid; grid-template-columns: minmax(130px, 1fr) auto minmax(120px, auto) auto;
      gap: 12px; align-items: center; min-height: 37px; padding: 0 0 0 14px;
      border-top: 1px solid color-mix(in srgb, var(--fluxion-line) 62%, transparent);
    }
    .fluxion-permission-kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-permission-state {
      min-width: 62px; color: var(--fluxion-muted); font-size: 12px; font-weight: 600; text-align: end;
    }
    .fluxion-permission-state[data-tone="allow"] { color: light-dark(#23623c, #7bc49a); }
    .fluxion-permission-state[data-tone="block"] { color: light-dark(#8e2f2b, #ef9690); }
    .fluxion-permission-expiry { color: var(--fluxion-muted); font-size: 11px; text-align: end; white-space: nowrap; }
    .fluxion-permissions-empty { margin: 0; padding: 36px 0; color: var(--fluxion-muted); text-align: center; border-top: 1px solid var(--fluxion-line); }
    .fluxion-about-mark {
      display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 15px;
      align-items: center; padding: 8px 0 25px;
    }
    .fluxion-about-mark img { width: 48px; height: 48px; }
    .fluxion-about-mark h3 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.015em; }
    .fluxion-about-mark p { margin: 4px 0 0; color: var(--fluxion-muted); line-height: 1.4; }
    @media (max-width: 760px) {
      #fluxion-settings { grid-template-columns: 150px minmax(360px, 1fr); }
      .fluxion-settings-main { padding-inline: 24px; }
      .fluxion-setting { grid-template-columns: 1fr; gap: 8px; }
      .fluxion-switch { justify-self: start; }
      .fluxion-permission-row { grid-template-columns: minmax(100px, 1fr) auto auto; }
      .fluxion-permission-expiry { display: none; }
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
  let renderPermissions = () => {};

  function showSection(id) {
    if (!sections.has(id)) id = "general";
    activeSection = id;
    for (const [key, entry] of sections) {
      entry.panel.hidden = key !== id;
      entry.button.setAttribute("aria-current", String(key === id));
    }
    if (id === "permissions") renderPermissions();
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

  const ai = section("ai", "AI", "Optional page tools. Ordinary browsing and Browser Memory remain fully functional when AI is disabled.");
  const initialAI = window.FluxionAI.config();
  const aiProvider = select([
    ["disabled", "Disabled"],
    ["ollama", "Ollama (local)"],
    ["openai-compatible", "OpenAI-compatible"],
  ], initialAI.provider, () => {});
  row(ai, "Provider", "Local providers keep requests on this Mac. Remote compatible endpoints require HTTPS and explicit page-sharing consent.", aiProvider);
  const aiEndpoint = create("input");
  aiEndpoint.type = "url";
  aiEndpoint.spellcheck = false;
  aiEndpoint.value = initialAI.endpoint;
  row(ai, "Endpoint", "HTTP is accepted only for localhost and loopback addresses.", aiEndpoint);
  const aiModel = create("input");
  aiModel.type = "text";
  aiModel.spellcheck = false;
  aiModel.value = initialAI.model;
  row(ai, "Model", "The exact model identifier exposed by your provider.", aiModel);
  const aiKey = create("input");
  aiKey.type = "password";
  aiKey.autocomplete = "new-password";
  aiKey.placeholder = "Leave blank to keep saved key";
  row(ai, "API key", "Stored in Firefox’s encrypted login store, never in Fluxion preferences or source code.", aiKey);
  aiProvider.addEventListener("change", () => {
    const defaults = FluxionAIProviders.DEFAULTS[aiProvider.value];
    aiEndpoint.disabled = aiProvider.value === "disabled";
    aiModel.disabled = aiProvider.value === "disabled";
    aiKey.disabled = aiProvider.value !== "openai-compatible";
    if (defaults && aiProvider.value !== initialAI.provider) {
      aiEndpoint.value = defaults.endpoint;
      aiModel.value = defaults.model;
    }
  });
  aiProvider.dispatchEvent(new window.Event("change"));
  const saveAI = create("button", "fluxion-settings-button", "Save provider");
  saveAI.type = "button";
  saveAI.addEventListener("click", async () => {
    saveAI.disabled = true;
    try {
      const next = await window.FluxionAI.configure({
        provider: aiProvider.value,
        endpoint: aiEndpoint.value,
        model: aiModel.value,
        ...(aiKey.value ? { secret: aiKey.value } : {}),
      });
      aiEndpoint.value = next.endpoint;
      aiModel.value = next.model;
      aiKey.value = "";
      setNote(next.provider === "disabled" ? "AI disabled." : `Saved ${next.provider} provider.`, "ai");
    } catch (error) {
      setNote(error.message, "ai");
    } finally { saveAI.disabled = false; }
  });
  row(ai, "Save connection", "Provider changes apply immediately without restarting Fluxion.", saveAI);
  const aiActions = create("div", "fluxion-settings-actions");
  const testAI = create("button", "fluxion-settings-button", "Test connection");
  testAI.type = "button";
  testAI.addEventListener("click", async () => {
    testAI.disabled = true;
    try {
      const result = await window.FluxionAI.testConnection();
      setNote(result.detail, "ai");
    } catch (error) { setNote(error.message, "ai"); }
    finally { testAI.disabled = false; }
  });
  const clearAIKey = create("button", "fluxion-settings-button danger", "Clear API key");
  clearAIKey.type = "button";
  clearAIKey.addEventListener("click", async () => {
    await window.FluxionAI.setSecret("");
    aiKey.value = "";
    setNote("Saved API key removed.", "ai");
  });
  aiActions.append(testAI, clearAIKey);
  row(ai, "Connection tools", "Tests the configured model service without sharing a webpage.", aiActions);

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
  const managePermissions = create("button", "fluxion-settings-button", "Manage permissions");
  managePermissions.type = "button";
  managePermissions.addEventListener("click", () => showSection("permissions"));
  row(privacy, "Site permissions", "Review camera, microphone, location, notification, and other saved site decisions.", managePermissions);

  const permissionPanel = section(
    "permissions", "Permissions",
    "Saved decisions come directly from Gecko and take effect immediately. Sites with no saved decision use your browser defaults.",
  );
  const permissionToolbar = create("div", "fluxion-permissions-toolbar");
  const permissionSearch = create("input", "fluxion-settings-control");
  permissionSearch.type = "search";
  permissionSearch.placeholder = "Search sites or permission types";
  permissionSearch.setAttribute("aria-label", "Search saved site permissions");
  const permissionCount = create("span", "fluxion-permissions-count");
  permissionToolbar.append(permissionSearch, permissionCount);
  permissionPanel.appendChild(permissionToolbar);
  const permissionList = create("div", "fluxion-permissions-list");
  permissionList.setAttribute("aria-live", "polite");
  permissionPanel.appendChild(permissionList);

  renderPermissions = (providedRecords = null) => {
    const records = providedRecords || window.FluxionPermissions?.list() || [];
    const groups = FluxionPermissionPolicy.group(records, permissionSearch.value);
    const visibleCount = groups.reduce((total, group) => total + group.permissions.length, 0);
    permissionCount.textContent = permissionSearch.value.trim()
      ? `${visibleCount} of ${records.length}`
      : `${records.length} saved`;
    permissionList.replaceChildren();
    if (!groups.length) {
      permissionList.appendChild(create(
        "p", "fluxion-permissions-empty",
        records.length ? "No saved decisions match this search." : "No saved site decisions.",
      ));
      return;
    }
    for (const group of groups) {
      const site = create("section", "fluxion-permission-site");
      const head = create("div", "fluxion-permission-site-head");
      const copy = create("div", "fluxion-permission-site-copy");
      copy.append(
        create("b", "", group.site),
        create("small", "", `${group.origin} · ${group.context}`),
      );
      const resetSite = create("button", "fluxion-settings-button", "Reset site");
      resetSite.type = "button";
      resetSite.addEventListener("click", () => {
        if (!Services.prompt.confirm(
          window, "Reset Site Permissions",
          `Remove all saved permission decisions for ${group.site}?`,
        )) return;
        const count = window.FluxionPermissions?.removeSite(group.siteKey) || 0;
        setNote(`Reset ${count} saved decision${count === 1 ? "" : "s"} for ${group.site}.`, "permissions");
      });
      head.append(copy, resetSite);
      site.appendChild(head);
      for (const permission of group.permissions) {
        const decision = create("div", "fluxion-permission-row");
        const state = create("span", "fluxion-permission-state", permission.state);
        state.dataset.tone = permission.tone;
        const reset = create("button", "fluxion-settings-button", "Reset");
        reset.type = "button";
        reset.setAttribute("aria-label", `Reset ${permission.typeLabel} for ${group.site}`);
        reset.addEventListener("click", () => {
          if (!window.FluxionPermissions?.remove(permission.id)) return;
          setNote(`${permission.typeLabel} decision reset for ${group.site}.`, "permissions");
        });
        decision.append(
          create("span", "fluxion-permission-kind", permission.typeLabel),
          state,
          create("span", "fluxion-permission-expiry", permission.expiry),
          reset,
        );
        site.appendChild(decision);
      }
      permissionList.appendChild(site);
    }
  };
  permissionSearch.addEventListener("input", () => renderPermissions());
  const resetAllPermissions = create("button", "fluxion-settings-button danger", "Reset all permissions…");
  resetAllPermissions.type = "button";
  resetAllPermissions.addEventListener("click", () => {
    if (!Services.prompt.confirm(
      window, "Reset All Site Permissions",
      "Remove every saved site permission decision? This cannot be undone.",
    )) return;
    window.FluxionPermissions?.clear();
    setNote("All saved site permission decisions were reset.", "permissions");
  });
  row(
    permissionPanel, "Reset every decision",
    "Clears all saved allow, block, and ask choices from Gecko’s permission manager.",
    resetAllPermissions,
  );
  const unsubscribePermissions = window.FluxionPermissions?.subscribe(records => {
    if (!root.hidden && activeSection === "permissions") renderPermissions(records);
  });

  const keyboard = section("keyboard", "Keyboard", "Change Fluxion commands without overriding protected browser or macOS shortcuts.");
  const shortcutButtons = new Map();
  function refreshShortcutButtons() {
    for (const [id, button] of shortcutButtons) button.textContent = window.FluxionShortcuts.format(id);
  }
  for (const action of window.FluxionShortcuts.actions()) {
    const control = create("div", "fluxion-shortcut-control");
    const key = create("button", "fluxion-shortcut-key", window.FluxionShortcuts.format(action.id));
    key.type = "button";
    key.setAttribute("aria-label", `Change ${action.label} shortcut`);
    const reset = create("button", "fluxion-shortcut-reset", "↺");
    reset.type = "button";
    reset.title = `Reset ${action.label}`;
    reset.setAttribute("aria-label", reset.title);
    let beforeCapture = key.textContent;
    const stopCapture = () => {
      key.dataset.capturing = "false";
      key.textContent = window.FluxionShortcuts.format(action.id) || beforeCapture;
    };
    key.addEventListener("click", () => {
      beforeCapture = key.textContent;
      key.dataset.capturing = "true";
      key.textContent = "Press shortcut…";
    });
    key.addEventListener("keydown", event => {
      if (key.dataset.capturing !== "true") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { stopCapture(); return; }
      const chord = window.FluxionShortcuts.capture(event);
      if (!chord) return;
      const result = window.FluxionShortcuts.set(action.id, chord);
      if (!result.ok) {
        setNote(result.reason, "keyboard");
        key.textContent = "Press another…";
        return;
      }
      stopCapture();
      refreshShortcutButtons();
      setNote(`${action.label} changed to ${window.FluxionShortcuts.format(action.id)}.`, "keyboard");
    });
    key.addEventListener("blur", stopCapture);
    reset.addEventListener("click", () => {
      window.FluxionShortcuts.reset(action.id);
      refreshShortcutButtons();
      setNote(`${action.label} reset.`, "keyboard");
    });
    shortcutButtons.set(action.id, key);
    control.append(key, reset);
    row(keyboard, action.label, "Click the shortcut, then press a new key combination.", control);
  }
  for (const [label, shortcut] of [
    ["New tab", "⌘ T"], ["Reopen closed tab", "⌘ ⇧ T"],
    ["Find in page", "⌘ F"], ["Downloads", "⌘ ⇧ J"],
  ]) row(keyboard, label, "Gecko browser shortcut", create("div", "fluxion-shortcut", shortcut));

  const about = section(
    "about", "About Fluxion", `Gecko Foundation Preview ${PRODUCT_VERSION}`,
  );
  const aboutMark = create("div", "fluxion-about-mark");
  const aboutLogo = create("img");
  aboutLogo.src = "resource://fluxion/assets/fluxion.svg";
  aboutLogo.alt = "";
  const aboutCopy = create("div");
  aboutCopy.append(
    create("h3", "", "A calm browser for active work."),
    create("p", "", "Flow and workspaces over Mozilla’s Gecko web platform."),
  );
  aboutMark.append(aboutLogo, aboutCopy);
  about.appendChild(aboutMark);
  row(about, "Engine", "Mozilla Gecko", create("div", "fluxion-shortcut", "Standards-compatible"));
  row(
    about, "Privacy",
    "Browser Memory is optional, local, and unavailable in private windows.",
    create("div", "fluxion-shortcut", "Local by default"),
  );
  const openAboutDestination = url => {
    const tab = gBrowser.addTrustedTab(url);
    tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
  };
  const source = create("button", "fluxion-settings-button", "Open source repository");
  source.type = "button";
  source.addEventListener("click", () => openAboutDestination(
    "https://github.com/Ninnja10563/Fluxion-Browser",
  ));
  row(about, "Source", "Fluxion is developed in public and Gecko components retain their original licenses.", source);
  const licenses = create("button", "fluxion-settings-button", "Open third-party licenses");
  licenses.type = "button";
  licenses.addEventListener("click", () => openAboutDestination("about:license"));
  row(about, "Licenses", "Mozilla Public License and bundled third-party notices.", licenses);

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
    if (visible) contentDeck.hidden = true;
    else if (!document.documentElement.hasAttribute("data-fluxion-library-visible")) contentDeck.hidden = false;
    document.documentElement.toggleAttribute("data-fluxion-settings-visible", visible);
    if (visible) {
      const hash = gBrowser.selectedBrowser.currentURI.spec.split("#")[1] || "general";
      showSection(sections.has(hash) ? hash : activeSection);
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
    unsubscribePermissions?.();
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
  if (Services.env.get("FLUXION_VISUAL_SHORTCUT_TEST") === "1") {
    window.setTimeout(() => {
      const tab = [...gBrowser.tabs].find(candidate => candidate.linkedBrowser?.currentURI?.spec.startsWith("about:preferences"));
      if (tab) gBrowser.selectedTab = tab;
      showSection("keyboard");
      const result = window.FluxionShortcuts.set("palette", "Accel+Alt+KeyK");
      refreshShortcutButtons();
      if (result.ok && window.FluxionShortcuts.get("palette") === "Accel+Alt+KeyK") {
        Services.prefs.setStringPref("fluxion.shortcuts.visual.health", "custom-shortcut-persisted");
        Services.prefs.savePrefFile(null);
      }
    }, 3200);
  }
  if (Services.env.get("FLUXION_VISUAL_PERMISSIONS_TEST") === "1") {
    window.setTimeout(() => {
      const tab = [...gBrowser.tabs].find(candidate =>
        candidate.linkedBrowser?.currentURI?.spec.startsWith("about:preferences"));
      if (tab) gBrowser.selectedTab = tab;
      showSection("permissions");
      renderPermissions();
      const text = permissionPanel.textContent;
      if (
        text.includes("permissions.fluxion.test") && text.includes("Camera") &&
        text.includes("Microphone") && text.includes("Allow") && text.includes("Block")
      ) {
        Services.prefs.setStringPref(
          "fluxion.permissions.surface.visual.health", "native-site-decisions-visible",
        );
        Services.prefs.savePrefFile(null);
      }
    }, 18500);
  }
  if (Services.env.get("FLUXION_VISUAL_ABOUT_TEST") === "1") {
    window.setTimeout(() => {
      const tab = gBrowser.addTrustedTab("about:preferences#about");
      tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
      gBrowser.selectedTab = tab;
      window.setTimeout(() => {
        syncVisibility();
        showSection("about");
        window.FluxionUI.refresh();
        if (
          about.textContent.includes(`Gecko Foundation Preview ${PRODUCT_VERSION}`) &&
          about.textContent.includes("Mozilla Gecko") &&
          !about.textContent.includes("Firefox Browser")
        ) {
          Services.prefs.setStringPref(
            "fluxion.about.visual.health", "versioned-about-fluxion-visible",
          );
          Services.prefs.savePrefFile(null);
        }
      }, 450);
    }, 20500);
  }
})(window);
