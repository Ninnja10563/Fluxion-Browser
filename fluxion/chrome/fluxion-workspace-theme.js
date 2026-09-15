/* global FluxionColorsCore, Services */
(function initialiseWorkspaceTheme(window) {
  "use strict";
  const { document } = window;
  if (!window.gBrowser || !window.FluxionUI || !window.FluxionColors || window.FluxionWorkspaceTheme) return;
  const HTML = "http://www.w3.org/1999/xhtml";
  const make = (tag, attributes = {}, text = "") => {
    const node = document.createElementNS(HTML, tag);
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
    /* Gecko's native panel content part consumes these exact variables. Its
       default padding is removed because the form owns the single inset. */
    #fluxion-workspace-theme { color-scheme: inherit; --panel-background-color: var(--fluxion-bg-raised); --panel-text-color: var(--fluxion-ink); --panel-border-color: var(--fluxion-line); --panel-padding: 0; }
    .fluxion-workspace-theme-form { width: 280px; box-sizing: border-box; padding: 14px; background: var(--fluxion-bg-raised); color: var(--fluxion-ink); font: 13px system-ui, sans-serif; }
    .fluxion-workspace-theme-form h2 { margin: 0 0 12px; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .fluxion-workspace-theme-form label { display: block; margin-block: 10px 5px; }
    .fluxion-workspace-theme-form select, .fluxion-workspace-theme-form input, .fluxion-workspace-theme-form button { font: inherit; color: inherit; }
    .fluxion-workspace-theme-form select, .fluxion-workspace-theme-form input[type=text] { box-sizing: border-box; min-height: 30px; background: var(--fluxion-bg); border: 1px solid var(--fluxion-line); border-radius: 3px; padding: 4px 7px; }
    .fluxion-workspace-theme-form select { width: 100%; appearance: none; padding-inline-end: 28px;
      background-image: url("chrome://global/skin/icons/arrow-down-12.svg");
      background-position: right 8px center; background-size: 12px 12px; background-repeat: no-repeat;
      -moz-context-properties: fill; fill: currentColor; }
    .fluxion-workspace-theme-form select:dir(rtl) { background-position: left 8px center; }
    .fluxion-workspace-theme-fields { display: flex; align-items: center; gap: 8px; }
    .fluxion-workspace-theme-fields input[type=color] { box-sizing: border-box; width: 36px; height: 30px; padding: 2px; border: 1px solid var(--fluxion-line); border-radius: 3px; background: var(--fluxion-bg); }
    .fluxion-workspace-theme-fields input[type=text] { width: 100%; min-width: 0; }
    .fluxion-workspace-theme-note { color: var(--fluxion-muted); font-size: 12px; line-height: 1.4; margin: 10px 0; }
    #fluxion-workspace-theme-error { font-size: 12px; line-height: 1.4; margin: 8px 0; }
    #fluxion-workspace-theme-error:empty { display: none; }
    .fluxion-workspace-theme-actions { display: flex; gap: 6px; margin-top: 12px; }
    .fluxion-workspace-theme-actions button { min-height: 28px; padding: 3px 8px; background: var(--fluxion-bg); border: 1px solid var(--fluxion-line); border-radius: 3px; }
    #fluxion-workspace-theme-reset { margin-inline-end: auto; border-color: transparent; background: transparent; }
    #fluxion-workspace-theme-save { background: var(--fluxion-selected); }
    .fluxion-workspace-theme-form :is(input,select,button):focus-visible { outline: 2px solid var(--fluxion-accent); outline-offset: 2px; }
  `);
  const form = make("form", { class: "fluxion-workspace-theme-form" });
  const title = make("h2", { id: "fluxion-workspace-theme-title" });
  const modeLabel = make("label", { for: "fluxion-workspace-theme-mode" }, "Appearance");
  const mode = make("select", { id: "fluxion-workspace-theme-mode" });
  mode.append(make("option", { value: "light" }, "Light"), make("option", { value: "dark" }, "Dark"));
  const colorLabel = make("label", { for: "fluxion-workspace-theme-hex" }, "Browser color");
  const color = make("input", { type: "color", id: "fluxion-workspace-theme-color", "aria-label": "Choose browser color" });
  const hex = make("input", { type: "text", id: "fluxion-workspace-theme-hex", spellcheck: "false", maxlength: "7",
    "aria-describedby": "fluxion-workspace-theme-error", placeholder: "#1c1e20" });
  const fields = make("div", { class: "fluxion-workspace-theme-fields" }); fields.append(color, hex);
  const note = make("p", { class: "fluxion-workspace-theme-note" }, "Saved for this workspace. Page colors are unchanged.");
  const error = make("p", { id: "fluxion-workspace-theme-error", role: "alert" });
  const actions = make("div", { class: "fluxion-workspace-theme-actions" });
  const reset = make("button", { type: "button", id: "fluxion-workspace-theme-reset" }, "Reset");
  const cancel = make("button", { type: "button", id: "fluxion-workspace-theme-cancel" }, "Cancel");
  const save = make("button", { type: "submit", id: "fluxion-workspace-theme-save" }, "Save");
  actions.append(reset, cancel, save);
  form.append(title, modeLabel, mode, colorLabel, fields, note, error, actions);
  panel.append(style, form);
  (document.getElementById("mainPopupSet") || document.documentElement).append(panel);
  let session = null, frame = 0, disposed = false, returnAnchor = null, pendingId = null;
  const workspace = id => window.FluxionUI.workspaces().find(item => item.id === id);
  const revision = value => JSON.stringify(value.theme || null);
  function showMode() {
    if (!session) return;
    hex.value = session.draft[mode.value];
    const valid = FluxionColorsCore.hex(hex.value);
    if (valid) color.value = valid;
    hex.removeAttribute("aria-invalid"); error.textContent = "";
  }
  function close(restoreFocus = false) {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0; pendingId = null;
    returnAnchor = restoreFocus === true ? session?.anchor : null;
    session = null;
    panel.hidePopup();
  }
  function commit(remove = false) {
    if (!session) return;
    const target = workspace(session.id);
    if (session.invalidated || !target || revision(target) !== session.revision) {
      error.textContent = "This workspace theme changed elsewhere. Cancel and reopen its theme editor.";
      return;
    }
    const light = FluxionColorsCore.hex(session.draft.light), dark = FluxionColorsCore.hex(session.draft.dark);
    if (!remove && (!light || !dark)) {
      error.textContent = "Enter a six-digit hexadecimal color for both appearances.";
      mode.value = !light ? "light" : "dark";
      hex.value = session.draft[mode.value];
      hex.setAttribute("aria-invalid", "true"); hex.focus();
      return;
    }
    let saved = false;
    try { saved = Boolean(window.FluxionUI.updateWorkspace(session.id, { theme: remove ? null : { light, dark } })); }
    catch (_) { /* Keep the local draft available when profile persistence fails. */ }
    if (!saved) {
      error.textContent = "The workspace theme could not be saved.";
      return;
    }
    close(true);
  }
  color.addEventListener("input", () => {
    if (!session) return;
    session.draft[mode.value] = color.value;
    hex.value = color.value; hex.removeAttribute("aria-invalid"); error.textContent = "";
  });
  hex.addEventListener("input", () => {
    if (!session) return;
    session.draft[mode.value] = hex.value;
    const valid = FluxionColorsCore.hex(hex.value);
    if (valid) { color.value = valid; hex.removeAttribute("aria-invalid"); error.textContent = ""; }
  });
  mode.addEventListener("change", showMode);
  form.addEventListener("submit", event => { event.preventDefault(); commit(); });
  cancel.addEventListener("click", () => close(true));
  reset.addEventListener("click", () => commit(true));
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  panel.addEventListener("popuphidden", event => {
    if (event.target !== panel) return;
    session = null;
    const anchor = returnAnchor;
    returnAnchor = null;
    if (!disposed && anchor?.isConnected && document.hasFocus() && anchor.getBoundingClientRect().width > 0 && !anchor.closest("[inert]")) {
      anchor.focus({ preventScroll: true });
    }
  });
  panel.addEventListener("popupshown", event => { if (event.target === panel && session) { hex.focus(); hex.select(); } });
  function open(id, anchor) {
    if (disposed || !workspace(id) || !anchor?.isConnected || anchor.ownerDocument !== document) return false;
    close();
    pendingId = id;
    frame = window.requestAnimationFrame(() => {
      frame = 0; pendingId = null;
      const target = workspace(id);
      if (disposed || !target || !anchor.isConnected || !document.hasFocus() || Services.focus.activeWindow !== window ||
          anchor.getBoundingClientRect().width <= 0 || anchor.closest("[inert]")) return;
      const global = window.FluxionColors.current();
      const base = global.enabled ? global : FluxionColorsCore.DEFAULTS;
      session = { id, anchor, revision: revision(target), draft: {
        light: FluxionColorsCore.hex(target.theme?.light) || base.light.base,
        dark: FluxionColorsCore.hex(target.theme?.dark) || base.dark.base,
      } };
      title.textContent = `${target.name} theme`;
      const appearance = window.FluxionTheme?.current();
      mode.value = ["light", "dark"].includes(appearance) ? appearance :
        window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      showMode();
      panel.openPopup(anchor, "after_start", 0, 4, false, false);
    });
    return true;
  }
  const workspaceChanged = () => {
    if (pendingId && !workspace(pendingId)) { window.cancelAnimationFrame(frame); frame = 0; pendingId = null; }
    if (session && !workspace(session.id)) {
      session.invalidated = true;
      error.textContent = "This workspace was deleted. Cancel and reopen the theme editor.";
    }
  };
  window.addEventListener("FluxionWorkspacesChanged", workspaceChanged);
  window.addEventListener("unload", () => {
    disposed = true; close(); panel.remove(); window.removeEventListener("FluxionWorkspacesChanged", workspaceChanged);
    delete window.FluxionWorkspaceTheme;
  }, { once: true });
  window.FluxionWorkspaceTheme = Object.freeze({ open });
})(window);
