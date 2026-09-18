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
    .fluxion-workspace-theme-swatch { box-sizing: border-box; width: 36px; flex: 0 0 36px; height: 30px; padding: 2px; border: 1px solid var(--fluxion-line); border-radius: 3px; background: var(--swatch); background-clip: content-box; }
    .fluxion-workspace-theme-fields input[type=text] { width: 100%; min-width: 0; }
    #fluxion-workspace-theme-picker input[type=range] { display: block; width: 100%; height: 26px; margin: 0; padding: 0; background: transparent; }
    #fluxion-workspace-theme-picker input[type=range]::-moz-range-track { height: 8px; border-radius: 2px; background: var(--range-colors); }
    #fluxion-workspace-theme-picker input[type=range]::-moz-range-thumb { width: 12px; height: 18px; border-radius: 3px; border: 1px solid var(--fluxion-line); background: var(--fluxion-ink); }
    #fluxion-workspace-theme-picker-hex { width: 100%; }
    .fluxion-workspace-theme-plane { position: relative; margin-block: 8px 12px; }
    #fluxion-workspace-theme-plane { display: block; width: 100%; height: 132px; touch-action: none; cursor: crosshair; border-radius: 2px; }
    #fluxion-workspace-theme-plane:focus-visible { outline: 2px solid var(--fluxion-accent); outline-offset: 2px; }
    #fluxion-workspace-theme-point { position: absolute; width: 8px; height: 8px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 0 1px black; transform: translate(-50%, -50%); pointer-events: none; }
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
  for (const [part, label, inputId, colorId] of [["base", "Browser color", "hex", "color"], ["accent", "Focus and control color", "accent-hex", "accent-color"]]) {
    const color = make("button", { type: "button", class: "fluxion-workspace-theme-swatch", id: `fluxion-workspace-theme-${colorId}`, "aria-label": `Choose ${label.toLowerCase()}` });
    const hex = make("input", { type: "text", id: `fluxion-workspace-theme-${inputId}`, spellcheck: "false", maxlength: "7",
      "aria-describedby": "fluxion-workspace-theme-error", placeholder: "#1c1e20" });
    const row = make("div", { class: "fluxion-workspace-theme-fields" }); row.append(color, hex);
    colorsPage.append(make("label", { for: hex.id }, label), row);
    fields.set(part, { color, hex });
  }
  colorsPage.append(make("p", { class: "fluxion-workspace-theme-note" },
    "Colors focus rings and Fluxion Settings checkboxes. Low-contrast choices are adjusted for visibility. Webpages and macOS dialogs keep their own colors."));
  const pickerPage = make("div", { id: "fluxion-workspace-theme-picker" });
  const planeWrap = make("div", { class: "fluxion-workspace-theme-plane" });
  const plane = make("canvas", { id: "fluxion-workspace-theme-plane", width: "264", height: "132", tabindex: "0", role: "group",
    "aria-label": "Saturation and lightness. Drag to choose, or use arrow keys. The ranges below adjust the same color." });
  const point = make("span", { id: "fluxion-workspace-theme-point", "aria-hidden": "true" });
  planeWrap.append(plane, point); pickerPage.append(planeWrap);
  const ranges = new Map();
  for (const [name, maximum] of [["Hue", 360], ["Saturation", 100], ["Lightness", 100]]) {
    const key = name.toLowerCase();
    const range = make("input", { type: "range", id: `fluxion-workspace-theme-${key}`, min: "0", max: String(maximum), step: "1" });
    pickerPage.append(make("label", { for: range.id }, name), range);
    ranges.set(key, range);
  }
  const pickerHex = make("input", { type: "text", id: "fluxion-workspace-theme-picker-hex", spellcheck: "false", maxlength: "7",
    "aria-describedby": "fluxion-workspace-theme-error" });
  pickerPage.append(make("label", { for: pickerHex.id }, "Hexadecimal color"), pickerHex);
  const note = make("p", { id: "fluxion-workspace-theme-note", class: "fluxion-workspace-theme-note", role: "status" });
  const error = make("p", { id: "fluxion-workspace-theme-error", role: "alert" });
  const actions = make("div", { class: "fluxion-workspace-theme-actions" });
  const reset = make("button", { type: "button", id: "fluxion-workspace-theme-reset" }, "Reset");
  const cancel = make("button", { type: "button", id: "fluxion-workspace-theme-cancel" }, "Cancel");
  const save = make("button", { type: "submit", id: "fluxion-workspace-theme-save" }, "Save");
  actions.append(reset, cancel, save);
  form.append(header, overview, colorsPage, pickerPage, note, error, actions);
  panel.append(style, form);
  (document.getElementById("mainPopupSet") || document.documentElement).append(panel);
  let session = null, frame = 0, disposed = false, returnAnchor = null, pendingId = null;
  let planeHue = null, pointerId = null;
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
    else if (session.page !== "appearance") {
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
    session.preview.update(theme, session.page !== "appearance" ? mode.value : null);
    updateNote();
  }
  function showMode() {
    if (!session) return;
    for (const [part, pair] of fields) {
      pair.hex.value = session.draft[part === "base" ? mode.value : `${mode.value}Accent`];
      const valid = FluxionColorsCore.hex(pair.hex.value);
      if (valid) setSwatch(pair.color, valid);
      pair.hex.removeAttribute("aria-invalid");
    }
    error.textContent = "";
    preview();
  }
  function showPage(page, moveFocus = true) {
    if (!session) return;
    session.page = page;
    overview.hidden = page !== "appearance"; colorsPage.hidden = page !== "colors"; pickerPage.hidden = page !== "picker"; back.hidden = page === "appearance";
    back.setAttribute("aria-label", page === "picker" ? "Back to workspace colors" : "Back to workspace appearance");
    title.textContent = page === "picker" ? (session.pickerPart === "accent" ? "Focus and control color" : "Browser color") :
      page === "colors" ? "Workspace colors" : `${workspace(session.id)?.name || "Workspace"} appearance`;
    if (page === "colors") showMode(); else preview();
    if (moveFocus) (page === "picker" ? ranges.get("hue") : page === "colors" ? fields.get("base").hex : colorsButton).focus();
  }
  function releasePreview() {
    if (pointerId !== null) {
      try { plane.releasePointerCapture(pointerId); } catch (_) { /* Capture can already be released by popup teardown. */ }
      pointerId = null;
    }
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
  function setSwatch(button, value) {
    button.value = value;
    button.style.setProperty("--swatch", value);
    button.setAttribute("aria-description", value);
  }
  function updateField(part, value) {
      if (!session || session.invalidated) return;
      const pair = fields.get(part);
      session.reset = false; session.dirty = true;
      session.draft[part === "base" ? mode.value : `${mode.value}Accent`] = value;
      pair.hex.value = value;
      const valid = FluxionColorsCore.hex(value);
      if (valid) { setSwatch(pair.color, valid); pair.hex.removeAttribute("aria-invalid"); error.textContent = ""; }
      preview();
  }
  function hsl(value) {
    const [r, g, b] = [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
    const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low, light = (high + low) / 2;
    const hue = !delta ? 0 : high === r ? ((g - b) / delta + 6) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return [hue * 60, !delta ? 0 : delta / (1 - Math.abs(2 * light - 1)) * 100, light * 100];
  }
  function hexFromHsl(hue, saturation, lightness) {
    const saturationUnit = saturation / 100, light = lightness / 100;
    const amplitude = saturationUnit * Math.min(light, 1 - light);
    return "#" + [0, 8, 4].map(offset => {
      const segment = (offset + hue / 30) % 12;
      const channel = light - amplitude * Math.max(-1, Math.min(segment - 3, 9 - segment, 1));
      return Math.round(255 * channel).toString(16).padStart(2, "0");
    }).join("");
  }
  function paintRanges() {
    const [hue, saturation, lightness] = [...ranges.values()].map(range => Number(range.value));
    ranges.get("hue").style.setProperty("--range-colors", "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)");
    ranges.get("saturation").style.setProperty("--range-colors", `linear-gradient(to right, hsl(${hue} 0% ${lightness}%), hsl(${hue} 100% ${lightness}%))`);
    ranges.get("lightness").style.setProperty("--range-colors", `linear-gradient(to right, #000, hsl(${hue} ${saturation}% 50%), #fff)`);
    for (const [name, range] of ranges) range.setAttribute("aria-valuetext", `${range.value}${name === "hue" ? " degrees" : " percent"}`);
    point.style.setProperty("left", `${saturation}%`); point.style.setProperty("top", `${100 - lightness}%`);
    plane.setAttribute("aria-description", `${saturation} percent saturation, ${lightness} percent lightness`);
    // The color plane itself explains the chosen color, not decoration. Its
    // bitmap changes only with hue; pointer motion merely moves the marker.
    if (planeHue !== hue) {
      const context = plane.getContext?.("2d");
      if (context) for (let x = 0; x < plane.width; x++) {
        const gradient = context.createLinearGradient(0, 0, 0, plane.height);
        gradient.addColorStop(0, "white"); gradient.addColorStop(.5, `hsl(${hue} ${x / (plane.width - 1) * 100}% 50%)`);
        gradient.addColorStop(1, "black"); context.fillStyle = gradient; context.fillRect(x, 0, 1, plane.height);
      }
      planeHue = hue;
    }
  }
  function syncPicker(value) {
    pickerHex.value = value;
    pickerHex.removeAttribute("aria-invalid");
    const values = hsl(value);
    [...ranges.values()].forEach((range, index) => { range.value = String(Math.round(values[index])); });
    paintRanges();
  }
  for (const [part, pair] of fields) {
    pair.color.addEventListener("click", () => {
      if (!session || session.invalidated) return;
      session.pickerPart = part;
      syncPicker(FluxionColorsCore.hex(pair.hex.value) || pair.color.value);
      showPage("picker");
    });
    pair.hex.addEventListener("input", () => updateField(part, pair.hex.value));
  }
  function updateFromRanges() {
    if (!session || session.page !== "picker" || session.invalidated) return;
    const value = hexFromHsl(...[...ranges.values()].map(control => Number(control.value)));
    pickerHex.value = value; pickerHex.removeAttribute("aria-invalid");
    paintRanges(); updateField(session.pickerPart, value);
  }
  for (const range of ranges.values()) range.addEventListener("input", updateFromRanges);
  function positionFromPointer(event) {
    const box = plane.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
    ranges.get("saturation").value = String(clamp((event.clientX - box.left) / box.width * 100));
    ranges.get("lightness").value = String(clamp(100 - (event.clientY - box.top) / box.height * 100));
    updateFromRanges();
  }
  plane.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !session || session.page !== "picker" || session.invalidated) return;
    event.preventDefault(); plane.focus();
    pointerId = event.pointerId; plane.setPointerCapture(pointerId); positionFromPointer(event);
  });
  plane.addEventListener("pointermove", event => { if (event.pointerId === pointerId) positionFromPointer(event); });
  const endPointer = event => {
    if (event.pointerId !== pointerId) return;
    if (event.type === "pointerup") positionFromPointer(event);
    try { plane.releasePointerCapture(pointerId); } catch (_) { /* Native cancellation already released it. */ }
    pointerId = null;
  };
  plane.addEventListener("pointerup", endPointer); plane.addEventListener("pointercancel", endPointer);
  plane.addEventListener("lostpointercapture", () => { pointerId = null; });
  plane.addEventListener("keydown", event => {
    if (!session || session.page !== "picker" || session.invalidated || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const range = ranges.get(["ArrowLeft", "ArrowRight"].includes(event.key) ? "saturation" : "lightness");
    const delta = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
    range.value = String(Math.max(0, Math.min(100, Number(range.value) + delta * (event.shiftKey ? 10 : 1))));
    updateFromRanges();
  });
  pickerHex.addEventListener("input", () => {
    if (!session || session.page !== "picker" || session.invalidated) return;
    const valid = FluxionColorsCore.hex(pickerHex.value);
    updateField(session.pickerPart, pickerHex.value);
    if (valid) syncPicker(valid);
    else { pickerHex.setAttribute("aria-invalid", "true"); error.textContent = "Enter a six-digit hexadecimal color, such as #304050."; }
  });
  mode.addEventListener("change", showMode);
  appearance.addEventListener("change", () => {
    if (!session || !["inherit", "system", "light", "dark"].includes(appearance.value)) return;
    session.reset = false; session.dirty = true;
    if (appearance.value === "inherit") delete session.draft.mode; else session.draft.mode = appearance.value;
    mode.value = activeMode(); preview();
  });
  colorsButton.addEventListener("click", () => showPage("colors"));
  back.addEventListener("click", () => {
    const part = session?.pickerPart, destination = session?.page === "picker" ? "colors" : "appearance";
    showPage(destination);
    if (destination === "colors") fields.get(part)?.color.focus();
  });
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
