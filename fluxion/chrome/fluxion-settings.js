/* global Cu, gBrowser, Services, FluxionSettings, FluxionAIProviders, FluxionPermissionPolicy, FluxionWorkspaces, FluxionWorkspaceEditor */
(function initialiseFluxionSettings(window) {
  "use strict";

  if (!window.FluxionUI || window.document.getElementById("fluxion-settings")) return;
  const { document } = window;
  const HTML = "http://www.w3.org/1999/xhtml";
  const PRODUCT_VERSION = "0.60.0";
  const PRODUCT_RELEASE = "0.60.0-preview.1";
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
      position: absolute; inset-block: 0; inset-inline-start: var(--fluxion-flow-layout-width);
      inset-inline-end: 0; z-index: 3; min-width: 0;
      display: flex; color: var(--fluxion-ink); background: var(--fluxion-bg-raised); overflow: hidden;
      container: fluxion-settings / inline-size;
      font: menu; font-size: 13px;
    }
    .fluxion-settings-nav {
      box-sizing: border-box; flex: 0 0 184px; width: 184px; min-width: 184px;
      padding: 28px 14px; overflow: auto;
      background: var(--fluxion-bg); border-inline-end: 1px solid var(--fluxion-line);
    }
    .fluxion-settings-nav h1 { margin: 0 8px 22px; font-size: 16px; letter-spacing: -.02em; }
    .fluxion-settings-nav button {
      width: 100%; height: 31px; padding: 0 9px; border: 0; border-radius: 4px;
      color: var(--fluxion-muted); background: transparent; text-align: start; font: inherit;
    }
    .fluxion-settings-nav button:hover { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-settings-nav button[aria-current="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); font-weight: 600; }
    .fluxion-settings-main {
      box-sizing: border-box; flex: 0 1 720px; height: 100%; min-width: 420px;
      padding: 34px 36px 80px; overflow: auto;
    }
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
    .fluxion-memory-lists { min-width: 0; border-top: 1px solid var(--fluxion-line); padding-top: 14px; }
    .fluxion-memory-list { border-bottom: 1px solid var(--fluxion-line); padding: 10px 0; }
    .fluxion-memory-list summary { cursor: pointer; font-weight: 550; overflow-wrap: anywhere; }
    .fluxion-memory-list-fields { display: grid; gap: 10px; padding-top: 12px; }
    .fluxion-memory-list-fields label { display: grid; gap: 5px; min-width: 0; }
    .fluxion-memory-list-fields input:not([type=checkbox]), .fluxion-memory-list-fields textarea { box-sizing: border-box; width: 100%; min-width: 0; }
    .fluxion-memory-list-fields textarea { resize: vertical; min-height: 70px; font: inherit; color: inherit; background: var(--fluxion-bg); border: 1px solid var(--fluxion-line); padding: 7px; }
    .fluxion-memory-list-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .fluxion-memory-list-actions button { width: auto; max-width: 100%; overflow-wrap: anywhere; }
    .fluxion-memory-list :is(summary, textarea, input):focus-visible { outline: 2px solid var(--fluxion-accent); outline-offset: 1px; }
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
    #fluxion-sidebar-width-controls { grid-template-columns: minmax(0, 1fr) auto; }
    .fluxion-workspace-create {
      display: grid; grid-template-columns: minmax(180px, 1fr) auto; gap: 7px;
      align-items: center; margin-bottom: 18px;
    }
    .fluxion-workspace-create .fluxion-settings-button { width: auto; min-width: 76px; }
    .fluxion-workspace-summary {
      display: flex; justify-content: space-between; gap: 12px; margin-bottom: 7px;
      color: var(--fluxion-muted); font-size: 11px;
    }
    .fluxion-settings-workspace-list { display: block; border-bottom: 1px solid var(--fluxion-line); }
    .fluxion-settings-workspace-row { padding: 13px 0; border-top: 1px solid var(--fluxion-line); }
    .fluxion-settings-workspace-identity {
      display: grid; grid-template-columns: 18px minmax(120px, 1fr) auto; gap: 9px;
      align-items: center; margin-bottom: 8px;
    }
    .fluxion-settings-workspace-mark { width: 13px; height: 13px; color: var(--workspace-accent); }
    .fluxion-settings-workspace-name { min-height: 29px !important; font-weight: 600 !important; }
    .fluxion-settings-workspace-current {
      min-width: 48px; color: var(--fluxion-muted); font-size: 11px; text-align: end;
    }
    .fluxion-settings-workspace-controls {
      display: grid; grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) auto;
      gap: 7px; padding-inline-start: 27px;
    }
    .fluxion-settings-workspace-actions { display: flex; gap: 4px; }
    .fluxion-settings-workspace-actions .fluxion-settings-button {
      width: auto; min-width: 48px; padding-inline: 8px;
    }
    .fluxion-settings-workspace-actions .fluxion-settings-button.danger { min-width: 58px; }
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
      .fluxion-settings-nav { flex-basis: 150px; width: 150px; min-width: 150px; }
      .fluxion-settings-main { min-width: 360px; padding-inline: 24px; }
      .fluxion-setting { grid-template-columns: 1fr; gap: 8px; }
      .fluxion-switch { justify-self: start; }
      .fluxion-settings-workspace-controls { grid-template-columns: 1fr 1fr; }
      .fluxion-settings-workspace-actions { grid-column: 1 / -1; }
    }
    /* Flow changes the usable Settings width independently of the window.
       Keep these after viewport fallbacks so a wide rail cannot clip fields. */
    @container fluxion-settings (max-width: 700px) {
      .fluxion-settings-nav { flex-basis: 140px; width: 140px; min-width: 140px; padding-inline: 10px; }
      .fluxion-settings-main { min-width: 0; padding-inline: 20px; }
      .fluxion-setting { grid-template-columns: minmax(0, 1fr); gap: 8px; }
      .fluxion-setting-copy { min-width: 0; overflow-wrap: anywhere; }
      .fluxion-switch { justify-self: start; }
      .fluxion-settings-section, .fluxion-settings-intro, .fluxion-settings-note,
      .fluxion-shortcut, .fluxion-about-mark { min-width: 0; overflow-wrap: anywhere; }
      .fluxion-settings-button, .fluxion-shortcut-key {
        min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere;
      }
      .fluxion-settings-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .fluxion-shortcut-control { min-width: 0; grid-template-columns: minmax(0, 1fr) 30px; }
      .fluxion-workspace-create { grid-template-columns: minmax(0, 1fr) auto; }
      .fluxion-workspace-summary { flex-wrap: wrap; gap: 4px 12px; overflow-wrap: anywhere; }
      .fluxion-workspace-summary > span { min-width: 0; max-width: 100%; }
      .fluxion-settings-workspace-identity { grid-template-columns: 18px minmax(0, 1fr) auto; }
      .fluxion-settings-workspace-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .fluxion-settings-workspace-actions { grid-column: 1 / -1; flex-wrap: wrap; }
      .fluxion-permissions-toolbar { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
      .fluxion-permission-site-head { gap: 8px; }
      .fluxion-permission-site-copy b, .fluxion-permission-site-copy small,
      .fluxion-permission-kind {
        overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere;
      }
      .fluxion-permission-row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; padding: 9px 0 9px 10px; }
      .fluxion-permission-kind { grid-column: 1; grid-row: 1; }
      .fluxion-permission-state { grid-column: 2; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
      .fluxion-permission-expiry { grid-column: 1; grid-row: 2; text-align: start; white-space: normal; overflow-wrap: anywhere; }
      .fluxion-permission-row .fluxion-settings-button { grid-column: 2; grid-row: 2; }
      .fluxion-about-mark > div { min-width: 0; }
    }
    @container fluxion-settings (max-width: 480px) {
      .fluxion-settings-nav button { height: auto; min-height: 31px; padding-block: 6px; }
      .fluxion-settings-nav { flex-basis: 120px; width: 120px; min-width: 120px; padding-inline: 6px; }
      .fluxion-settings-main { padding-inline: 12px; }
      .fluxion-settings-nav button { padding-inline: 6px; }
      .fluxion-settings-actions, .fluxion-workspace-create,
      .fluxion-settings-workspace-controls, .fluxion-permissions-toolbar,
      .fluxion-permission-site-head { grid-template-columns: minmax(0, 1fr); }
      .fluxion-workspace-create .fluxion-settings-button,
      .fluxion-permission-site-head .fluxion-settings-button { justify-self: start; }
      .fluxion-settings-workspace-identity { grid-template-columns: 18px minmax(0, 1fr); gap: 5px 9px; }
      .fluxion-settings-workspace-current { grid-column: 2; min-width: 0; text-align: start; }
      .fluxion-settings-workspace-controls { padding-inline-start: 0; }
      .fluxion-permissions-count { white-space: normal; overflow-wrap: anywhere; }
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
  const tabSections = new WeakMap();
  let activeSection = "general";
  const notes = new Map();
  let renderPermissions = () => {};
  let renderWorkspaces = () => {};

  function sectionFromLocation(spec) {
    const queryRoute = spec.match(/[?&]fluxion=([^&#]+)/)?.[1];
    if (queryRoute) {
      try {
        const decoded = decodeURIComponent(queryRoute);
        if (sections.has(decoded)) return decoded;
      } catch (_) {}
    }
    const hash = spec.split("#")[1] || "general";
    return sections.has(hash) ? hash : activeSection;
  }

  function showSection(id, { remember = true } = {}) {
    if (!sections.has(id)) id = "general";
    activeSection = id;
    const selectedBrowser = gBrowser.selectedBrowser;
    const spec = selectedBrowser?.currentURI?.spec;
    if (remember && spec?.startsWith("about:preferences")) {
      tabSections.set(selectedBrowser, { spec, section: id });
    }
    for (const [key, entry] of sections) {
      entry.panel.hidden = key !== id;
      entry.button.setAttribute("aria-current", String(key === id));
    }
    if (id === "permissions") renderPermissions();
    if (id === "workspaces") renderWorkspaces();
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

  let settingRowId = 0;
  function row(panel, title, description, control) {
    const wrapper = create("div", "fluxion-setting");
    const copy = create("div", "fluxion-setting-copy");
    const label = create("b", "", title);
    const help = create("small", "", description);
    const identity = `fluxion-setting-${++settingRowId}`;
    label.id = `${identity}-label`;
    help.id = `${identity}-description`;
    copy.append(label, help);
    const tag = (control.localName || control.tagName || "").toLowerCase();
    const field = tag === "label" ? control.querySelector("input") : control;
    if (field) {
      const fieldTag = (field.localName || field.tagName || "").toLowerCase();
      // Action buttons keep their precise visible/explicit action names. Field
      // labels identify the setting, rather than announcing only "Enabled".
      if (!["button", "a"].includes(fieldTag) &&
          !field.hasAttribute("aria-label") && !field.hasAttribute("aria-labelledby")) {
        field.setAttribute("aria-labelledby", label.id);
      }
      const descriptions = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      descriptions.add(help.id);
      field.setAttribute("aria-describedby", [...descriptions].join(" "));
      if (!["input", "select", "textarea", "button", "a"].includes(fieldTag) && !field.hasAttribute("role")) {
        field.setAttribute("role", "group");
      }
    }
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
  const startupChoice = row(general, "When Fluxion starts", "Choose whether to begin fresh or restore your previous windows and tabs.", select([
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
  let homepageDraft = false;
  homepage.addEventListener("input", () => { homepageDraft = true; });
  homepage.addEventListener("change", () => {
    homepage.value = FluxionSettings.homepage(homepage.value);
    homepageDraft = false;
    pref.setString("browser.startup.homepage", homepage.value === "about:newtab"
      ? pref.string("fluxion.newtab.url", "about:newtab") : homepage.value);
  });
  row(general, "Home page", "Use a web address, about:newtab, or about:blank.", homepage);
  const linksChoice = row(general, "Open links in tabs", "Keep links from other applications in the current Fluxion window.", toggle("Enabled", pref.int("browser.link.open_newwindow", 3) !== 2, checked => {
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
      await window.FluxionWebSearch?.refresh();
      setNote(`Default search engine changed to ${engine.name}.`, "general");
    });
  }).catch(error => {
    searchEngine.replaceChildren(create("option", "", "Search engines unavailable"));
    setNote(`Could not load search engines: ${error.message}`, "general");
  });

  const appearance = section("appearance", "Appearance", "Choose your theme, sidebar size, tab spacing, and motion preferences.");
  const themeOptions = [
    ["system", "Follow system"], ["light", "Light"], ["dark", "Dark"],
  ];
  if (window.FluxionTheme.current() === "custom") {
    themeOptions.push(["custom", "Extension theme"]);
  }
  const themeChoice = select(themeOptions, window.FluxionTheme.current(), async value => {
    if (value === "custom") return;
    themeChoice.disabled = true;
    try {
      const applied = await window.FluxionTheme.set(value);
      themeChoice.value = applied;
      setNote(
        applied === "system" ? "Appearance now follows the system." : `${applied === "dark" ? "Dark" : "Light"} appearance enabled.`,
        "appearance",
      );
    } catch (error) {
      themeChoice.value = window.FluxionTheme.current();
      setNote(`Appearance could not be changed: ${error.message}`, "appearance");
    } finally { themeChoice.disabled = false; }
  });
  themeChoice.id = "fluxion-theme-choice";
  themeChoice.querySelector('option[value="custom"]')?.setAttribute("disabled", "true");
  row(appearance, "Theme", "Follow macOS automatically or choose a persistent light or dark Gecko theme.", themeChoice);
  const syncThemeChoice = event => {
    const value = event.detail?.choice || window.FluxionTheme.current();
    if (value === "custom" && !themeChoice.querySelector('option[value="custom"]')) {
      const option = create("option", "", "Extension theme");
      option.value = "custom";
      option.disabled = true;
      themeChoice.appendChild(option);
    }
    themeChoice.value = value;
  };
  window.addEventListener("FluxionThemeChanged", syncThemeChoice);
  const sidebarChoice = row(appearance, "Flow sidebar", "Expanded shows titles; compact keeps the rail; focus leaves a reveal edge.", select([
    ["expanded", "Expanded"], ["compact", "Compact"], ["focus", "Focus"],
  ], FluxionSettings.normaliseSidebar(pref.string("fluxion.sidebar.state", "expanded")), value => {
    window.FluxionUI.setSidebarState(value);
  }));
  const widthService = window.FluxionSidebarWidth;
  const widthBounds = widthService?.bounds || { min: 180, max: 420, default: 232 };
  const widthControls = create("div", "fluxion-settings-actions");
  widthControls.id = "fluxion-sidebar-width-controls";
  const widthChoice = create("input", "fluxion-settings-control");
  widthChoice.id = "fluxion-sidebar-width-choice";
  widthChoice.type = "number";
  widthChoice.min = String(widthBounds.min);
  widthChoice.max = String(widthBounds.max);
  widthChoice.step = "1";
  widthChoice.setAttribute("aria-label", "Sidebar width");
  const widthReset = create("button", "fluxion-settings-button", "Reset");
  widthReset.id = "fluxion-sidebar-width-reset";
  widthReset.type = "button";
  widthReset.setAttribute("aria-label", `Reset sidebar width to ${widthBounds.default} pixels`);
  widthChoice.disabled = widthReset.disabled = !widthService;
  widthControls.append(widthChoice, widthReset);
  row(appearance, "Sidebar width", `Expanded Flow width in pixels (${widthBounds.min}–${widthBounds.max}). Narrow windows may display a smaller width.`, widthControls);
  widthChoice.setAttribute("aria-describedby", widthControls.getAttribute("aria-describedby"));
  let widthDraft = false;
  function syncSidebarWidth() {
    if (!widthDraft) widthChoice.value = String(widthService?.preferredWidth() ?? widthBounds.default);
  }
  widthChoice.addEventListener("input", () => { widthDraft = true; });
  widthChoice.addEventListener("change", () => {
    const raw = widthChoice.value.trim(), value = Number(raw);
    widthDraft = false;
    if (!raw || !Number.isInteger(value) || value < widthBounds.min || value > widthBounds.max || widthChoice.validity?.badInput) {
      syncSidebarWidth();
      setNote(`Enter a whole number from ${widthBounds.min} to ${widthBounds.max} pixels.`, "appearance");
      return;
    }
    try {
      widthService.setWidth(value);
      setNote("Sidebar width saved.", "appearance");
    }
    catch (error) { setNote(`Sidebar width could not be saved: ${error.message}`, "appearance"); }
    syncSidebarWidth();
  });
  widthChoice.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    widthDraft = false;
    syncSidebarWidth();
  });
  widthReset.addEventListener("click", () => {
    widthDraft = false;
    try {
      widthService.resetWidth();
      setNote(`Sidebar width reset to ${widthBounds.default} pixels.`, "appearance");
    }
    catch (error) { setNote(`Sidebar width could not be reset: ${error.message}`, "appearance"); }
    syncSidebarWidth();
  });
  const densityChoice = row(appearance, "Tab density", "Adjust the vertical rhythm of tabs in Flow.", select([
    ["compact", "Compact"], ["standard", "Standard"], ["roomy", "Roomy"],
  ], FluxionSettings.normaliseDensity(pref.string("fluxion.tabs.density", "standard")), value => {
    window.FluxionUI.setTabDensity(value);
  }));
  const motionChoice = row(appearance, "Interface motion", "Short transitions remain disabled when macOS Reduce Motion is active.", toggle("Enabled", pref.bool("fluxion.animations.enabled", true), checked => {
    pref.setBool("fluxion.animations.enabled", checked);
    document.documentElement.toggleAttribute("data-fluxion-no-motion", !checked);
  }));

  const livePreferenceNames = ["browser.startup.page", "browser.startup.homepage", "fluxion.newtab.url",
    "browser.link.open_newwindow", "fluxion.sidebar.state", "fluxion.sidebar.width", "fluxion.tabs.density", "fluxion.animations.enabled"];
  const lastDisplayed = new WeakMap();
  let livePreferencesDisposed = false;
  function syncChoice(control, value) {
    value = String(value);
    // A focused native select can have a pending user selection. Do not replace
    // it with another window's value before its change event commits the choice.
    if (document.activeElement === control && lastDisplayed.has(control) &&
        control.value !== lastDisplayed.get(control) && control.value !== value) return;
    control.value = value;
    lastDisplayed.set(control, value);
  }
  function syncLivePreferences() {
    if (livePreferencesDisposed) return;
    syncChoice(startupChoice, FluxionSettings.startupPage(pref.int("browser.startup.page", 1)));
    syncChoice(sidebarChoice, FluxionSettings.normaliseSidebar(pref.string("fluxion.sidebar.state", "expanded")));
    syncSidebarWidth();
    syncChoice(densityChoice, FluxionSettings.normaliseDensity(pref.string("fluxion.tabs.density", "standard")));
    linksChoice.querySelector("input").checked = pref.int("browser.link.open_newwindow", 3) !== 2;
    motionChoice.querySelector("input").checked = pref.bool("fluxion.animations.enabled", true);
    if (!homepageDraft) {
      const value = pref.string("browser.startup.homepage", "about:newtab");
      homepage.value = value === pref.string("fluxion.newtab.url", "") ? "about:newtab" : value;
    }
  }
  const livePreferenceObserver = { observe: syncLivePreferences };
  for (const name of livePreferenceNames) Services.prefs.addObserver(name, livePreferenceObserver);
  for (const choice of [startupChoice, sidebarChoice, densityChoice]) choice.addEventListener("blur", syncLivePreferences);
  syncLivePreferences();

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

  const workspacePanel = section(
    "workspaces", "Workspaces",
    "Organise separate sets of tabs. Workspace names, order, symbols, and colours are saved across launches.",
  );
  const workspaceCreate = create("form", "fluxion-workspace-create");
  const workspaceName = create("input", "fluxion-settings-control");
  workspaceName.type = "text";
  workspaceName.maxLength = 32;
  workspaceName.placeholder = "New workspace name";
  workspaceName.setAttribute("aria-label", "New workspace name");
  const workspaceAdd = create("button", "fluxion-settings-button", "Add");
  workspaceAdd.type = "submit";
  workspaceCreate.append(workspaceName, workspaceAdd);
  const workspaceSummary = create("div", "fluxion-workspace-summary");
  const workspaceCount = create("span");
  const workspaceCurrent = create("span");
  workspaceSummary.append(workspaceCount, workspaceCurrent);
  const workspaceList = create("div", "fluxion-settings-workspace-list");
  workspaceList.setAttribute("role", "list");
  workspacePanel.append(workspaceCreate, workspaceSummary, workspaceList);

  const workspaceAccents = new Map([
    ["slate", "#68747b"], ["blue", "#51748a"], ["ochre", "#92794d"],
    ["sage", "#667c69"], ["rose", "#8b646b"],
  ]);
  function workspaceMark(icon, accent) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fluxion-settings-workspace-mark");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.style.setProperty("--workspace-accent", workspaceAccents.get(accent) || workspaceAccents.get("slate"));
    const addShape = (tag, attributes) => {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    };
    const stroke = { stroke: "currentColor", "stroke-width": "1.2" };
    if (icon === "diamond") {
      addShape("path", { d: "M6 1.5 10.5 6 6 10.5 1.5 6Z", ...stroke });
    } else if (icon === "square") {
      addShape("rect", { x: "1.75", y: "1.75", width: "8.5", height: "8.5", rx: ".6", ...stroke });
    } else if (icon === "arc") {
      addShape("path", { d: "M2 8.5a4.5 4.5 0 0 1 8 0", "stroke-linecap": "round", ...stroke });
    } else if (icon === "grid") {
      for (const [x, y] of [[2, 2], [7, 2], [2, 7], [7, 7]]) {
        addShape("rect", { x: String(x), y: String(y), width: "3", height: "3", rx: ".35", ...stroke });
      }
    } else {
      addShape("circle", { cx: "6", cy: "6", r: "4.25", ...stroke });
    }
    return svg;
  }

  const workspaceEditor = FluxionWorkspaceEditor.attach(workspaceList, {
    create, select, mark: workspaceMark, scrollContainer: main,
    update: (id, changes) => window.FluxionUI.updateWorkspace(id, changes),
    move: (id, direction) => window.FluxionUI.moveWorkspace(id, direction),
    remove: id => window.FluxionUI.deleteWorkspace(id),
    note: message => setNote(message, "workspaces"),
  });
  renderWorkspaces = () => {
    const items = window.FluxionUI.workspaces();
    const currentId = window.FluxionUI.currentWorkspace();
    workspaceCount.textContent = `${items.length} of ${FluxionWorkspaces.MAX_WORKSPACES}`;
    workspaceCurrent.textContent = `Current: ${items.find(item => item.id === currentId)?.name || "Workspace"}`;
    workspaceAdd.disabled = items.length >= FluxionWorkspaces.MAX_WORKSPACES;
    workspaceName.disabled = workspaceAdd.disabled;
    workspaceEditor.sync(items, currentId);
  };
  workspaceCreate.addEventListener("submit", event => {
    event.preventDefault();
    const created = window.FluxionUI.createWorkspace(workspaceName.value, { activate: false });
    if (!created) {
      setNote(
        window.FluxionUI.workspaces().length >= FluxionWorkspaces.MAX_WORKSPACES
          ? `Fluxion supports up to ${FluxionWorkspaces.MAX_WORKSPACES} workspaces.`
          : "Enter a workspace name.",
        "workspaces",
      );
      return;
    }
    workspaceName.value = "";
    setNote(`${created.name} created.`, "workspaces");
    workspaceList.querySelector(`[data-workspace-id="${CSS.escape(created.id)}"] input`)?.focus();
  });
  const syncWorkspaceSettings = () => renderWorkspaces();
  window.addEventListener("FluxionWorkspacesChanged", syncWorkspaceSettings);
  renderWorkspaces();

  const search = section("search", "Search & Memory", "Browser Memory is local, optional, and never runs in private windows.");
  let exclusionEditor = null;
  const readExclusionPolicy = () => window.FluxionMemory?.exclusionPolicy?.() || null;
  const directDomains = () => readExclusionPolicy()?.directDomains || window.FluxionMemory?.excludedDomains() || [];
  const policyLocked = () => { const policy = readExclusionPolicy(); return policy && (!policy.valid || policy.readOnly); };
  let memoryPending = false, embeddingPending = false, domainsPending = false;
  const memoryToggle = toggle("Enabled", Boolean(window.FluxionMemory?.enabled()), async checked => {
    if (policyLocked() || memoryPending) { syncMemorySettings(); return; }
    memoryPending = true;
    memoryToggle.querySelector("input").disabled = true;
    try {
      const capability = checked ? await window.FluxionMemory.enable() : null;
      if (!checked) await window.FluxionMemory.clearAndDisable();
      setNote(
        checked
          ? capability === "lexical"
            ? "Browser Memory enabled in Keywords only mode. No embedding model or vectors are used."
            : "Browser Memory enabled. Semantic indexing runs locally in the background."
          : "Browser Memory disabled and its local data cleared.",
        "search",
      );
    } catch (error) {
      setNote(`Could not update Browser Memory: ${error.message}`, "search");
    } finally {
      memoryToggle.querySelector("input").checked = Boolean(window.FluxionMemory?.enabled());
      memoryPending = false;
      syncMemorySettings();
    }
  });
  row(search, "Browser Memory", "Keep searchable non-private history and bounded page evidence on this Mac.", memoryToggle);
  memoryToggle.querySelector("input").id = "fluxion-memory-enabled";
  let embeddingChoiceTask = Promise.resolve("gecko-local");
  const embeddingChoice = select([
    ["gecko-local", "Gecko on-device semantic"],
    ["disabled", "Keywords only"],
  ], window.FluxionMemory?.embeddingProvider() || "gecko-local", value => {
    embeddingChoiceTask = applyEmbeddingChoice(value);
    // Keep the task rejectable for callers while handling DOM-dispatched errors.
    embeddingChoiceTask.catch(Cu.reportError);
  });
  async function applyEmbeddingChoice(value) {
    if (policyLocked() || embeddingPending) { syncMemorySettings(); return window.FluxionMemory?.embeddingProvider(); }
    embeddingPending = true;
    embeddingChoice.disabled = true;
    try {
      const saved = await window.FluxionMemory.setEmbeddingProvider(value);
      embeddingChoice.value = saved;
      setNote(
        saved === "disabled"
          ? "Embeddings disabled. Existing vectors were deleted; local titles and page evidence remain searchable."
          : "Gecko on-device semantic search enabled. No browsing data is sent to a model provider.",
        "search",
      );
      return saved;
    } catch (error) {
      embeddingChoice.value = window.FluxionMemory?.embeddingProvider() || "gecko-local";
      setNote(`Could not change embedding mode: ${error.message}`, "search");
      throw error;
    } finally {
      embeddingPending = false;
      syncMemorySettings();
    }
  }
  embeddingChoice.id = "fluxion-memory-embedding-provider";
  row(
    search,
    "Embedding mode",
    "Keep lexical Browser Memory while independently disabling model execution and vector storage.",
    embeddingChoice,
  );
  const syncEmbeddingChoice = () => {
    syncMemorySettings();
  };
  window.addEventListener("FluxionMemoryEmbeddingProviderChanged", syncEmbeddingChoice);
  const domains = create("input");
  domains.id = "fluxion-memory-excluded-domains";
  domains.type = "text";
  domains.placeholder = "example.com, private.example";
  domains.value = directDomains().join(", ");
  let domainsRevision = readExclusionPolicy()?.revision;
  let domainsDirty = false;
  domains.addEventListener("input", () => { domainsDirty = true; });
  domains.addEventListener("change", async () => {
    if (policyLocked() || domainsPending) return;
    const next = FluxionSettings.excludedDomains(domains.value);
    domainsPending = true;
    domains.disabled = true;
    try {
      const saved = await window.FluxionMemory.setExcludedDomains(next, domainsRevision);
      domains.value = saved.join(", ");
      domainsDirty = false;
      setNote("Browser Memory exclusions saved.", "search");
    } catch (error) {
      domainsDirty = Boolean(readExclusionPolicy());
      if (!domainsDirty) domains.value = directDomains().join(", ");
      setNote(`Could not finish removing excluded data: ${error.message}${domainsDirty ? " The policy may already be saved even if cleanup did not finish. Your draft is retained. Cancel domain changes to reload saved exclusions." : ""}`, "search");
    } finally {
      domainsPending = false;
      syncMemorySettings();
    }
  });
  domains.addEventListener("blur", () => {
    if (!domainsDirty) syncMemorySettings();
  });
  const memoryPreferenceNames = ["fluxion.memory.enabled", "fluxion.memory.embeddingProvider", "fluxion.memory.excludedDomains", "fluxion.memory.exclusionPolicy"];
  function syncMemorySettings() {
    const locked = Boolean(policyLocked());
    memoryToggle.querySelector("input").checked = Boolean(window.FluxionMemory?.enabled());
    memoryToggle.querySelector("input").disabled = locked || memoryPending;
    embeddingChoice.disabled = locked || embeddingPending;
    domains.disabled = locked || domainsPending;
    if (!embeddingPending) embeddingChoice.value = window.FluxionMemory?.embeddingProvider() || "gecko-local";
    if (!domainsPending && !domainsDirty) {
      domains.value = directDomains().join(", ");
      domainsRevision = readExclusionPolicy()?.revision;
    }
    exclusionEditor?.sync();
  }
  const memoryPreferenceObserver = { observe: syncMemorySettings };
  for (const name of memoryPreferenceNames) Services.prefs.addObserver(name, memoryPreferenceObserver);
  row(search, "Excluded domains", "Direct exclusions include subdomains and share the 200-entry limit with all lists. Matching Browser Memory data is removed; ordinary history is kept.", domains);
  if (window.FluxionMemory?.exclusionPolicy) {
    const cancelDomains = create("button", "fluxion-settings-button", "Cancel domain changes");
    cancelDomains.type = "button";
    cancelDomains.addEventListener("click", () => { if (!domainsPending) { domainsDirty = false; syncMemorySettings(); } });
    search.appendChild(cancelDomains);
    exclusionEditor = createExclusionLists(search);
  }
  const clearMemory = create("button", "fluxion-settings-button danger", "Clear Browser Memory");
  clearMemory.type = "button";
  clearMemory.addEventListener("click", async () => {
    if (readExclusionPolicy()?.readOnly) return;
    if (!Services.prompt.confirm(window, "Clear Browser Memory", "Delete local Browser Memory evidence and vectors, then turn the feature off?")) return;
    clearMemory.disabled = true;
    try {
      await window.FluxionMemory.clearAndDisable();
      setNote("Browser Memory was cleared.", "search");
    } catch (error) {
      setNote(`Could not finish clearing Browser Memory: ${error.message}`, "search");
    } finally {
      memoryToggle.querySelector("input").checked = Boolean(window.FluxionMemory?.enabled());
      clearMemory.disabled = false;
    }
  });
  row(search, "Delete Browser Memory data", "This does not delete ordinary Gecko browsing history.", clearMemory);
  clearMemory.disabled = Boolean(readExclusionPolicy()?.readOnly);
  syncMemorySettings();

  function createExclusionLists(panel) {
    const container = create("div", "fluxion-memory-lists");
    container.id = "fluxion-memory-exclusion-lists";
    const title = create("h3", "", "User-defined exclusion lists");
    const help = create("p", "fluxion-settings-note",
      "Name your own collections of domains. Enabled lists apply alongside direct exclusions. This is not automatic website classification. Up to 20 lists and 200 domain entries across direct exclusions and all lists, including disabled lists.");
    const status = create("p", "fluxion-settings-note");
    status.setAttribute("role", "status");
    const list = create("div");
    const add = create("button", "fluxion-settings-button", "New exclusion list");
    const recover = create("button", "fluxion-settings-button danger", "Reset exclusion policy");
    add.type = recover.type = "button";
    container.append(title, help, status, list, add, recover);
    panel.appendChild(container);
    const records = new Map();
    let busy = false, disposed = false, sequence = 0, recoveryError = "", lastPolicyValid = null;
    const editable = snapshot => snapshot?.valid && !snapshot.readOnly && !busy && !disposed;
    const controls = record => [record.name, record.domains, record.enabled, record.save, record.cancel, record.remove];
    function makeRecord(key) {
      const node = create("details", "fluxion-memory-list");
      node.dataset.exclusionListId = key;
      const summary = create("summary");
      const fields = create("div", "fluxion-memory-list-fields");
      const name = create("input", "fluxion-settings-control");
      name.type = "text"; name.maxLength = 40;
      const values = create("textarea");
      values.rows = 3; values.maxLength = 64000;
      const enabled = create("input"); enabled.type = "checkbox";
      const note = create("p", "fluxion-settings-note"); note.setAttribute("role", "status");
      note.id = `fluxion-exclusion-list-note-${++sequence}`;
      for (const [caption, control] of [["List name", name], ["Domains (comma or line separated)", values], ["Enable this list", enabled]]) {
        const label = create("label", "", caption);
        control.setAttribute("aria-label", caption);
        control.setAttribute("aria-describedby", note.id);
        label.appendChild(control); fields.appendChild(label);
      }
      const actions = create("div", "fluxion-memory-list-actions");
      const save = create("button", "fluxion-settings-button", "Save list");
      const cancel = create("button", "fluxion-settings-button", "Cancel changes");
      const remove = create("button", "fluxion-settings-button danger", "Remove list");
      for (const button of [save, cancel, remove]) button.type = "button";
      actions.append(save, cancel, remove); fields.append(note, actions); node.append(summary, fields);
      const record = { node, summary, name, domains: values, enabled, note, save, cancel, remove,
        id: key === "new" ? null : key, dirty: key === "new", revision: readExclusionPolicy().revision };
      const markDirty = () => { if (!record.dirty) record.revision = readExclusionPolicy().revision; record.dirty = true; };
      name.addEventListener("input", markDirty); values.addEventListener("input", markDirty); enabled.addEventListener("change", markDirty);
      save.addEventListener("click", async () => {
        if (!editable(readExclusionPolicy())) return;
        if (record.id && !readExclusionPolicy().lists.some(item => item.id === record.id)) return;
        if (!name.value.trim()) { note.textContent = "Enter a list name (1–40 characters)."; name.focus(); return; }
        const previousIds = new Set(readExclusionPolicy().lists.map(item => item.id));
        busy = true; sync();
        try {
          const result = await window.FluxionMemory.saveExclusionList({ ...(record.id ? { id: record.id } : {}),
            name: name.value, enabled: enabled.checked, domains: FluxionSettings.excludedDomains(values.value) }, record.revision);
          if (disposed) return;
          record.dirty = false;
          if (!record.id) {
            const created = result.lists.find(item => !previousIds.has(item.id));
            if (created) {
              records.get(created.id)?.node.remove();
              records.delete("new"); record.id = created.id;
              node.dataset.exclusionListId = created.id; records.set(created.id, record);
            }
          }
          status.textContent = "Exclusion list saved. Ordinary browsing history is unchanged.";
          note.textContent = "Saved.";
        } catch (error) { if (!disposed) note.textContent = `${error.message} The policy may already be saved even if cleanup did not finish. Your draft is retained; Cancel changes reloads the saved policy.`; }
        finally { busy = false; if (!disposed) sync(); }
      });
      cancel.addEventListener("click", () => {
        if (busy || disposed) return;
        const ownsFocus = node.contains(document.activeElement);
        record.dirty = false; note.textContent = "";
        if (!record.id || !readExclusionPolicy().lists.some(item => item.id === record.id)) {
          node.remove(); records.delete(record.id || "new"); if (ownsFocus) add.focus();
        }
        sync();
      });
      remove.addEventListener("click", async () => {
        const snapshot = readExclusionPolicy();
        if (!record.id || !editable(snapshot) || !snapshot.lists.some(item => item.id === record.id)) return;
        if (!Services.prompt.confirm(window, "Remove exclusion list", `Remove “${name.value}”? These domains may enter Browser Memory again unless excluded elsewhere.`)) return;
        busy = true; sync();
        try {
          await window.FluxionMemory.deleteExclusionList(record.id, record.revision);
          if (disposed) return;
          const ownsFocus = node.contains(document.activeElement);
          node.remove(); records.delete(record.id); status.textContent = "Exclusion list removed.";
          if (ownsFocus) add.focus();
        } catch (error) { if (!disposed) status.textContent = `${error.message} The policy may already be saved even if cleanup did not finish. Reloaded lists reflect the saved policy.`; }
        finally { busy = false; if (!disposed) sync(); }
      });
      records.set(key, record); list.appendChild(node); return record;
    }
    function sync() {
      if (disposed) return;
      const snapshot = readExclusionPolicy();
      const canEdit = editable(snapshot);
      if (!snapshot.valid) status.textContent = `${recoveryError ? `${recoveryError} ` : ""}Exclusion policy cannot be read: ${snapshot.error || "invalid data"}. Memory and page AI remain blocked. Reset explicitly to recover.`;
      else if (snapshot.readOnly) status.textContent = "Exclusion lists are read-only in private windows.";
      else if (lastPolicyValid === false) { status.textContent = "Saved exclusion policy reloaded."; recoveryError = ""; }
      lastPolicyValid = snapshot.valid;
      recover.hidden = snapshot.valid;
      recover.disabled = snapshot.readOnly || busy;
      add.disabled = !canEdit || snapshot.lists.length >= 20 || records.has("new");
      for (const saved of snapshot.lists) {
        const record = records.get(saved.id) || makeRecord(saved.id);
        record.summary.textContent = `${saved.name} · ${saved.enabled ? "Enabled" : "Disabled"} · ${saved.domains.length} domains`;
        if (!record.dirty) {
          record.name.value = saved.name; record.domains.value = saved.domains.join(", ");
          record.enabled.checked = saved.enabled; record.revision = snapshot.revision;
        } else if (record.revision !== snapshot.revision && !busy) {
          record.note.textContent = "The policy changed in another window. Your draft is retained; Cancel changes reloads the saved policy.";
        }
      }
      for (const [key, record] of records) {
        const exists = snapshot.lists.some(item => item.id === record.id);
        if (record.id && !exists && !record.dirty) {
          const ownsFocus = record.node.contains(document.activeElement);
          record.node.remove(); records.delete(key);
          if (ownsFocus) add.focus();
          continue;
        }
        if (record.id && !exists) record.note.textContent = "This list was removed in another window. Cancel changes to dismiss your retained draft.";
        for (const control of controls(record)) control.disabled = !canEdit;
        record.cancel.disabled = busy;
        record.remove.hidden = !record.id;
        record.remove.disabled = !canEdit || !exists;
        record.save.disabled = !canEdit || Boolean(record.id && !exists);
      }
    }
    add.addEventListener("click", () => {
      if (!editable(readExclusionPolicy()) || records.has("new") || readExclusionPolicy().lists.length >= 20) return;
      const record = makeRecord("new"); record.summary.textContent = "New exclusion list";
      record.name.value = ""; record.domains.value = ""; record.enabled.checked = true;
      record.node.open = true; sync(); record.name.focus();
    });
    recover.addEventListener("click", async () => {
      const snapshot = readExclusionPolicy();
      if (snapshot.valid || snapshot.readOnly || busy) return;
      if (!Services.prompt.confirm(window, "Reset exclusion policy", "Replace the unreadable exclusion policy with an empty policy? All saved direct exclusions and lists will be removed. Previously enabled Browser Memory and page AI can become available immediately, with no user-defined domain exclusions.")) return;
      recoveryError = "";
      busy = true; sync();
      try { await window.FluxionMemory.resetExclusionPolicy(snapshot.revision); if (!disposed) status.textContent = "Exclusion policy reset to empty. Previously enabled Browser Memory and page AI can now resume with no user-defined domain exclusions."; }
      catch (error) { if (!disposed) { recoveryError = `Could not finish resetting exclusion policy: ${error.message}. The empty policy may already be saved even if cleanup did not finish.`; status.textContent = recoveryError; } }
      finally { busy = false; if (!disposed) sync(); }
    });
    sync();
    return { sync, destroy() { disposed = true; } };
  }

  const ai = section("ai", "AI", "Optional page tools. Ordinary browsing and Browser Memory remain fully functional when AI is disabled.");
  const initialAI = window.FluxionAI.config();
  let aiMutationPending = false;
  let aiTestPending = false;
  let aiDisposed = false;
  let aiSettingsRevision = 0;
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
  aiKey.placeholder = "Leave blank to keep this endpoint’s saved key";
  row(ai, "API key", "Stored in Firefox’s encrypted login store, never in Fluxion preferences or source code.", aiKey);
  aiProvider.addEventListener("change", () => {
    if (aiMutationPending || aiDisposed) return;
    const defaults = FluxionAIProviders.DEFAULTS[aiProvider.value];
    aiEndpoint.disabled = aiProvider.value === "disabled";
    aiModel.disabled = aiProvider.value === "disabled";
    aiKey.disabled = aiProvider.value !== "openai-compatible";
    if (defaults && aiProvider.value !== initialAI.provider) {
      aiEndpoint.value = defaults.endpoint;
      aiModel.value = defaults.model;
    }
    syncAIControls();
  });
  const saveAI = create("button", "fluxion-settings-button", "Save provider");
  saveAI.type = "button";
  saveAI.addEventListener("click", async () => {
    if (aiMutationPending || aiDisposed) return;
    aiSettingsRevision += 1;
    aiMutationPending = true;
    syncAIControls();
    try {
      await window.FluxionAI.configure({
        provider: aiProvider.value,
        endpoint: aiEndpoint.value,
        model: aiModel.value,
        ...(aiKey.value ? { secret: aiKey.value } : {}),
      });
      if (aiDisposed) return;
      const current = window.FluxionAI.config();
      aiProvider.value = current.provider;
      aiEndpoint.value = current.endpoint;
      aiModel.value = current.model;
      aiKey.value = "";
      setNote(current.provider === "disabled" ? "AI disabled." : `Saved ${current.provider} provider.`, "ai");
    } catch (error) {
      if (!aiDisposed) setNote(error.message, "ai");
    } finally { aiMutationPending = false; syncAIControls(); }
  });
  row(ai, "Save connection", "Provider changes apply immediately without restarting Fluxion.", saveAI);
  const aiActions = create("div", "fluxion-settings-actions");
  const testAI = create("button", "fluxion-settings-button", "Test connection");
  testAI.type = "button";
  testAI.addEventListener("click", async () => {
    if (aiMutationPending || aiTestPending || aiDisposed) return;
    aiTestPending = true;
    const revision = aiSettingsRevision;
    const configuration = JSON.stringify(window.FluxionAI.config());
    const isCurrent = () => !aiDisposed && revision === aiSettingsRevision &&
      configuration === JSON.stringify(window.FluxionAI.config());
    syncAIControls();
    try {
      const result = await window.FluxionAI.testConnection();
      if (isCurrent()) setNote(result.detail, "ai");
    } catch (error) { if (isCurrent()) setNote(error.message, "ai"); }
    finally { aiTestPending = false; syncAIControls(); }
  });
  const clearAIKey = create("button", "fluxion-settings-button danger", "Clear saved key");
  clearAIKey.setAttribute("aria-label", "Clear this endpoint’s saved API key");
  clearAIKey.title = "Clear this endpoint’s saved API key";
  clearAIKey.type = "button";
  clearAIKey.addEventListener("click", async () => {
    syncAIControls();
    if (clearAIKey.disabled || aiDisposed) return;
    aiSettingsRevision += 1;
    const expectedEndpoint = window.FluxionAI.config().endpoint;
    aiMutationPending = true;
    syncAIControls();
    try {
      await window.FluxionAI.setSecret("", { expectedEndpoint });
      if (!aiDisposed) setNote("This endpoint’s saved API key was removed. Other endpoint keys are unchanged.", "ai");
    } catch (error) {
      if (!aiDisposed) setNote(`Could not clear this endpoint’s key: ${error.message}`, "ai");
    } finally { aiMutationPending = false; syncAIControls(); }
  });
  function syncAIControls() {
    if (aiDisposed) return;
    const saved = window.FluxionAI.config();
    aiProvider.disabled = aiMutationPending;
    aiEndpoint.disabled = aiMutationPending || aiProvider.value === "disabled";
    aiModel.disabled = aiMutationPending || aiProvider.value === "disabled";
    aiKey.disabled = aiMutationPending || aiProvider.value !== "openai-compatible";
    saveAI.disabled = aiMutationPending;
    testAI.disabled = aiMutationPending || aiTestPending || saved.provider === "disabled" || !saved.endpoint;
    clearAIKey.disabled = aiMutationPending || saved.provider === "disabled" || !saved.endpoint ||
      aiProvider.value !== saved.provider || aiEndpoint.value !== saved.endpoint || Boolean(aiKey.value);
  }
  for (const field of [aiEndpoint, aiModel, aiKey]) field.addEventListener("input", syncAIControls);
  const aiPreferenceObserver = { observe() { aiSettingsRevision += 1; syncAIControls(); } };
  Services.prefs.addObserver("fluxion.ai.", aiPreferenceObserver);
  syncAIControls();
  aiActions.append(testAI, clearAIKey);
  row(ai, "Connection tools", "Tests the configured model service without sharing a webpage.", aiActions);

  const privacy = section("privacy", "Privacy", "Manage locally stored browsing data using Gecko’s mature security services.");
  const clearBrowsingData = create("button", "fluxion-settings-button danger", "Choose what to clear…");
  clearBrowsingData.type = "button";
  clearBrowsingData.addEventListener("click", async () => {
    clearBrowsingData.disabled = true;
    try {
      const result = await window.FluxionDataClearing.open();
      setNote(result === "accept" ? "Selected browsing data cleared." : "Browsing data was not changed.");
    } catch (error) {
      setNote(`Browsing data could not be cleared: ${error.message}`);
    } finally { clearBrowsingData.disabled = false; }
  });
  row(
    privacy,
    "Browsing data",
    "Choose history, downloads, form entries, cookies, cache, active logins, and site settings through Gecko’s native clearing controls.",
    clearBrowsingData,
  );
  const clearSiteData = create("button", "fluxion-settings-button danger", "Clear site data…");
  clearSiteData.type = "button";
  clearSiteData.addEventListener("click", async () => {
    clearSiteData.disabled = true;
    try {
      const result = await window.FluxionDataClearing.openSiteData();
      setNote(result === "accept" ? "Selected cookies and site data cleared." : "Site data was not changed.");
    } catch (error) {
      setNote(`Site data could not be cleared: ${error.message}`);
    } finally { clearSiteData.disabled = false; }
  });
  row(privacy, "Cookies and site data", "Review stored site data before clearing it; accepting may sign you out of websites.", clearSiteData);
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
      resetSite.setAttribute("aria-label", `Reset all saved permissions for ${group.origin} (${group.context})`);
      resetSite.addEventListener("click", () => {
        if (!Services.prompt.confirm(
          window, "Reset Site Permissions",
          `Remove all saved permission decisions for ${group.origin} (${group.context})?`,
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
        reset.setAttribute("aria-label", `Reset ${permission.typeLabel} for ${permission.origin} (${permission.context})`);
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
    for (const [id, button] of shortcutButtons) {
      if (button.dataset.capturing !== "true") button.textContent = window.FluxionShortcuts.format(id);
    }
  }
  window.addEventListener("FluxionShortcutsChanged", refreshShortcutButtons);
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
      window.FluxionShortcuts.endCapture(key);
      key.dataset.capturing = "false";
      key.textContent = window.FluxionShortcuts.format(action.id) || beforeCapture;
    };
    key.addEventListener("click", () => {
      if (!window.FluxionShortcuts.beginCapture(key)) return;
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
  const geckoVersion = Services.appinfo.platformVersion;
  const geckoBuildID = Services.appinfo.platformBuildID;
  row(about, "Engine", `Mozilla Gecko ${geckoVersion}`, create("div", "fluxion-shortcut", `Build ${geckoBuildID}`));
  row(
    about, "Privacy",
    "Browser Memory is optional, local, and unavailable in private windows.",
    create("div", "fluxion-shortcut", "Local by default"),
  );
  const openAboutDestination = url => {
    const tab = gBrowser.addTrustedTab(url);
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
  };
  const source = create("button", "fluxion-settings-button", "Open source repository");
  source.type = "button";
  source.addEventListener("click", () => openAboutDestination(
    "https://github.com/Ninnja10563/Fluxion-Browser",
  ));
  row(about, "Source", "Fluxion is developed in public and Gecko components retain their original licenses.", source);
  const releases = create("button", "fluxion-settings-button", "All releases");
  releases.id = "fluxion-update-releases";
  releases.type = "button";
  releases.setAttribute("aria-label", "Open Fluxion releases");
  let availableUpdate = null;
  let updateDisposed = false;
  releases.addEventListener("click", () => openAboutDestination(
    availableUpdate?.releaseURL || "https://github.com/Ninnja10563/Fluxion-Browser/releases",
  ));
  const updateControls = create("div");
  const updateActions = create("div", "fluxion-settings-actions");
  const checkUpdate = create("button", "fluxion-settings-button", "Check now");
  checkUpdate.id = "fluxion-update-check";
  checkUpdate.type = "button";
  checkUpdate.setAttribute("aria-label", "Check for Fluxion updates");
  const downloadUpdate = create("button", "fluxion-settings-button", "Download macOS DMG");
  downloadUpdate.id = "fluxion-update-download";
  downloadUpdate.type = "button";
  downloadUpdate.hidden = true;
  downloadUpdate.addEventListener("click", () => {
    if (availableUpdate?.state === "available") openAboutDestination(availableUpdate.downloadURL);
  });
  const updateStatus = create("p", "fluxion-settings-note", `Installed ${PRODUCT_RELEASE}. Not checked.`);
  updateStatus.id = "fluxion-update-status";
  updateStatus.setAttribute("role", "status");
  updateStatus.dataset.state = "idle";
  updateStatus.dataset.installed = PRODUCT_RELEASE;
  checkUpdate.addEventListener("click", async () => {
    if (checkUpdate.disabled || updateDisposed) return;
    checkUpdate.disabled = true;
    availableUpdate = null;
    releases.textContent = "All releases";
    releases.setAttribute("aria-label", "Open Fluxion releases");
    downloadUpdate.hidden = true;
    updateStatus.dataset.state = "checking";
    delete updateStatus.dataset.latest;
    delete updateStatus.dataset.reason;
    delete updateStatus.dataset.retryAt;
    updateStatus.textContent = "Checking Fluxion releases on GitHub…";
    try {
      const { FluxionUpdates } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionUpdates.sys.mjs");
      const result = await FluxionUpdates.check(PRODUCT_RELEASE, Services.appinfo.OS);
      if (updateDisposed) return;
      updateStatus.dataset.state = result.state;
      if (result.latest) updateStatus.dataset.latest = result.latest;
      if (result.reason) {
        updateStatus.dataset.state = "error";
        updateStatus.dataset.reason = result.reason;
        const messages = {
          "rate-limit": "GitHub's request limit was reached. Try again later.",
          timeout: "The update check timed out. Try again when the connection is available.",
          "too-large": "The release list exceeded the safe response size. Open Fluxion releases to check manually.",
        };
        updateStatus.textContent = messages[result.reason] || "The release list could not be retrieved safely. Try again later or open Fluxion releases.";
        if (result.reason === "rate-limit" && Number.isFinite(result.retryAt)) {
          updateStatus.dataset.retryAt = String(result.retryAt);
          const refusal = result.status === 403 ? "GitHub temporarily refused this update check." : "GitHub's request limit was reached.";
          updateStatus.textContent = `${refusal} Check again after ${new Date(result.retryAt).toLocaleString()}. You can still open Fluxion releases.`;
        }
      } else if (result.state === "available") {
        availableUpdate = result;
        releases.textContent = "Release notes";
        releases.setAttribute("aria-label", `Open Fluxion ${result.latest} release notes`);
        downloadUpdate.hidden = false;
        updateStatus.textContent = `${result.latest} is available. Installed ${PRODUCT_RELEASE}. Download and installation require your action.`;
      } else if (result.state === "current") {
        updateStatus.textContent = `No newer compatible release found. Installed ${PRODUCT_RELEASE}; newest downloadable release ${result.latest}.`;
      } else if (result.state === "unsupported") {
        updateStatus.textContent = "Packaged update downloads are currently available for macOS only. You can still view Fluxion releases.";
      } else {
        updateStatus.textContent = "No compatible downloadable release was found in the recent release list. You can inspect Fluxion releases manually.";
      }
    } catch (error) {
      if (updateDisposed) return;
      updateStatus.dataset.state = "error";
      updateStatus.textContent = `Could not check for updates: ${error.message}. Try again later or open Fluxion releases.`;
    } finally {
      if (!updateDisposed) checkUpdate.disabled = false;
    }
  });
  updateActions.append(checkUpdate, releases);
  updateControls.append(updateActions, updateStatus, downloadUpdate);
  row(about, "Updates", "Checks GitHub only when requested. Automatic installation is not available in this preview.", updateControls);
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
      syncLivePreferences();
      syncMemorySettings();
      syncAIControls();
      const selectedBrowser = gBrowser.selectedBrowser;
      const spec = selectedBrowser.currentURI.spec;
      const remembered = tabSections.get(selectedBrowser);
      showSection(remembered?.spec === spec ? remembered.section : sectionFromLocation(spec));
      Services.prefs.setStringPref("fluxion.settings.visual.health", "settings-surface-visible");
      Services.prefs.savePrefFile(null);
    }
  }

  const progressListener = {
    onLocationChange(changedBrowser, webProgress) {
      if (changedBrowser === gBrowser.selectedBrowser && webProgress?.isTopLevel) syncVisibility();
    },
  };
  gBrowser.addTabsProgressListener(progressListener);
  gBrowser.tabContainer.addEventListener("TabSelect", syncVisibility);
  window.addEventListener("unload", () => {
    livePreferencesDisposed = true;
    for (const name of livePreferenceNames) Services.prefs.removeObserver(name, livePreferenceObserver);
    workspaceEditor.destroy();
    exclusionEditor?.destroy();
    aiDisposed = true;
    Services.prefs.removeObserver("fluxion.ai.", aiPreferenceObserver);
    updateDisposed = true;
    gBrowser.removeTabsProgressListener(progressListener);
    gBrowser.tabContainer.removeEventListener("TabSelect", syncVisibility);
    root.remove();
    style.remove();
    document.documentElement.removeAttribute("data-fluxion-settings-visible");
    window.removeEventListener("FluxionThemeChanged", syncThemeChoice);
    window.removeEventListener("FluxionWorkspacesChanged", syncWorkspaceSettings);
    window.removeEventListener("FluxionMemoryEmbeddingProviderChanged", syncEmbeddingChoice);
    for (const name of memoryPreferenceNames) Services.prefs.removeObserver(name, memoryPreferenceObserver);
    window.removeEventListener("FluxionShortcutsChanged", refreshShortcutButtons);
    unsubscribePermissions?.();
  }, { once: true });
  showSection("general", { remember: false });
  syncVisibility();
  Services.prefs.setStringPref("fluxion.settings.health", "live-preferences-loaded");
  Services.prefs.savePrefFile(null);
  if (Services.env.get("FLUXION_VISUAL_SETTINGS_TEST") === "1") {
    const tab = gBrowser.addTrustedTab("about:preferences");
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
    window.requestAnimationFrame(syncVisibility);
  }
  if (Services.env.get("FLUXION_VISUAL_EMBEDDING_SETTINGS_TEST") === "1") {
    window.addEventListener("FluxionMemoryVisualReady", async () => {
      const original = window.FluxionMemory.embeddingProvider();
      let verified = false;
      const choose = async provider => {
        embeddingChoice.value = provider;
        embeddingChoice.dispatchEvent(new window.Event("change", { bubbles: true }));
        return embeddingChoiceTask;
      };
      try {
        await choose("disabled");
        const vectorCounts = await window.FluxionMemory.embeddingVectorCounts();
        const recall = await window.FluxionMemory.search(
          "Example Domain",
          window.FluxionUI.currentWorkspace(),
        );
        const lexicalRecall = recall.state === "keyword-only" && recall.results.some(result =>
          result.url?.startsWith("https://example.com/"));
        const disabledExactly = window.FluxionMemory.embeddingProvider() === "disabled" &&
          Services.prefs.getStringPref("fluxion.memory.embeddingProvider", "") === "disabled" &&
          !Services.prefs.getBoolPref("browser.ml.enable", true) &&
          !Services.prefs.getBoolPref("places.semanticHistory.featureGate", true) &&
          vectorCounts.native === 0 && vectorCounts.enriched === 0 &&
          embeddingChoice.value === "disabled";
        await choose("gecko-local");
        const restoredExactly = window.FluxionMemory.embeddingProvider() === "gecko-local" &&
          Services.prefs.getBoolPref("browser.ml.enable", false) &&
          Services.prefs.getBoolPref("places.semanticHistory.featureGate", false) &&
          embeddingChoice.value === "gecko-local";
        if (lexicalRecall && disabledExactly && restoredExactly) {
          Services.prefs.setStringPref(
            "fluxion.memory.embeddingSettings.health",
            "keyword-mode-retained-recall-and-local-mode-restored",
          );
          verified = true;
        } else {
          throw new Error(
            `embedding settings gate failed lexical=${lexicalRecall} ` +
              `disabled=${disabledExactly} vectors=${vectorCounts.native}/${vectorCounts.enriched} ` +
              `restored=${restoredExactly}`,
          );
        }
      } catch (error) {
        Services.prefs.setStringPref("fluxion.memory.embeddingSettings.error", String(error));
        Cu.reportError(error);
      } finally {
        if (window.FluxionMemory.embeddingProvider() !== original) {
          try { await choose(original); } catch (_) { verified = false; }
        }
        Services.prefs.savePrefFile(null);
        if (verified) {
          window.dispatchEvent(new window.CustomEvent("FluxionMemoryEmbeddingSettingsVisualReady"));
        }
      }
    }, { once: true });
    window.addEventListener("FluxionScaleVisualReady", () => {
      const captureWorkspace = window.FluxionUI.currentWorkspace();
      let settingsTab = [...gBrowser.tabs].find(candidate =>
        candidate.linkedBrowser?.currentURI?.spec.startsWith("about:preferences?fluxion=search") &&
        window.FluxionUI.tabWorkspace(candidate) === captureWorkspace);
      if (!settingsTab) {
        settingsTab = gBrowser.addTrustedTab("about:preferences?fluxion=search", { skipAnimation: true });
        window.FluxionUI.setTabWorkspace(settingsTab, captureWorkspace);
      }
      let stableFrames = 0;
      const settleEmbeddingCapture = (attempt = 0) => {
        if (settingsTab && !settingsTab.closing) {
          if (settingsTab.hidden) gBrowser.showTab(settingsTab);
          gBrowser.selectedTab = settingsTab;
        }
        syncVisibility();
        showSection("search");
        const status = notes.get("search");
        if (status) status.textContent = "";
        const embeddingRow = embeddingChoice.closest(".fluxion-setting");
        const searchActive = sections.get("search")?.button.getAttribute("aria-current") === "true";
        const settled = gBrowser.selectedTab === settingsTab && !root.hidden &&
          activeSection === "search" && searchActive && !search.hidden &&
          embeddingChoice.value === "gecko-local" &&
          embeddingRow?.getBoundingClientRect().height > 40;
        stableFrames = settled ? stableFrames + 1 : 0;
        if (stableFrames >= 10) {
          Services.prefs.setStringPref(
            "fluxion.memory.embeddingSettings.capture.health",
            "settled-embedding-controls-visible",
          );
          Services.prefs.savePrefFile(null);
          return;
        }
        if (attempt >= 60) {
          Services.prefs.setStringPref(
            "fluxion.memory.embeddingSettings.error",
            `capture=${gBrowser.selectedBrowser?.currentURI?.spec || "missing"} ` +
              `selected=${gBrowser.selectedTab === settingsTab} section=${activeSection} ` +
              `provider=${embeddingChoice.value}`,
          );
          Services.prefs.savePrefFile(null);
          return;
        }
        window.setTimeout(() => settleEmbeddingCapture(attempt + 1), 100);
      };
      settleEmbeddingCapture();
    }, { once: true });
  }
  if (Services.env.get("FLUXION_VISUAL_WORKSPACE_SETTINGS_TEST") === "1") {
    window.addEventListener("FluxionDataClearingVisualReady", () => {
      const captureWorkspace = window.FluxionUI.currentWorkspace();
      let settingsTab = [...gBrowser.tabs].find(candidate =>
        candidate.linkedBrowser?.currentURI?.spec.startsWith("about:preferences?fluxion=workspaces") &&
        window.FluxionUI.tabWorkspace(candidate) === captureWorkspace);
      if (!settingsTab) {
        settingsTab = gBrowser.addTrustedTab("about:preferences?fluxion=workspaces", { skipAnimation: true });
        window.FluxionUI.setTabWorkspace(settingsTab, captureWorkspace);
      }
      let stableFrames = 0;
      const settleWorkspaceCapture = (attempt = 0) => {
        if (settingsTab && !settingsTab.closing) {
          if (settingsTab.hidden) gBrowser.showTab(settingsTab);
          gBrowser.selectedTab = settingsTab;
        }
        syncVisibility();
        showSection("workspaces");
        renderWorkspaces();
        const status = notes.get("workspaces");
        if (status) status.textContent = "";
        const workspacesActive = sections.get("workspaces")?.button.getAttribute("aria-current") === "true";
        const settled = gBrowser.selectedTab === settingsTab && !root.hidden &&
          activeSection === "workspaces" && workspacesActive && !workspacePanel.hidden &&
          workspaceList.getBoundingClientRect().height > 100;
        stableFrames = settled ? stableFrames + 1 : 0;
        if (stableFrames >= 10) {
          Services.prefs.setStringPref(
            "fluxion.workspaceSettings.capture.health",
            "settled-workspaces-surface-visible",
          );
          Services.prefs.savePrefFile(null);
          window.dispatchEvent(new window.CustomEvent("FluxionWorkspaceCaptureReady"));
          return;
        }
        if (attempt >= 60) {
          Services.prefs.setStringPref(
            "fluxion.workspaceSettings.visual.error",
            `captureRoute=${gBrowser.selectedBrowser?.currentURI?.spec || "missing"} ` +
              `targetRoute=${settingsTab?.linkedBrowser?.currentURI?.spec || "missing"} ` +
              `selected=${gBrowser.selectedTab === settingsTab} hidden=${Boolean(settingsTab?.hidden)} ` +
              `root=${!root.hidden} panel=${!workspacePanel.hidden}`,
          );
          Services.prefs.savePrefFile(null);
          return;
        }
        window.setTimeout(() => settleWorkspaceCapture(attempt + 1), 100);
      };
      settleWorkspaceCapture();
    }, { once: true });
    window.setTimeout(async () => {
      let fixtureTab = null;
      let settingsTab = null;
      let createdId = "";
      try {
        // Other fixtures may navigate or discard their Settings tab. Own this
        // page and wait for its actual route before exercising visible controls.
        settingsTab = gBrowser.addTrustedTab("about:preferences?fluxion=workspaces", {
          skipAnimation: true,
        });
        window.FluxionUI.setTabWorkspace(settingsTab, window.FluxionUI.currentWorkspace());
        window.FluxionUI.selectTab(settingsTab);
        await new Promise((resolve, reject) => {
          const awaitSettingsRoute = (attempt = 0) => {
            if (!settingsTab?.parentNode || settingsTab.closing) {
              reject(new Error("Workspace settings fixture tab closed before navigation completed"));
              return;
            }
            const spec = settingsTab.linkedBrowser?.currentURI?.spec || "";
            if (spec.startsWith("about:preferences?fluxion=workspaces")) {
              resolve();
              return;
            }
            if (attempt >= 60) {
              reject(new Error(`Workspace settings route did not load: ${spec || "missing"}`));
              return;
            }
            window.setTimeout(() => awaitSettingsRoute(attempt + 1), 50);
          };
          awaitSettingsRoute();
        });
        window.FluxionUI.selectTab(settingsTab);
        syncVisibility();
        showSection("workspaces");
        const originalIds = window.FluxionUI.workspaces().map(workspace => workspace.id);
        workspaceName.value = "Reference Lab";
        workspaceCreate.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
        createdId = window.FluxionUI.workspaces().find(workspace =>
          !originalIds.includes(workspace.id) && workspace.name === "Reference Lab")?.id || "";
        let item = workspaceList.querySelector(`[data-workspace-id="${createdId}"]`);
        const name = item?.querySelector(".fluxion-settings-workspace-name");
        if (name) {
          name.value = "Reference Desk";
          name.dispatchEvent(new window.Event("change", { bubbles: true }));
        }
        item = workspaceList.querySelector(`[data-workspace-id="${createdId}"]`);
        const symbol = item?.querySelector('select[aria-label^="Symbol for"]');
        const accent = item?.querySelector('select[aria-label^="Accent for"]');
        if (symbol) {
          symbol.value = "square";
          symbol.dispatchEvent(new window.Event("change", { bubbles: true }));
        }
        item = workspaceList.querySelector(`[data-workspace-id="${createdId}"]`);
        const refreshedAccent = item?.querySelector('select[aria-label^="Accent for"]') || accent;
        if (refreshedAccent) {
          refreshedAccent.value = "sage";
          refreshedAccent.dispatchEvent(new window.Event("change", { bubbles: true }));
        }
        item = workspaceList.querySelector(`[data-workspace-id="${createdId}"]`);
        item?.querySelector('button[aria-label^="Move "][aria-label$=" earlier"]')?.click();
        item = workspaceList.querySelector(`[data-workspace-id="${createdId}"]`);
        const configured = window.FluxionUI.workspaces().find(workspace => workspace.id === createdId);
        const persisted = FluxionWorkspaces.parseWorkspaces(
          Services.prefs.getStringPref("fluxion.workspaces", ""),
        ).find(workspace => workspace.id === createdId);
        const controlsHeight = workspaceList.getBoundingClientRect().height;
        const controlsState = `height=${controlsHeight} rootHidden=${root.hidden} ` +
          `panelHidden=${workspacePanel.hidden} section=${activeSection} ` +
          `selectedURI=${gBrowser.selectedBrowser?.currentURI?.spec || "missing"} ` +
          `itemConnected=${Boolean(item?.isConnected)}`;
        const controlsVisible = Boolean(
          item?.isConnected && item.querySelector('button[aria-label^="Delete "]') &&
          !root.hidden && !workspacePanel.hidden && activeSection === "workspaces" &&
          controlsHeight > 100,
        );
        fixtureTab = gBrowser.addTrustedTab("about:blank?fluxion-workspace-settings=migration", {
          skipAnimation: true,
        });
        window.FluxionUI.setTabWorkspace(fixtureTab, createdId);
        const deleted = window.FluxionUI.deleteWorkspace(createdId, { confirm: false });
        const removed = !window.FluxionUI.workspaces().some(workspace => workspace.id === createdId) &&
          !Services.prefs.getStringPref("fluxion.workspaces", "").includes(createdId);
        const migrated = fixtureTab.parentNode &&
          window.FluxionUI.tabWorkspace(fixtureTab) !== createdId;
        const configuredExactly = configured?.name === "Reference Desk" &&
          configured.icon === "square" && configured.accent === "sage" &&
          persisted?.name === configured.name && persisted.icon === configured.icon &&
          persisted.accent === configured.accent;
        if (createdId && controlsVisible && configuredExactly && deleted && removed && migrated) {
          Services.prefs.setStringPref(
            "fluxion.workspaceSettings.health",
            "live-controls-persisted-and-tabs-migrated",
          );
        } else {
          Services.prefs.setStringPref(
            "fluxion.workspaceSettings.visual.error",
            `created=${Boolean(createdId)} controls=${controlsVisible} configured=${configuredExactly} ` +
              `deleted=${deleted} removed=${removed} migrated=${migrated} ${controlsState}`,
          );
        }
      } catch (error) {
        Services.prefs.setStringPref("fluxion.workspaceSettings.visual.error", String(error));
        Cu.reportError(error);
      } finally {
        if (fixtureTab?.parentNode) gBrowser.removeTab(fixtureTab, { animate: false });
        if (settingsTab?.parentNode) gBrowser.removeTab(settingsTab, { animate: false });
        if (createdId && window.FluxionUI.workspaces().some(workspace => workspace.id === createdId)) {
          window.FluxionUI.deleteWorkspace(createdId, { confirm: false });
        }
        const status = notes.get("workspaces");
        if (status) status.textContent = "";
        Services.prefs.savePrefFile(null);
      }
    }, 5200);
  }
  if (Services.env.get("FLUXION_VISUAL_SHORTCUT_TEST") === "1") {
    window.setTimeout(() => {
      const tab = [...gBrowser.tabs].find(candidate => candidate.linkedBrowser?.currentURI?.spec.startsWith("about:preferences"));
      if (tab) gBrowser.selectedTab = tab;
      showSection("keyboard");
      const result = window.FluxionShortcuts.set("palette", "Accel+Alt+Shift+KeyK");
      refreshShortcutButtons();
      if (result.ok && window.FluxionShortcuts.get("palette") === "Accel+Alt+Shift+KeyK") {
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
      const tab = gBrowser.addTrustedTab("about:preferences?fluxion=about");
      window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
      gBrowser.selectedTab = tab;
      window.setTimeout(async () => {
        syncVisibility();
        showSection("about");
        window.FluxionUI.refresh();
        try {
          const policy = Services.policies;
          const updater = Cc["@mozilla.org/updates/update-service;1"].getService(Ci.nsIApplicationUpdateService);
          if (policy.getActivePolicies().DisableAppUpdate !== true || policy.isAllowed("appUpdate") || !updater.disabled) {
            throw new Error("The Firefox application updater is not disabled by Fluxion’s package policy");
          }
          const checker = Cc["@mozilla.org/updates/update-checker;1"].getService(Ci.nsIUpdateChecker);
          const result = await checker.checkForUpdates(Ci.nsIUpdateChecker.FOREGROUND_CHECK).result;
          if (result.checksAllowed !== false || result.request !== null) {
            throw new Error("A foreground Firefox update check was not blocked");
          }
          if (!about.textContent.includes(`Mozilla Gecko ${geckoVersion}`) ||
              !about.textContent.includes(`Build ${geckoBuildID}`) ||
              releases.getAttribute("aria-label") !== "Open Fluxion releases") {
            throw new Error("About did not expose engine provenance and manual Fluxion releases");
          }
          Services.prefs.setStringPref("fluxion.updates.health", "package-policy-blocked-foreground-firefox-update");
          Services.prefs.savePrefFile(null);
        } catch (error) {
          Services.prefs.setStringPref("fluxion.updates.error", String(error));
          Services.prefs.savePrefFile(null);
          Cu.reportError(error);
          return;
        }
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
