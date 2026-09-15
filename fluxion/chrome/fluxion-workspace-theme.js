/* global FluxionColorsCore, Services */
(function initialiseWorkspaceTheme(window) {
  "use strict";
  const { document } = window;
  if (!window.gBrowser || !window.FluxionUI || !window.FluxionColors || window.FluxionWorkspaceTheme) return;
  const make = (tag, attributes = {}, text = "") => {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  };
  const panel = document.createXULElement("panel");
  panel.id = "fluxion-workspace-theme";
  panel.setAttribute("type", "arrow");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "fluxion-workspace-theme-title");
  const style = make("style", {}, `
    #fluxion-workspace-theme { color-scheme: inherit; --panel-background-color: var(--fluxion-bg-raised); --panel-text-color: var(--fluxion-ink); --panel-border-color: var(--fluxion-line); --panel-padding: 0; }
    :root[data-fluxion-workspace-appearance="light"] #fluxion-workspace-theme { color-scheme: light; }
    :root[data-fluxion-workspace-appearance="dark"] #fluxion-workspace-theme { color-scheme: dark; }
    .fluxion-workspace-theme-form { width: 292px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 14px; background: var(--fluxion-bg-raised); color: var(--fluxion-ink); font: 13px system-ui, sans-serif; }
    .fluxion-workspace-theme-form h2 { margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .fluxion-workspace-theme-header { display: flex; align-items: center; gap: 8px; margin-block-end: 12px; }
    .fluxion-workspace-theme-form label { display: block; margin-block: 10px 5px; }
    .fluxion-workspace-theme-form select, .fluxion-workspace-theme-form input, .fluxion-workspace-theme-form button { font: inherit; color: inherit; }
    .fluxion-workspace-theme-form select, .fluxion-workspace-theme-form input[type=text] { box-sizing: border-box; min-height: 30px; background: var(--fluxion-bg); border: 1px solid var(--fluxion-line); border-radius: 3px; padding: 4px 7px; }
    .fluxion-workspace-theme-form select { width: 100%; appearance: none; padding-inline-end: 28px;
      background-image: url("chrome://global/skin/icons/arrow-down-12.svg");
      background-position: right 8px center; background-size: 12px 12px; background-repeat: no-repeat;
      -moz-context-properties: fill; fill: currentColor; }
    .fluxion-workspace-theme-form select:dir(rtl) { background-position: left 8px center; }
    .fluxion-workspace-theme-fields { display: flex; align-items: center; gap: 8px; }
    .fluxion-workspace-theme-fields input[type=color] { box-sizing: border-box; width: 36px; flex: 0 0 36px; height: 30px; padding: 2px; border: 1px solid var(--fluxion-line); border-radius: 3px; background: var(--fluxion-bg); }
    .fluxion-workspace-theme-fields input[type=text] { width: 100%; min-width: 0; }
    .fluxion-workspace-theme-note { color: var(--fluxion-muted); font-size: 12px; line-height: 1.4; margin: 10px 0; }
    #fluxion-workspace-theme-error { font-size: 12px; line-height: 1.4; margin: 8px 0; }
    #fluxion-workspace-theme-error:empty { display: none; }
    .fluxion-workspace-theme-actions { display: flex; gap: 6px; margin-top: 12px; }
    .fluxion-workspace-theme-actions button { min-height: 28px; padding: 3px 8px; background: var(--fluxion-bg); border: 1px solid var(--fluxion-line); border-radius: 3px; }
    #fluxion-workspace-theme-reset { margin-inline-end: auto; border-color: transparent; background: transparent; }
    #fluxion-workspace-theme-save { background: var(--fluxion-selected); }
    #fluxion-workspace-theme-colors { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 0; border: 0; border-block: 1px solid var(--fluxion-line); background: transparent; text-align: start; }
    #fluxion-workspace-theme-colors::after { content: ''; width: 12px; height: 12px; background: currentColor; mask: url("chrome://global/skin/icons/arrow-right.svg") center / contain no-repeat; }
    #fluxion-workspace-theme-back { border: 0; padding: 4px; background: transparent; font-size: 12px; }
    .fluxion-workspace-theme-form :is(input,select,button):focus-visible { outline: 2px solid var(--fluxion-accent); outline-offset: 2px; }
    .fluxion-workspace-theme-form [hidden] { display: none !important; }
  `);
  const form = make("form", { class: "fluxion-workspace-theme-form" });
  const header = make("div", { class: "fluxion-workspace-theme-header" });
  const back = make("button", { type: "button", id: "fluxion-workspace-theme-back", "aria-label": "Back to workspace appearance" }, "Back");
  const title = make("h2", { id: "fluxion-workspace-theme-title" });
  header.append(back, title);
  const overview = make("div", { id: "fluxion-workspace-theme-overview" });
  const appearance = make("select", { id: "fluxion-workspace-theme-appearance", "aria-describedby": "fluxion-workspace-theme-appearance-help" });
  for (const [value, text] of [["inherit", "Use browser setting"], ["system", "Follow system"], ["light", "Light"], ["dark", "Dark"]]) {
    appearance.append(make("option", { value }, text));
  }
  const appearanceHelp = make("p", { id: "fluxion-workspace-theme-appearance-help", class: "fluxion-workspace-theme-note" },
    "Changes this workspace’s browser frame, not webpages or other workspaces.");
  const colorsButton = make("button", { type: "button", id: "fluxion-workspace-theme-colors" }, "Colors");
  overview.append(make("label", { for: appearance.id }, "Workspace appearance"), appearance, appearanceHelp, colorsButton);
  const colorsPage = make("div", { id: "fluxion-workspace-theme-colors-page" });
  const mode = make("select", { id: "fluxion-workspace-theme-mode", "aria-describedby": "fluxion-workspace-theme-note" });
  mode.append(make("option", { value: "light" }, "Light colors"), make("option", { value: "dark" }, "Dark colors"));
  colorsPage.append(make("label", { for: mode.id }, "Editing palette"), mode);
  const fields = new Map();
  for (const [part, label, inputId, colorId] of [["base", "Browser color", "hex", "color"], ["accent", "Focus and selection accent", "accent-hex", "accent-color"]]) {
    const color = make("input", { type: "color", id: `fluxion-workspace-theme-${colorId}`, "aria-label": `Choose ${label.toLowerCase()}` });
    const hex = make("input", { type: "text", id: `fluxion-workspace-theme-${inputId}`, spellcheck: "false", maxlength: "7",
      "aria-describedby": "fluxion-workspace-theme-error", placeholder: "#1c1e20" });
    const row = make("div", { class: "fluxion-workspace-theme-fields" }); row.append(color, hex);
    colorsPage.append(make("label", { for: hex.id }, label), row);
    fields.set(part, { color, hex });
  }
  const note = make("p", { id: "fluxion-workspace-theme-note", class: "fluxion-workspace-theme-note", role: "status" });
  const error = make("p", { id: "fluxion-workspace-theme-error", role: "alert" });
  const actions = make("div", { class: "fluxion-workspace-theme-actions" });
  const reset = make("button", { type: "button", id: "fluxion-workspace-theme-reset" }, "Reset");
  const cancel = make("button", { type: "button", id: "fluxion-workspace-theme-cancel" }, "Cancel");
  const save = make("button", { type: "submit", id: "fluxion-workspace-theme-save" }, "Save");
  actions.append(reset, cancel, save);
  form.append(header, overview, colorsPage, note, error, actions);
  panel.append(style, form);
  (document.getElementById("mainPopupSet") || document.documentElement).append(panel);
  let session = null, frame = 0, disposed = false, returnAnchor = null, pendingId = null;
  const workspace = id => window.FluxionUI.workspaces().find(item => item.id === id);
  const revision = value => JSON.stringify(value.theme || null);
  function inheritedPalette() {
    const global = window.FluxionColors.current();
    return global.enabled ? global : FluxionColorsCore.DEFAULTS;
  }
  function draftFor(target) {
    const base = inheritedPalette();
    return {
      light: FluxionColorsCore.hex(target.theme?.light) || base.light.base,
      dark: FluxionColorsCore.hex(target.theme?.dark) || base.dark.base,
      lightAccent: FluxionColorsCore.hex(target.theme?.lightAccent) || base.light.accent,
      darkAccent: FluxionColorsCore.hex(target.theme?.darkAccent) || base.dark.accent,
      ...(target.theme?.mode ? { mode: target.theme.mode } : {}),
    };
  }
  function activeMode() {
    const choice = session?.draft.mode || window.FluxionTheme?.current();
    return ["light", "dark"].includes(choice) ? choice : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function updateNote() {
    if (!session) return;
    const targetActive = window.FluxionUI.currentWorkspace() === session.id;
    if (session.reset) note.textContent = "Browser defaults previewed. Save to remove this workspace’s appearance override.";
    else if (!targetActive) note.textContent = "Colors will appear when this workspace is active. Nothing is saved until Save.";
    else if (session.page === "colors") {
      const choice = { inherit: "the browser setting", system: "the system appearance", light: "Light appearance", dark: "Dark appearance" }[appearance.value];
      note.textContent = `Previewing ${mode.value} colors. On Save, this workspace uses ${choice}.`;
    }
    else note.textContent = "Preview only until Save. Cancel restores the current workspace appearance.";
  }
  function preview() {
    if (!session || session.invalidated) return;
    const draft = { ...session.draft };
    for (const key of ["light", "dark", "lightAccent", "darkAccent"]) {
      const value = FluxionColorsCore.hex(draft[key]);
      if (!value) return;
      draft[key] = value;
    }
    const theme = session.reset ? null : !session.dirty && session.page === "appearance" ? session.initialTheme : draft;
    session.preview.update(theme, session.page === "colors" ? mode.value : null);
    updateNote();
  }
  function showMode() {
    if (!session) return;
    for (const [part, pair] of fields) {
      pair.hex.value = session.draft[part === "base" ? mode.value : `${mode.value}Accent`];
      const valid = FluxionColorsCore.hex(pair.hex.value);
      if (valid) pair.color.value = valid;
      pair.hex.removeAttribute("aria-invalid");
    }
    error.textContent = "";
    preview();
  }
  function showPage(page, moveFocus = true) {
    if (!session) return;
    session.page = page;
    overview.hidden = page !== "appearance"; colorsPage.hidden = page !== "colors"; back.hidden = page !== "colors";
    title.textContent = page === "colors" ? "Workspace colors" : `${workspace(session.id)?.name || "Workspace"} appearance`;
    if (page === "colors") showMode(); else preview();
    if (moveFocus) (page === "colors" ? fields.get("base").hex : colorsButton).focus();
  }
  function releasePreview() {
    const old = session; session = null;
    old?.preview.clear();
  }
  function close(restoreFocus = false) {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0; pendingId = null;
    returnAnchor = restoreFocus === true ? session?.anchor : null;
    releasePreview();
    panel.hidePopup();
  }
  function commit() {
    if (!session) return;
    const target = workspace(session.id);
    if (session.invalidated || !target || revision(target) !== session.revision) {
      error.textContent = "This workspace appearance changed elsewhere. Cancel and reopen the editor.";
      return;
    }
    if (!session.dirty) { close(true); return; }
    const theme = { ...session.draft };
    if (!session.reset) for (const key of ["light", "dark", "lightAccent", "darkAccent"]) {
      const value = FluxionColorsCore.hex(theme[key]);
      if (!value) {
        mode.value = key.startsWith("light") ? "light" : "dark";
        showPage("colors", false);
        const invalid = fields.get(key.endsWith("Accent") ? "accent" : "base").hex;
        error.textContent = "Enter a six-digit hexadecimal color, such as #304050.";
        invalid.setAttribute("aria-invalid", "true"); invalid.focus();
        return;
      }
      theme[key] = value;
    }
    let saved = false;
    session.committing = true;
    try { saved = Boolean(window.FluxionUI.updateWorkspace(session.id, { theme: session.reset ? null : theme })); }
    catch (_) { /* Keep the draft when profile persistence fails. */ }
    if (!saved) {
      session.committing = false;
      error.textContent = "The workspace appearance could not be saved.";
      return;
    }
    close(true);
  }
  for (const [part, pair] of fields) {
    const update = (value, fromPicker) => {
      if (!session) return;
      session.reset = false; session.dirty = true;
      session.draft[part === "base" ? mode.value : `${mode.value}Accent`] = value;
      if (fromPicker) pair.hex.value = value;
      const valid = FluxionColorsCore.hex(value);
      if (valid) { pair.color.value = valid; pair.hex.removeAttribute("aria-invalid"); error.textContent = ""; }
      preview();
    };
    pair.color.addEventListener("input", () => update(pair.color.value, true));
    pair.hex.addEventListener("input", () => update(pair.hex.value, false));
  }
  mode.addEventListener("change", showMode);
  appearance.addEventListener("change", () => {
    if (!session || !["inherit", "system", "light", "dark"].includes(appearance.value)) return;
    session.reset = false; session.dirty = true;
    if (appearance.value === "inherit") delete session.draft.mode; else session.draft.mode = appearance.value;
    mode.value = activeMode(); preview();
  });
  colorsButton.addEventListener("click", () => showPage("colors"));
  back.addEventListener("click", () => showPage("appearance"));
  form.addEventListener("submit", event => { event.preventDefault(); commit(); });
  cancel.addEventListener("click", () => close(true));
  reset.addEventListener("click", () => {
    if (!session) return;
    session.draft = draftFor({}); session.reset = true; session.dirty = true;
    appearance.value = "inherit"; mode.value = activeMode();
    showPage("appearance");
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  panel.addEventListener("popuphidden", event => {
    if (event.target !== panel) return;
    releasePreview();
    const anchor = returnAnchor; returnAnchor = null;
    if (!disposed && anchor?.isConnected && document.hasFocus() && Services.focus.activeWindow === window &&
        anchor.getBoundingClientRect().width > 0 && !anchor.closest("[inert]")) anchor.focus({ preventScroll: true });
  });
  panel.addEventListener("popupshown", event => { if (event.target === panel && session) appearance.focus(); });
  function open(id, anchor) {
    if (disposed || !workspace(id) || !anchor?.isConnected || anchor.ownerDocument !== document) return false;
    close(); pendingId = id;
    frame = window.requestAnimationFrame(() => {
      frame = 0; pendingId = null;
      const target = workspace(id);
      if (disposed || !target || !anchor.isConnected || !document.hasFocus() || Services.focus.activeWindow !== window ||
          anchor.getBoundingClientRect().width <= 0 || anchor.closest("[inert]")) return;
      session = { id, anchor, revision: revision(target), openedWorkspace: window.FluxionUI.currentWorkspace(),
        draft: draftFor(target), initialTheme: target.theme || null, reset: false, dirty: false,
        preview: window.FluxionColors.beginWorkspacePreview(id) };
      appearance.value = session.draft.mode || "inherit";
      mode.value = activeMode(); error.textContent = "";
      showPage("appearance", false);
      panel.openPopup(anchor, "after_start", 0, 4, false, false);
    });
    return true;
  }
  function workspaceChanged() {
    if (pendingId && !workspace(pendingId)) { window.cancelAnimationFrame(frame); frame = 0; pendingId = null; }
    if (!session || session.committing) return;
    const target = workspace(session.id);
    if (!target || revision(target) !== session.revision) {
      session.invalidated = true;
      session.preview.clear();
      error.textContent = "This workspace appearance changed elsewhere. Cancel and reopen the editor.";
    }
  }
  const colorsChanged = () => {
    if (session && window.FluxionUI.currentWorkspace() !== session.openedWorkspace) close();
  };
  window.addEventListener("FluxionWorkspacesChanged", workspaceChanged);
  window.addEventListener("FluxionColorsChanged", colorsChanged);
  window.addEventListener("unload", () => {
    disposed = true; close(); panel.remove();
    window.removeEventListener("FluxionWorkspacesChanged", workspaceChanged);
    window.removeEventListener("FluxionColorsChanged", colorsChanged);
    delete window.FluxionWorkspaceTheme;
  }, { once: true });
  window.FluxionWorkspaceTheme = Object.freeze({ open });
})(window);
