/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu */
(function verifyFluxionFrame(window) {
  "use strict";
  if (Services.env.get("FLUXION_FRAME_TEST") !== "1") return;
  const prefix = "fluxion.frame.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const driver = Services.env.get("FLUXION_FRAME_DRIVER_DIR");
  const report = {
    keyboard: "native macOS System Events Cmd-W, Cmd-Shift-T, Cmd-L and Escape",
    pointer: "Gecko Window.synthesizeMouseEvent input routing; no OS pointer movement claimed",
    fullscreenTested: false, checks: [], captures: [], geometry: [], keys: [],
  };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const near = (a, b) => Math.abs(a - b) < 1.5;
  function nativeFullscreenEdgePoint(box, scale) {
    assert(Number.isFinite(scale) && scale > 0 && box.width > 0 && box.height > 0,
      "Fullscreen edge has invalid device-pixel geometry");
    // SynthesizeMouseEvent rounds CSS coordinates to device pixels. At 1x,
    // the midpoint of Gecko's [0,1)px toggler rounds OUTSIDE it to y=1.
    const x = Math.round((box.left + box.width / 2) * scale) / scale;
    const y = Math.ceil(box.top * scale) / scale;
    assert(x >= box.left && x < box.right && y >= box.top && y < box.bottom,
      "Fullscreen edge has no addressable device pixel");
    return { x, y };
  }
  async function settleFullscreenPresentation(fullscreen) {
    const started = window.performance.now();
    let previous = "", stableSince = started, last;
    await wait(() => {
      last = { fullscreen: window.fullScreen, width: window.outerWidth, height: window.outerHeight,
        innerWidth: window.innerWidth, innerHeight: window.innerHeight, x: window.screenX, y: window.screenY };
      const signature = JSON.stringify(last), now = window.performance.now();
      if (signature !== previous) { previous = signature; stableSince = now; }
      return last.fullscreen === fullscreen && now - stableSince >= 1000 && document.hasFocus() &&
        Services.focus.activeWindow === window && !window.windowUtils.isMozAfterPaintPending &&
        !window.windowUtils.isCompositorPaused && !window.windowUtils.isWindowFullyOccluded;
    }, "Native fullscreen presentation did not settle with active, painted, stable geometry", 15000);
    // Cocoa reports the fullscreen size on its initial resize, before the OS
    // crossfade finishes. Stable DOM flags alone are not screenshot readiness.
    return { ...last, elapsed: window.performance.now() - started, stableForMs: window.performance.now() - stableSince,
      pendingPaint: window.windowUtils.isMozAfterPaintPending, compositorPaused: window.windowUtils.isCompositorPaused,
      fullyOccluded: window.windowUtils.isWindowFullyOccluded };
  }
  function sidebarSurfaceEvidence(surface, mode) {
    const style = window.getComputedStyle(surface);
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius,
      style.borderBottomRightRadius, style.borderBottomLeftRadius];
    const expected = mode === "revealed" ? "8px" : "0px";
    assert(radii.every(radius => radius === expected),
      `Sidebar ${mode} surface has unexpected corner radii: ${JSON.stringify(radii)}`);
    if (mode === "revealed") {
      // Split shadows without splitting the commas inside computed rgb().
      const shadows = style.boxShadow.split(/,(?![^()]*\))/).map(value => value.trim());
      const inset = shadows.filter(value => /\binset\b/.test(value));
      const exterior = shadows.filter(value => !/\binset\b/.test(value));
      assert(shadows.length === 2 && inset.length === 1 && /\b0px 0px 0px 1px\b/.test(inset[0]),
        `Revealed sidebar is missing its one-pixel inset outline: ${style.boxShadow}`);
      assert(exterior.length === 1 && /\b4px 0px 12px 0px\b/.test(exterior[0]) &&
        /rgba\(0,\s*0,\s*0,\s*0\.14\)/.test(exterior[0]),
      `Revealed sidebar exterior shadow is not the restrained neutral shadow: ${style.boxShadow}`);
    } else {
      assert(style.boxShadow === "none", `Expanded sidebar must remain flush and unshadowed: ${style.boxShadow}`);
    }
    return { mode, radii, boxShadow: style.boxShadow };
  }
  const rect = node => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  function pageCornerEvidence(browser, label) {
    const stack = browser.closest(".browserStack"), container = browser.closest(".browserContainer");
    assert(stack && container, "Native webpage stack is missing");
    const style = window.getComputedStyle(stack), radii = [style.borderTopLeftRadius, style.borderTopRightRadius,
      style.borderBottomRightRadius, style.borderBottomLeftRadius];
    assert(radii.every(radius => radius === "8px") && style.overflowX === "clip" && style.overflowY === "clip",
      `Native webpage has square or unclipped corners: ${label}`);
    const box = rect(browser), center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    assert(browser === center || browser.contains(center), `Page center is obscured: ${label}`);
    const corner = document.elementFromPoint(box.left + .5, box.top + .5);
    assert(corner !== browser && !browser.contains(corner), `Remote content escapes the rounded top-left clip: ${label}`);
    return { label, radii, overflow: [style.overflowX, style.overflowY], page: box,
      cornerHit: corner?.id || corner?.localName, backdrop: window.getComputedStyle(container).backgroundColor };
  }
  function persistentSidebarEvidence(flow, label) {
    const root = document.documentElement, surface = flow.querySelector(".fluxion-surface");
    const rail = rect(flow), box = rect(surface), toolbox = rect(document.getElementById("navigator-toolbox"));
    const target = rect(document.getElementById("nav-bar-customization-target"));
    const rtl = window.getComputedStyle(flow).direction === "rtl";
    const wanted = Math.max(0, rtl ? target.right - rail.left : rail.right - target.left);
    const available = Math.max(0, target.width - 480);
    const fallback = available + 1 < wanted || root.hasAttribute("customizing");
    let expectedTop = fallback ? Math.max(6, toolbox.bottom) : 6;
    const captions = [];
    for (const buttons of document.querySelectorAll("#navigator-toolbox .titlebar-buttonbox")) {
      const caption = rect(buttons), style = window.getComputedStyle(buttons);
      if (caption.width <= 0 || caption.height <= 0 || caption.bottom <= 0 || style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") continue;
      const hit = document.elementFromPoint(caption.left + caption.width / 2, caption.top + caption.height / 2);
      assert(hit === buttons || buttons.contains(hit), `${label}: native window-button hit area is covered`);
      captions.push(caption);
      if (!fallback && caption.right > rail.left && caption.left < rail.right) expectedTop = Math.max(expectedTop, caption.bottom + 6);
    }
    assert(near(box.top, Math.ceil(expectedTop)) && near(box.bottom, window.innerHeight),
      `${label}: persistent sidebar retains a navigation-sized gap or incorrect bottom inset: ${JSON.stringify({ box, expectedTop })}`);
    assert(near(box.width, rail.width) && near(rtl ? box.right : box.left, rtl ? rail.right : rail.left),
      `${label}: persistent sidebar lost its page-column alignment`);
    let heading = null;
    if (flow.dataset.state === "expanded") {
      const node = surface.querySelector(".fluxion-workspace-heading"); heading = rect(node);
      assert(near(heading.top - box.top, 6), `${label}: expanded heading lost its six-pixel top padding`);
      const hit = document.elementFromPoint(heading.left + heading.width / 2, heading.top + heading.height / 2);
      assert(hit === node || node.contains(hit), `${label}: expanded workspace heading is covered by native toolbar padding`);
    }
    const navigation = ["back-button", "forward-button", "reload-button"].map(id => navigationControlHitEvidence(document.getElementById(id)));
    return { label, rail, surface: box, heading, captions, fallback, direction: rtl ? "rtl" : "ltr", navigation };
  }

  function sidebarMotionEvidence(surface, revealed) {
    const style = window.getComputedStyle(surface);
    const properties = style.transitionProperty.split(",").map(value => value.trim());
    const durations = style.transitionDuration.split(",").map(value => parseFloat(value));
    const delays = style.transitionDelay.split(",").map(value => parseFloat(value));
    const reduced = document.documentElement.hasAttribute("data-fluxion-no-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      assert(durations.every(value => value <= .00001) && delays.every(value => value === 0),
        "Reduced motion retained a delayed or animated sidebar retract");
    } else {
      const index = properties.indexOf("visibility");
      assert(index >= 0 && durations[index % durations.length] === 0 &&
        delays[index % delays.length] === (revealed ? 0 : .14),
      "Sidebar visibility must reveal immediately and hide only after its 140ms retract");
      assert(properties.includes("transform") && properties.includes("opacity"), "Sidebar retract has no painted transform/opacity transition");
    }
    if (!revealed) assert(style.pointerEvents === "none", "Retracting sidebar still intercepts webpage input");
    return { revealed, reduced, properties, durations, delays };
  }
  const routePointer = (x, y, type = "mousemove", buttons = 0) => {
    assert(typeof window.synthesizeMouseEvent === "function", "Gecko native widget input router is unavailable");
    window.synthesizeMouseEvent(type, x, y, {
      identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons,
      clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
    }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
  };
  const clickControl = node => {
    const box = rect(node), x = box.left + box.width / 2, y = box.top + box.height / 2;
    assert(box.width >= 24 && box.height >= 24 && node.contains(document.elementFromPoint(x, y)), "Routed control is clipped or obscured");
    routePointer(x, y); routePointer(x, y, "mousedown", 1); routePointer(x, y, "mouseup", 0);
  };
  function clickNativePage(browser) {
    const box = rect(browser), x = box.right - 60, y = box.top + Math.min(160, box.height / 2);
    const hit = document.elementFromPoint(x, y);
    assert(box.width > 120 && box.height > 0 && (hit === browser || browser.contains(hit)),
      "Native page focus-transfer target is obscured");
    routePointer(x, y); routePointer(x, y, "mousedown", 1); routePointer(x, y, "mouseup", 0);
    return { x, y, hit: hit?.id || hit?.localName };
  }
  const rows = () => [...document.querySelectorAll(".fluxion-tab")];
  const rowFor = tab => rows().find(row => row._fluxionTab === tab);
  const liveTabs = () => [...gBrowser.tabs].filter(tab => !tab.closing);
  let pointerMoves = 0;
  const diagnosticListeners = [];
  const onPointerMove = () => { pointerMoves++; };
  const onKey = event => {
    if (event.metaKey && ["w", "t"].includes(event.key?.toLowerCase())) {
      report.keys.push({ key: event.key, meta: event.metaKey, shift: event.shiftKey,
        alt: event.altKey, control: event.ctrlKey, repeat: event.repeat, trusted: event.isTrusted });
    }
  };
  const stage = value => {
    Services.prefs.setStringPref(`${prefix}.stage`, value);
    Services.prefs.savePrefFile(null);
  };
  async function action(name) {
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native driver did not acknowledge ${name}`, 20000);
  }
  function floatingSidebarEvidence(flow, surface, revealed) {
    const rail = rect(flow), box = rect(surface), style = window.getComputedStyle(surface);
    const viewport = { top: 0, bottom: window.innerHeight };
    const rtl = window.getComputedStyle(flow).direction === "rtl";
    if (revealed) {
      assert(style.visibility === "visible" && !surface.inert && style.pointerEvents !== "none",
        "Floating sidebar is not visible and interactive after reveal");
      const inlineInset = rtl ? rail.right - box.right : box.left - rail.left;
      assert(near(inlineInset, 6) && near(box.top - viewport.top, 6) && near(viewport.bottom - box.bottom, 6),
        `Floating sidebar does not retain six-pixel viewport side/top/bottom clearance: ${JSON.stringify({ rail, box, viewport, inlineInset })}`);
      const heading = surface.querySelector(".fluxion-workspace-heading");
      assert(heading && near(rect(heading).top - box.top, 6), "Floating sidebar heading does not have six-pixel top padding");
    } else {
      assert(style.visibility === "hidden" && surface.inert && style.pointerEvents === "none",
        "Hidden sidebar retains a painted or interactive rounded-corner sliver");
      assert(rtl ? box.left >= rail.right - 1 : box.right <= rail.left + 1,
        `Hidden sidebar has not moved fully beyond the window edge: ${JSON.stringify({ rail, box })}`);
    }
    return { mode: revealed ? "floating-revealed-insets" : "floating-hidden-offscreen", rail, box, viewport,
      heading: revealed ? rect(surface.querySelector(".fluxion-workspace-heading")) : null,
      visibility: style.visibility, pointerEvents: style.pointerEvents, inert: surface.inert };
  }
  async function withSavedAutohideDisabled(check) {
    const name = "browser.fullscreen.autohide", prefs = Services.prefs;
    const hadUserValue = prefs.prefHasUserValue(name), original = prefs.getBoolPref(name);
    prefs.setBoolPref(name, false); prefs.savePrefFile(null);
    let changes = 0;
    const observer = { observe() { changes++; } };
    prefs.addObserver(name, observer);
    try {
      await check();
      assert(!prefs.getBoolPref(name) && prefs.prefHasUserValue(name) && changes === 0,
        "Fullscreen sidebar policy changed the user's saved autohide=false preference");
      return { value: false, hasUserValue: true, observedProductWrites: changes };
    } finally {
      prefs.removeObserver(name, observer);
      if (hadUserValue) prefs.setBoolPref(name, original);
      else prefs.clearUserPref(name);
      prefs.savePrefFile(null);
    }
  }
  function navigationControlHitEvidence(control) {
    const box = rect(control), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    assert(box.width >= 24 && box.height >= 24 && control.contains(hit),
      `Native navigation control is obscured by floating chrome: ${control.id}`);
    return { id: control.id, box, hit: hit?.id || hit?.localName };
  }
  function newTabGeometryEvidence(density, row, button, before) {
    const tab = rect(row), after = rect(button), style = window.getComputedStyle(button), tabStyle = window.getComputedStyle(row);
    const expected = { compact: 28, standard: 34, roomy: 36 }[density];
    assert(near(tab.height, expected) && near(after.height, expected) && near(after.width, tab.width) && near(after.left, tab.left),
      `New tab does not share normal ${density} tab geometry: ${JSON.stringify({ tab, after })}`);
    assert(["left", "top", "width", "height"].every(key => near(before[key], after[key])), "Hover changed New tab geometry");
    const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"];
    assert(corners.every(corner => style[corner] === tabStyle[corner]), "New tab hover radius differs from normal tabs");
    return { density, tab, before, after, radii: corners.map(corner => style[corner]) };
  }
  function nativeAddressEvidence(urlbar, field, revealed) {
    const box = rect(field), style = window.getComputedStyle(urlbar);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (revealed) {
      assert(Number(style.opacity) === 1 && style.pointerEvents !== "none" && urlbar.contains(hit),
        "Revealed Focus navigation did not restore the native top-layer address field");
    } else {
      assert(Number(style.opacity) === 0 && style.pointerEvents === "none" && !urlbar.contains(hit),
        "Hidden Focus navigation leaves Gecko's top-layer address bar painted or intercepting page input");
    }
    return { field: box, opacity: style.opacity, pointerEvents: style.pointerEvents,
      hit: hit?.id || hit?.localName, popover: urlbar.matches(":popover-open") };
  }
  function navigationMotionEvidence(toolbox, native, reduced) {
    const style = window.getComputedStyle(toolbox);
    const properties = style.transitionProperty.split(",").map(value => value.trim());
    const durations = style.transitionDuration.split(",").map(value => parseFloat(value));
    const property = native ? "margin-top" : "transform", index = properties.indexOf(property);
    if (reduced) assert(durations.every(value => value === 0), "Reduced motion retained navigation animation");
    else assert(index >= 0 && Math.abs(durations[index % durations.length] - .12) < .001,
      `Focus navigation did not use its scoped 120ms ${property} transition: ${style.transitionDuration}`);
    return { native, reduced, properties, durations };
  }
  async function verifyNavigationMotion(toolbox, native, retract = null) {
    const root = document.documentElement, name = "ui.prefersReducedMotion";
    const hadPreference = Services.prefs.prefHasUserValue(name), previous = Services.prefs.getIntPref(name, 0);
    const hadAttribute = root.hasAttribute("data-fluxion-no-motion"), evidence = [];
    try {
      root.removeAttribute("data-fluxion-no-motion"); Services.prefs.setIntPref(name, 0);
      await wait(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches, "Normal motion media override did not settle");
      if (native) {
        assert(typeof retract === "function", "Native motion verification requires a real pointer retraction cycle");
        evidence.push({ source: "routed-pointer-cycle-after-normal-media", ...await retract() });
      }
      assert(!native || toolbox.hasAttribute("fullscreenShouldAnimate"), "Native Focus animation attribute was not produced by actual retraction");
      evidence.push(navigationMotionEvidence(toolbox, native, false));
      root.setAttribute("data-fluxion-no-motion", "true");
      evidence.push({ source: "browser-motion-attribute", ...navigationMotionEvidence(toolbox, native, true) });
      root.removeAttribute("data-fluxion-no-motion"); Services.prefs.setIntPref(name, 1);
      await wait(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, "Reduced motion media override did not settle");
      evidence.push({ source: "Gecko-system-media-test-override", ...navigationMotionEvidence(toolbox, native, true) });
    } finally {
      if (hadPreference) Services.prefs.setIntPref(name, previous); else Services.prefs.clearUserPref(name);
      root.toggleAttribute("data-fluxion-no-motion", hadAttribute);
    }
    return evidence;
  }

  async function readyPageCapture() {
    const browser = gBrowser.selectedBrowser, global = browser.browsingContext.currentWindowGlobal;
    assert(global?.documentURI.spec === "https://example.org/" && !gBrowser.selectedTab.hasAttribute("busy"),
      "Expanded screenshot target is not the completed HTTPS fixture");
    const box = rect(browser);
    const bitmap = await global.drawSnapshot(new window.DOMRect(0, 0, box.width, box.height), 1, "#ffffff");
    let pixels;
    try {
      const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0);
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      pixels = 0;
      for (let index = 0; index < bytes.length; index += 4) {
        if (Math.abs(bytes[index] - bytes[0]) + Math.abs(bytes[index + 1] - bytes[1]) + Math.abs(bytes[index + 2] - bytes[2]) > 48) pixels++;
      }
      assert(pixels > 100, "Remote screenshot fixture has no painted page content");
    } finally { bitmap.close(); }
    await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    await wait(() => !window.windowUtils.isMozAfterPaintPending && !window.windowUtils.isCompositorPaused &&
      !window.windowUtils.isWindowFullyOccluded && document.hasFocus(), "Screenshot compositor did not settle after remote page paint");
    return { global: global.innerWindowId, distinctContentPixels: pixels, page: box };
  }

  async function focusNavigation() {
    stage("native-focus-navigation");
    const controller = window.FluxionFocusMode, toolbox = document.getElementById("navigator-toolbox");
    const edge = document.getElementById("fluxion-navigation-edge"), nav = document.getElementById("nav-bar");
    assert(controller && toolbox && edge && nav && controller.state().enabled, "Focus navigation modules are unavailable");
    const evidence = report.focusNavigation = { keys: [], geometry: [], captures: [] };
    const page = () => rect(gBrowser.selectedBrowser);
    const baseline = page();
    const unchangedPage = label => {
      const current = page(); evidence.geometry.push({ label, page: current, toolbox: rect(toolbox) });
      assert(["left", "top", "width", "height"].every(key => near(current[key], baseline[key])),
        `Focus navigation ${label} reflowed the webpage`);
    };
    const hidden = async label => {
      await wait(() => !controller.state().revealed && Number(window.getComputedStyle(toolbox).opacity) === 0 &&
        rect(toolbox).bottom <= 1, `Focus navigation did not move fully offscreen: ${label}`);
      assert(window.getComputedStyle(toolbox).pointerEvents === "none", "Hidden navigation intercepts webpage input");
      const urlbar = document.getElementById("urlbar"), field = document.querySelector("#urlbar > .urlbar-input-container");
      evidence.geometry.push({ label: `${label}-native-address-top-layer`, ...nativeAddressEvidence(urlbar, field, false) });
      unchangedPage(label);
    };
    const shown = async label => {
      await wait(() => controller.state().revealed && Number(window.getComputedStyle(toolbox).opacity) === 1 &&
        rect(toolbox).top >= -1, `Focus navigation did not reveal: ${label}`);
      const navigation = rect(nav), field = rect(document.querySelector("#urlbar > .urlbar-input-container"));
      evidence.geometry.push({ label: `${label}-native-address-top-layer`, ...nativeAddressEvidence(
        document.getElementById("urlbar"), document.querySelector("#urlbar > .urlbar-input-container"), true) });
      assert(near(field.height, 32) && near(field.top - navigation.top, 6) && near(navigation.bottom - field.bottom, 6),
        "Focus navigation changed the normal address field height or balanced padding");
      unchangedPage(label);
    };
    const moveToPage = () => routePointer(baseline.right - 60, baseline.top + Math.min(150, baseline.height / 2));
    const clickPage = () => {
      const x = baseline.right - 60, y = baseline.top + Math.min(150, baseline.height / 2);
      routePointer(x, y); routePointer(x, y, "mousedown", 1); routePointer(x, y, "mouseup", 0);
    };
    const revealFromEdge = async label => {
      const box = rect(edge);
      assert(near(box.height, 4) && box.width > 200, "Focus navigation has no usable four-pixel top reveal target");
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      assert(edge.contains(document.elementFromPoint(x, y)), "Focus navigation top edge is obscured");
      routePointer(x, y);
      await shown(label);
    };
    const capture = async name => { await action(name); evidence.captures.push(name); };
    const onKey = event => {
      if ((event.metaKey && event.key.toLowerCase() === "l") || event.key === "Escape") {
        evidence.keys.push({ key: event.key, trusted: event.isTrusted, meta: event.metaKey, shift: event.shiftKey,
          alt: event.altKey, control: event.ctrlKey });
      }
    };
    window.addEventListener("keydown", onKey, true);
    try {
      gBrowser.selectedBrowser.focus(); moveToPage();
      await hidden("initial-hidden");
      evidence.motion = await verifyNavigationMotion(toolbox, false);
      await capture("capture-focus-navigation-hidden");
      await revealFromEdge("top-edge-hover");
      await capture("capture-focus-navigation-revealed");
      moveToPage(); await hidden("pointer-left");
      await action("focus-location");
      await wait(() => evidence.keys.some(key => key.key.toLowerCase() === "l" && key.trusted && key.meta &&
        !key.shift && !key.alt && !key.control) && document.activeElement === window.gURLBar.inputField,
      "Native Cmd-L did not focus the hidden address bar");
      await shown("native-cmd-l");
      moveToPage(); await delay(250);
      assert(controller.state().revealed && document.activeElement === window.gURLBar.inputField,
        "Pointer exit hid keyboard-owned address input");
      await action("focus-location-escape");
      await wait(() => !window.gURLBar.view.isOpen && evidence.keys.some(key => key.key === "Escape" && key.trusted),
        "Native Escape did not dismiss address suggestions");
      if (document.activeElement === window.gURLBar.inputField) assert(controller.state().revealed, "Focused address input hid after Escape");
      clickPage(); await hidden("page-click-after-cmd-l");
      await revealFromEdge("identity-popup-anchor");
      // Gecko155's Trust Panel replaces the legacy identity button on HTTPS.
      // Choose the actual painted native security entry, without changing its feature gate.
      const identity = ["trust-icon-container", "identity-icon-box"].map(id => document.getElementById(id)).find(node => {
        if (!node) return false;
        const box = rect(node), style = window.getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility === "visible";
      });
      assert(identity, "Native HTTPS identity control is missing");
      const identityBox = rect(identity), identityX = identityBox.left + identityBox.width / 2,
        identityY = identityBox.top + identityBox.height / 2;
      assert(identityBox.width > 0 && identityBox.height > 0 && identity.contains(document.elementFromPoint(identityX, identityY)),
        "Native HTTPS identity control is clipped or obscured");
      routePointer(identityX, identityY); routePointer(identityX, identityY, "mousedown", 1); routePointer(identityX, identityY, "mouseup", 0);
      const popupId = identity.id === "trust-icon-container" ? "trustpanel-popup" : "identity-popup";
      await wait(() => document.getElementById(popupId)?.state === "open", "Real HTTPS identity popup did not open");
      const popup = document.getElementById(popupId);
      moveToPage(); await delay(300);
      await shown("identity-popup-held-open");
      assert(popup.state === "open", "Leaving navigation dismissed the native identity popup");
      evidence.identity = { id: popupId, anchorId: identity.id, state: popup.state, panel: rect(popup), anchor: rect(identity) };
      await capture("capture-focus-navigation-security");
      await action("focus-identity-escape");
      await wait(() => popup.state === "closed", "Native Escape did not close the identity popup");
      clickPage(); await hidden("page-click-after-identity");
      assert(evidence.keys.filter(key => key.key.toLowerCase() === "l" && key.trusted && key.meta).length === 1,
        "Focus navigation fixture did not receive exactly one trusted native Cmd-L");
      report.checks.push("focus-top-edge-navigation-reveal-without-page-reflow", "native-cmd-l-reveals-hidden-navigation-and-retains-keyboard-focus",
        "native-security-popup-retains-navigation-until-dismissed");
    } finally { window.removeEventListener("keydown", onKey, true); }
  }
  async function run() {
    assert(/\/fluxion-frame-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Frame fixture requires an isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Frame driver must belong to the isolated profile");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionUI && window.FluxionTheme && document.getElementById("fluxion-settings"), "Frame modules did not initialize");
    const ui = window.FluxionUI;
    const flow = document.getElementById("fluxion-flow");
    const browser = document.getElementById("browser");
    const deck = document.getElementById("tabbrowser-tabbox");
    ui.setSidebarState("expanded");
    window.FluxionSidebarWidth?.setWidth(232);
    await action("foreground");
    await wait(() => Services.focus.activeWindow === window, "Frame browser did not become the native foreground window");
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("keydown", onKey, true);
    const add = url => {
      const tab = gBrowser.addTrustedTab(url, { skipAnimation: true });
      ui.setTabWorkspace(tab, ui.currentWorkspace());
      return tab;
    };
    const select = async tab => {
      ui.selectTab(tab);
      await wait(() => gBrowser.selectedTab === tab && rowFor(tab)?.getAttribute("aria-selected") === "true", "Selected native tab did not match its Flow row");
      rowFor(tab).focus();
      await wait(() => document.activeElement === rowFor(tab), "Flow row did not receive keyboard focus");
    };
    const survivor = add("about:blank?fluxion-frame=survivor");
    const closing = add("about:blank?fluxion-frame=keyboard-close");
    await select(closing);
    await wait(() => closing.linkedBrowser.currentURI.spec === "about:blank?fluxion-frame=keyboard-close" && !closing.hasAttribute("busy"),
      "Keyboard close fixture navigation did not settle");
    stage("ordinary-native-keyboard-close");
    const oldRow = rowFor(closing), before = liveTabs(), beforeMoves = pointerMoves;
    await action("close-ordinary");
    await wait(() => !closing.parentNode && !oldRow.isConnected && !rowFor(closing), "Cmd-W left the closed native tab's Flow row visible");
    assert(liveTabs().length === before.length - 1 && before.filter(tab => tab !== closing).every(tab => tab.parentNode && !tab.closing), "Cmd-W closed an unintended tab");
    assert(pointerMoves === beforeMoves, "Pointer moved during the stationary Cmd-W fixture");
    await action("restore-ordinary");
    await wait(() => liveTabs().length === before.length && gBrowser.selectedBrowser.currentURI.spec === "about:blank?fluxion-frame=keyboard-close" && rowFor(gBrowser.selectedTab)?.isConnected,
      "Cmd-Shift-T did not restore the closed native tab and Flow row");
    report.checks.push("stationary-native-cmd-w-removes-row-and-cmd-shift-t-restores");

    stage("native-pointer-close-without-movement");
    const pointerTab = add("about:blank?fluxion-frame=pointer-close");
    const following = add("about:blank?fluxion-frame=following");
    await select(pointerTab);
    rowFor(following).scrollIntoView({ block: "nearest" });
    await delay(250);
    const pointerRow = rowFor(pointerTab), nextRow = rowFor(following);
    const close = pointerRow.querySelector(".fluxion-close"), closeRect = rect(close);
    assert(closeRect.width > 0 && closeRect.height > 0, "Pointer close control has no hit area");
    const x = closeRect.left + closeRect.width / 2, y = closeRect.top + closeRect.height / 2;
    const nextTop = rect(nextRow).top;
    report.pointerHoldEvents = [];
    const observe = (target, type, options) => {
      const listener = event => {
        if (report.pointerHoldEvents.length >= 80) return;
        report.pointerHoldEvents.push({ type, target: event.target?.id || event.target?.className || event.target?.localName || "window",
          trusted: event.isTrusted, detail: event.detail, x: event.clientX, y: event.clientY,
          related: event.relatedTarget?.id || event.relatedTarget?.className || event.relatedTarget?.localName || "",
          active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.localName,
          activeLocalName: document.activeElement?.localName, activeWindow: Services.focus.activeWindow === window,
          targetIsWindow: event.target === window,
          rowConnected: pointerRow.isConnected, rowClass: pointerRow.className, nextTop: rect(nextRow).top,
          at: window.performance.now() });
      };
      target.addEventListener(type, listener, options);
      diagnosticListeners.push(() => target.removeEventListener(type, listener, options));
    };
    observe(close, "click", true);
    observe(flow, "pointerleave", false);
    observe(flow.querySelector(".fluxion-tab-scroll"), "scroll", { passive: true });
    observe(window, "blur", false);
    report.pointerHoldStart = { closeRect, nextTop, flow: rect(flow), x, y };
    const mouse = (type, buttons) => routePointer(x, y, type, buttons);
    mouse("mousemove", 0); mouse("mousedown", 1); mouse("mouseup", 0);
    const closeStarted = window.performance.now(), stationaryMoves = pointerMoves;
    report.pointerHoldAfterClick = { connected: pointerRow.isConnected, className: pointerRow.className,
      nextTop: rect(nextRow).top, nativeConnected: Boolean(pointerTab.parentNode) };
    await wait(() => !pointerTab.parentNode, "Routed pointer close did not close its native tab");
    report.pointerHoldAfterNativeClose = { connected: pointerRow.isConnected, className: pointerRow.className,
      nextConnected: nextRow.isConnected, nextTop: rect(nextRow).top, initialNextTop: nextTop, pointerMoves };
    await wait(() => !pointerRow.isConnected && nextRow.isConnected && rect(nextRow).top < nextTop - 10,
      "Pointer close left a gap above the following tab without mouse movement", 500);
    assert(pointerMoves === stationaryMoves, "Pointer moved before the following row settled");
    report.pointerCloseSettled = { elapsed: window.performance.now() - closeStarted,
      previousTop: nextTop, nextTop: rect(nextRow).top, pointerMoves };
    const heldMoves = pointerMoves;
    const keyboardTab = gBrowser.selectedTab;
    assert(keyboardTab !== pointerTab && keyboardTab.parentNode, "Pointer closure did not select a surviving tab");
    const keyboardRow = rowFor(keyboardTab), heldBefore = liveTabs();
    assert(keyboardRow, "Selected surviving tab has no Flow row");
    keyboardRow.focus();
    await action("close-after-pointer");
    await wait(() => !keyboardTab.parentNode && !keyboardRow.isConnected && !pointerRow.isConnected,
      "Cmd-W after pointer close left closed rows visible");
    assert(pointerMoves === heldMoves, "Pointer moved during the subsequent keyboard close fixture");
    assert(liveTabs().length === heldBefore.length - 1 && heldBefore.filter(tab => tab !== keyboardTab).every(tab => tab.parentNode && !tab.closing), "Keyboard close after pointer close closed an extra tab");
    assert(survivor.parentNode, "The protected survivor was unexpectedly closed");
    const trustedCommand = key => key.trusted && key.meta && !key.alt && !key.control && !key.repeat;
    const closes = report.keys.filter(key => key.key.toLowerCase() === "w" && !key.shift && trustedCommand(key));
    const restores = report.keys.filter(key => key.key.toLowerCase() === "t" && key.shift && trustedCommand(key));
    assert(report.keys.length === 3 && closes.length === 2 && restores.length === 1,
      `Native keyboard event evidence is incomplete or contains extra commands: ${JSON.stringify(report.keys)}`);
    report.nativeKeyCounts = { close: closes.length, restore: restores.length, total: report.keys.length };
    report.checks.push("pointer-close-compresses-following-row-without-motion-and-subsequent-native-keyboard-close-remains-correct");

    stage("real-page-and-frame-geometry");
    const webpage = add("https://example.org/");
    await select(webpage);
    await wait(() => webpage.linkedBrowser.currentURI.spec === "https://example.org/" && !webpage.hasAttribute("busy") && webpage.label === "Example Domain",
      "Real HTTPS example.org page did not finish loading", 35000);
    const gap = mode => {
      const outer = rect(browser), sidebar = rect(flow), page = rect(deck);
      const values = { start: page.left - sidebar.right, end: outer.right - page.right,
        top: page.top - outer.top, bottom: outer.bottom - page.bottom };
      assert(Object.values(values).every(value => near(value, 4)), `Frame inset is not a consistent four pixels in ${mode}: ${JSON.stringify(values)}`);
      assert(page.width > 200 && page.height > 100, "Frame squeezed the page below a usable size");
      report.geometry.push({ mode, outer, sidebar, page, gaps: values });
    };
    const workspaceControls = (mode, visible) => {
      const list = flow.querySelector(".fluxion-workspace-list");
      const orientation = mode === "compact" ? "vertical" : "horizontal";
      assert(list?.getAttribute("aria-orientation") === orientation &&
        window.getComputedStyle(list).flexDirection === (mode === "compact" ? "column" : "row"),
      `Workspace keyboard orientation disagrees with its visible ${mode} layout`);
      const button = flow.querySelector(".fluxion-workspaces > .fluxion-icon-button");
      const label = mode === "expanded" ? "Collapse sidebar" : "Expand sidebar";
      assert(button?.getAttribute("aria-label") === label && button.title.startsWith(`${label} (`),
        `Sidebar toggle lacks its actionable ${mode} accessible name or shortcut hint`);
      if (visible) {
        const box = rect(button), surface = rect(flow.querySelector(".fluxion-surface"));
        assert(box.width >= 24 && box.height >= 24 && box.left >= surface.left - 1 && box.right <= surface.right + 1 &&
          box.top >= surface.top - 1 && box.bottom <= surface.bottom + 1 &&
          button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
        `Sidebar toggle is clipped, hidden, or has an insufficient hit area in ${mode}`);
        const dock = rect(flow.querySelector(".fluxion-workspaces"));
        assert(near(dock.bottom, surface.bottom), `Workspace dock is not anchored to the bottom in ${mode}`);
        for (const workspace of list.querySelectorAll(".fluxion-workspace")) {
          assert(workspace.getAttribute("aria-label") && workspace.querySelector("svg"), "Workspace symbol lost its accessible name or vector icon");
          for (const name of workspace.querySelectorAll(".fluxion-workspace-name")) {
            assert(window.getComputedStyle(name).display === "none" || rect(name).width === 0,
              `Workspace dock is not icon-only in ${mode}`);
          }
        }
      }
    };
    for (const [mode, expected] of [["expanded", 232], ["compact", 44], ["focus", 3]]) {
      ui.setSidebarState(mode);
      await wait(() => near(rect(flow).width, expected), `Sidebar ${mode} geometry did not settle`);
      await delay(200);
      gap(mode);
      workspaceControls(mode, mode !== "focus");
      if (mode === "expanded") report.geometry.push(persistentSidebarEvidence(flow, `persistent-${mode}`));
      if (mode === "expanded") report.geometry.push(sidebarSurfaceEvidence(flow.querySelector(".fluxion-surface"), "expanded"));
    }
    const savedWindowSize = { width: window.outerWidth, height: window.outerHeight };
    const root = document.documentElement;
    const savedDirection = { attribute: root.getAttribute("chromedir"), value: root.style.getPropertyValue("direction"), priority: root.style.getPropertyPriority("direction") };
    try {
      ui.setSidebarState("expanded");
      window.resizeTo(640, savedWindowSize.height);
      await wait(() => near(rect(flow).width, 232) && window.outerWidth <= 700, "Narrow persistent-sidebar fixture did not resize");
      await delay(250);
      const narrow = persistentSidebarEvidence(flow, "persistent-expanded-narrow");
      assert(narrow.fallback, "Narrow fixture did not exercise native-navigation fallback");
      report.geometry.push(narrow);
      window.resizeTo(savedWindowSize.width, savedWindowSize.height);
      await wait(() => near(window.outerWidth, savedWindowSize.width), "Persistent-sidebar fixture did not restore window width");
      root.setAttribute("chromedir", "rtl"); root.style.setProperty("direction", "rtl", "important");
      window.FluxionChromeLayout.refresh();
      await delay(250);
      const rtl = persistentSidebarEvidence(flow, "persistent-expanded-rtl");
      assert(rtl.direction === "rtl" && !rtl.fallback, "Wide RTL fixture did not reclaim its sidebar header gap");
      report.geometry.push(rtl);
    } finally {
      if (savedDirection.attribute === null) root.removeAttribute("chromedir"); else root.setAttribute("chromedir", savedDirection.attribute);
      if (savedDirection.value) root.style.setProperty("direction", savedDirection.value, savedDirection.priority); else root.style.removeProperty("direction");
      window.resizeTo(savedWindowSize.width, savedWindowSize.height);
      ui.setSidebarState("focus"); window.FluxionChromeLayout.refresh();
    }
    await delay(250);
    report.checks.push("persistent-sidebar-heading-reclaims-navigation-gap-with-caption-hit-areas-narrow-fallback-and-rtl-alignment");
    stage("routed-edge-hover-and-sidebar-toggle");
    report.hoverEvents = [];
    for (const type of ["pointerenter", "pointerleave"]) {
      const handler = event => report.hoverEvents.push({ type, trusted: event.isTrusted, x: event.clientX, y: event.clientY });
      flow.addEventListener(type, handler);
      diagnosticListeners.push(() => flow.removeEventListener(type, handler));
    }
    const surface = flow.querySelector(".fluxion-surface");
    const pageBefore = rect(gBrowser.tabpanels);
    const outside = { x: rect(deck).right - 20, y: rect(deck).top + 60 };
    // Move away before approaching the three-pixel edge so native hit testing,
    // not a direct call to revealSidebar(), owns every enter/leave transition.
    gBrowser.selectedBrowser.focus();
    routePointer(outside.x, outside.y);
    await delay(250);
    for (let cycle = 0; cycle < 3; cycle++) {
      const edge = rect(flow);
      routePointer(edge.left + edge.width / 2, edge.top + Math.min(140, edge.height / 2));
      await wait(() => flow.dataset.revealed === "true" && !surface.inert, `Edge hover did not reveal sidebar on cycle ${cycle}`);
      await delay(200);
      workspaceControls("focus", true);
      const appearance = sidebarSurfaceEvidence(surface, "revealed");
      report.geometry.push(sidebarMotionEvidence(surface, true));
      const floating = floatingSidebarEvidence(flow, surface, true);
      const pageAfter = rect(gBrowser.tabpanels);
      assert(["left", "top", "width", "height"].every(key => near(pageBefore[key], pageAfter[key])), "Routed edge reveal reflowed page content");
      if (cycle === 0) {
        report.geometry.push(appearance);
        report.geometry.push(floating);
        await action("capture-sidebar-revealed");
        assert(flow.dataset.revealed === "true" && !surface.inert, "Sidebar hid before the revealed-state screenshot completed");
        report.captures.push({ name: "capture-sidebar-revealed", theme: window.FluxionTheme.current(),
          url: gBrowser.selectedBrowser.currentURI.spec, title: gBrowser.selectedTab.label });
      }
      if (cycle === 1) {
        const selected = rowFor(gBrowser.selectedTab);
        assert(selected, "Hover fixture lost the selected Flow row");
        clickControl(selected);
        await delay(100);
      }
      routePointer(outside.x, outside.y);
      await wait(() => flow.dataset.revealed === "false" && surface.inert, `Leaving the overlay did not hide sidebar on cycle ${cycle}`);
      report.geometry.push(sidebarMotionEvidence(surface, false));
      await delay(200);
      report.geometry.push(floatingSidebarEvidence(flow, surface, false));
    }
    assert(report.hoverEvents.filter(event => event.type === "pointerenter" && event.trusted).length >= 3 &&
      report.hoverEvents.filter(event => event.type === "pointerleave" && event.trusted).length >= 3,
    "Repeated edge hover lacks trusted Gecko routed enter/leave evidence");
    await focusNavigation();
    const toggle = flow.querySelector(".fluxion-workspaces > .fluxion-icon-button");
    ui.setSidebarState("compact");
    await wait(() => near(rect(flow).width, 44), "Compact sidebar did not settle before its expand click");
    await delay(200);
    clickControl(toggle);
    await wait(() => flow.dataset.state === "expanded" && near(rect(flow).width, 232), "Clicking expand in Compact hid the sidebar instead");
    await delay(200);
    clickControl(toggle);
    await wait(() => flow.dataset.state === "focus" && near(rect(flow).width, 3), "Primary collapse did not leave the hover edge");
    routePointer(outside.x, outside.y); await delay(250);
    const edge = rect(flow);
    routePointer(edge.left + edge.width / 2, edge.top + 100);
    await wait(() => flow.dataset.revealed === "true" && !surface.inert, "Collapsed sidebar did not return after a real edge approach");
    await delay(200);
    clickControl(toggle);
    await wait(() => near(rect(flow).width, 232), "Expanded sidebar did not return for captures");
    assert(flow.dataset.state === "expanded" && !surface.inert, "Expand left the sidebar surface hidden or inert");
    report.geometry.push(sidebarSurfaceEvidence(surface, "expanded-after-reveal"));
    report.checks.push("flush-expanded-sidebar-and-rounded-outlined-hover-overlay-with-real-capture");
    report.checks.push("expanded-compact-focus-consistent-insets-and-overlay-without-page-reflow");
    report.checks.push("routed-pointer-edge-reveal-three-cycles-and-compact-expand-never-hides");
    report.checks.push("bottom-symbol-workspace-dock-with-accessible-toggle-in-each-mode");
    stage("inline-new-tab-and-scroll-stable-workspace-dock");
    const scrollArea = flow.querySelector(".fluxion-tab-scroll");
    const tabTree = flow.querySelector(".fluxion-tabs:not(.fluxion-pinned-tabs)");
    const newTab = flow.querySelector(".fluxion-new-tab");
    const dock = flow.querySelector(".fluxion-workspaces");
    assert(scrollArea && scrollArea.contains(tabTree) && scrollArea.contains(newTab) && !scrollArea.contains(dock),
      "Tab list and inline new-tab control do not share a scroll area separate from the dock");
    const inlineGap = rect(newTab).top - rect(tabTree).bottom;
    assert(inlineGap >= -1 && inlineGap <= 16, `New tab is not immediately below the last tab: ${inlineGap}px`);
    stage("stationary-pointer-tail-close");
    const tail = add("about:blank?fluxion-frame=tail-close");
    await select(tail);
    const tailRow = rowFor(tail);
    tailRow.scrollIntoView({ block: "nearest" });
    await delay(200);
    assert(tabTree.querySelector(".fluxion-tab:last-child") === tailRow && tailRow.nextElementSibling === null,
      "Tail-close fixture does not own the final ordinary tab row");
    const tailBefore = liveTabs(), newTabBeforeTailClose = rect(newTab), tailStarted = window.performance.now();
    const tailClose = tailRow.querySelector(".fluxion-close"), tailCloseBox = rect(tailClose);
    const tailX = tailCloseBox.left + tailCloseBox.width / 2, tailY = tailCloseBox.top + tailCloseBox.height / 2;
    assert(tailCloseBox.width > 0 && tailCloseBox.height > 0 && tailClose.contains(document.elementFromPoint(tailX, tailY)),
      "Final tab close control is clipped or obscured");
    routePointer(tailX, tailY); routePointer(tailX, tailY, "mousedown", 1); routePointer(tailX, tailY, "mouseup", 0);
    const tailPointerMoves = pointerMoves;
    await wait(() => !tail.parentNode && !tailRow.isConnected && rect(newTab).top < newTabBeforeTailClose.top - 10,
      "Closing the final tab retained a safety gap above New tab beyond 500ms", 500);
    const tailElapsed = window.performance.now() - tailStarted;
    assert(pointerMoves === tailPointerMoves, "Pointer moved while testing stationary final-tab closure");
    assert(liveTabs().length === tailBefore.length - 1 && tailBefore.filter(tab => tab !== tail).every(tab => tab.parentNode && !tab.closing),
      "Closing the final tab affected another native tab");
    const tailTree = rect(tabTree), tailNewTab = rect(newTab);
    assert(tailNewTab.top >= tailTree.bottom - 1 && tailNewTab.top - tailTree.bottom <= 16,
      "New tab did not return immediately below the surviving tab list");
    report.geometry.push({ mode: "stationary-tail-close", elapsed: tailElapsed, before: newTabBeforeTailClose,
      after: tailNewTab, tree: tailTree, pointerMoves: tailPointerMoves });
    report.checks.push("stationary-pointer-final-tab-close-settles-new-tab-within-500ms-with-survivors-preserved");
    await select(webpage);
    stage("inline-new-tab-and-scroll-stable-workspace-dock");
    const dockBefore = rect(dock);
    const overflowTabs = Array.from({ length: Math.ceil(rect(scrollArea).height / 28) + 4 }, (_, index) =>
      add(`about:blank?fluxion-frame=overflow-${index}`));
    await wait(() => overflowTabs.every(tab => rowFor(tab)) && scrollArea.scrollHeight > scrollArea.clientHeight + 30,
      "Dense-tab fixture did not overflow its intended scroll area");
    newTab.scrollIntoView({ block: "nearest" }); await delay(200);
    const dockAfter = rect(dock), newTabRect = rect(newTab), lastRow = rect(rowFor(overflowTabs.at(-1)));
    assert(["left", "top", "width", "height"].every(key => near(dockBefore[key], dockAfter[key])), "Scrolling many tabs moved the workspace dock");
    assert(newTabRect.top >= lastRow.bottom - 1 && newTabRect.top - lastRow.bottom <= 24 &&
      newTabRect.bottom <= dockAfter.top + 1 && newTabRect.top >= rect(scrollArea).top - 1,
    "Inline new-tab control is not reachable immediately after the lowest tab when scrolling");
    assert(newTab.contains(document.elementFromPoint(newTabRect.left + newTabRect.width / 2, newTabRect.top + newTabRect.height / 2)),
      "Inline new-tab control is obscured at the end of a long tab list");
    const beforeNewTab = liveTabs();
    clickControl(newTab);
    await wait(() => liveTabs().length === beforeNewTab.length + 1 && !beforeNewTab.includes(gBrowser.selectedTab) &&
      rowFor(gBrowser.selectedTab)?.getAttribute("aria-selected") === "true",
    "Inline New tab did not create and select a real tab in the visible workspace");
    const createdTab = gBrowser.selectedTab;
    await select(webpage);
    gBrowser.removeTab(createdTab, { animate: false });
    gBrowser.removeTabs(overflowTabs, { animate: false });
    await wait(() => !createdTab.parentNode && !rowFor(createdTab) && overflowTabs.every(tab => !tab.parentNode && !rowFor(tab)),
      "Dense-tab fixture cleanup left stale Flow rows");
    scrollArea.scrollTop = 0; await delay(200);
    stage("normal-size-new-tab-hover");
    const previousDensity = Services.prefs.getStringPref("fluxion.tabs.density", "standard");
    try {
      for (const density of ["compact", "standard", "roomy"]) {
        ui.setTabDensity(density);
        await delay(250);
        routePointer(rect(deck).right - 20, rect(deck).top + 100);
        const before = rect(newTab), row = rowFor(webpage);
        assert(row, "New-tab density fixture lost its ordinary tab row");
        routePointer(before.left + before.width / 2, before.top + before.height / 2);
        await wait(() => newTab.matches(":hover"), "Gecko-routed pointer did not hover New tab");
        report.geometry.push({ mode: "new-tab-hover", ...newTabGeometryEvidence(density, row, newTab, before) });
      }
    } finally { ui.setTabDensity(previousDensity); }
    await delay(200);
    report.checks.push("new-tab-hover-matches-normal-tab-size-and-radius-in-all-three-densities");
    report.checks.push("inline-new-tab-follows-last-tab-and-bottom-workspace-dock-survives-scroll-overflow");
    stage("compact-dock-with-twelve-workspaces-in-short-window");
    const originalSize = { width: window.outerWidth, height: window.outerHeight };
    const originalWorkspace = ui.currentWorkspace();
    const addedWorkspaces = [];
    try {
      while (ui.workspaces().length < 12) {
        const workspace = ui.createWorkspace(`Frame dock ${addedWorkspaces.length + 1}`, { activate: false });
        assert(workspace, "Dense workspace fixture could not reach the supported twelve-workspace limit");
        addedWorkspaces.push(workspace);
      }
      ui.setSidebarState("compact");
      window.resizeTo(originalSize.width, Math.min(620, originalSize.height));
      await wait(() => near(rect(flow).width, 44) && rect(flow).height < 650 &&
        flow.querySelectorAll(".fluxion-workspace").length === 12, "Short-window compact workspace fixture did not settle");
      await delay(250);
      const workspaceList = flow.querySelector(".fluxion-workspace-list");
      const compactDock = rect(dock), compactSurface = rect(surface), compactScroll = rect(scrollArea);
      assert(compactDock.height <= compactSurface.height * .45 + 2 && near(compactDock.bottom, compactSurface.bottom),
        "Twelve-workspace Compact dock exceeded its bounded share of the sidebar or left the bottom edge");
      assert(compactScroll.height >= 120 && compactScroll.bottom <= compactDock.top + 1,
        "Dense Compact dock squeezed out or overlapped the actual tab scrolling area");
      assert(workspaceList.scrollHeight > workspaceList.clientHeight + 20,
        "Short-window workspace symbols did not establish an independently scrollable dock");
      const lastWorkspace = workspaceList.querySelector(".fluxion-workspace:last-child");
      lastWorkspace.focus({ preventScroll: true });
      lastWorkspace.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      await delay(200);
      const lastBox = rect(lastWorkspace), listBox = rect(workspaceList);
      assert(workspaceList.scrollTop > 0 && lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1 &&
        lastWorkspace.contains(document.elementFromPoint(lastBox.left + lastBox.width / 2, lastBox.top + lastBox.height / 2)),
      "The final workspace symbol is not reachable in a short Compact dock");
      workspaceControls("compact", true);
      report.geometry.push({ mode: "compact-twelve-workspaces-short-window", surface: compactSurface,
        dock: compactDock, tabs: compactScroll, workspaceList: listBox, lastWorkspace: lastBox,
        workspaceScrollTop: workspaceList.scrollTop });
      clickControl(toggle);
      await wait(() => flow.dataset.state === "expanded" && near(rect(flow).width, 232) && !surface.inert,
        "Dense Compact dock clipped or disabled the expand control");
      assert(ui.currentWorkspace() === originalWorkspace, "Scrolling the workspace dock unexpectedly switched workspaces");
      report.checks.push("twelve-workspace-short-window-dock-scrolls-with-visible-expand-and-usable-tabs");
    } finally {
      for (const workspace of addedWorkspaces) ui.deleteWorkspace(workspace.id, { confirm: false });
      ui.setSidebarState("expanded");
      window.resizeTo(originalSize.width, originalSize.height);
    }
    await wait(() => near(window.outerWidth, originalSize.width) && near(window.outerHeight, originalSize.height) &&
      addedWorkspaces.every(workspace => !ui.workspaces().some(item => item.id === workspace.id)),
    "Dense workspace fixture did not restore its original window and workspace state");
    await delay(250);
    const capture = async (name, theme) => {
      await window.FluxionTheme.set(theme);
      await wait(() => document.documentElement.dataset.fluxionTheme === theme, "Capture theme did not settle");
      await delay(350);
      if (name === "capture-page-light" || name === "capture-page-dark") {
        assert(flow.dataset.state === "expanded", "Expanded header screenshot is not in expanded mode");
        report.geometry.push(persistentSidebarEvidence(flow, name));
        report.geometry.push({ label: `${name}-paint-readiness`, ...await readyPageCapture() });
      }
      await action(name);
      report.captures.push({ name, theme, url: gBrowser.selectedBrowser.currentURI.spec, title: gBrowser.selectedTab.label });
    };
    await capture("capture-page-light", "light");
    await capture("capture-page-dark", "dark");
    const secondPage = add("https://example.com/");
    await wait(() => secondPage.linkedBrowser.currentURI.spec === "https://example.com/" &&
      !secondPage.hasAttribute("busy") && secondPage.label === "Example Domain",
    "Second real HTTPS page did not finish loading", 35000);
    const split = ui.createSplitView(webpage, secondPage);
    assert(split && webpage.splitview === split && secondPage.splitview === split && split.tabs.length === 2,
      "Real pages did not enter the same native split view");
    await wait(() => gBrowser.activeSplitView === split && split.panels.length === 2 &&
      Array.from(split.panels).every(panel => panel.classList.contains("split-view-panel-active") &&
        rect(panel).width > 100 && rect(panel).height > 100), "Both native split panels did not become visible");
    await delay(250);
    const [leftPane, rightPane] = Array.from(split.panels, rect);
    assert(rightPane.left >= leftPane.right && near(leftPane.top, rightPane.top), "Native side-by-side page panels overlap or are misaligned");
    report.geometry.push({ mode: "real-page-split", leftPane, rightPane,
      urls: Array.from(split.tabs, tab => tab.linkedBrowser.currentURI.spec) });
    await capture("capture-page-split", "dark");
    report.checks.push("two-real-https-pages-share-visible-nonoverlapping-native-split-panels");
    const settingsTab = add("about:preferences?fluxion=appearance");
    await select(settingsTab);
    const settings = document.getElementById("fluxion-settings");
    await wait(() => !settings.hidden && rect(settings).height > 100, "Settings surface did not open");
    const settingsRect = rect(settings), browserRect = rect(browser), flowRect = rect(flow);
    assert(near(settingsRect.left - flowRect.right, 4) && near(browserRect.right - settingsRect.right, 4) &&
      near(settingsRect.top - browserRect.top, 4) && near(browserRect.bottom - settingsRect.bottom, 4), "Settings inset does not match the page frame");
    assert(deck.hidden, "Settings left the underlying webpage deck visible");
    report.geometry.push({ mode: "settings", page: settingsRect });
    await capture("capture-settings", "light");
    const libraryTab = add("about:downloads#history");
    await select(libraryTab);
    const library = document.getElementById("fluxion-library");
    await wait(() => library && !library.hidden && settings.hidden && rect(library).height > 100, "Library surface did not replace Settings");
    const libraryRect = rect(library), libraryOuter = rect(browser), libraryFlow = rect(flow);
    assert(near(libraryRect.left - libraryFlow.right, 4) && near(libraryOuter.right - libraryRect.right, 4) &&
      near(libraryRect.top - libraryOuter.top, 4) && near(libraryOuter.bottom - libraryRect.bottom, 4), "Library inset does not match the page frame");
    assert(deck.hidden, "Library left the underlying webpage deck visible");
    report.geometry.push({ mode: "library", page: libraryRect });
    report.checks.push("settings-and-library-share-the-native-page-frame-boundary");
    report.checks.push("actual-light-dark-webpage-and-settings-captures");
    await nativeFullscreen();
  }
  async function nativeFullscreen() {
    stage("native-browser-fullscreen-focus-and-corners");
    assert(Services.prefs.getBoolPref("browser.fullscreen.autohide", false) &&
      !Services.prefs.prefHasUserValue("browser.fullscreen.autohide") && !Services.prefs.prefIsLocked("browser.fullscreen.autohide"),
    "Fresh-profile native fullscreen autohide must come from the unlocked product default, not a fixture/user override");
    const ui = window.FluxionUI, root = document.documentElement;
    const originalSize = { width: window.outerWidth, height: window.outerHeight };
    const evidence = report.fullscreen = { input: "Real window.fullScreen transition, Gecko widget-routed hover, native macOS Cmd-L/Escape", keys: [], geometry: [] };
    const tab = gBrowser.addTrustedTab("https://example.org/", { skipAnimation: true });
    ui.setTabWorkspace(tab, ui.currentWorkspace()); ui.selectTab(tab);
    await wait(() => tab.label === "Example Domain" && !tab.hasAttribute("busy") &&
      tab.linkedBrowser.currentURI.spec === "https://example.org/", "Fullscreen HTTPS fixture did not finish loading", 35000);
    const toolbox = document.getElementById("navigator-toolbox"), browser = tab.linkedBrowser;
    const moveToPage = () => { const box = rect(browser); routePointer(box.right - 60, box.top + Math.min(160, box.height / 2)); };
    const verifyPersistentNavigation = async mode => {
      ui.setSidebarState(mode); browser.focus();
      await wait(() => !window.FullScreen.navToolboxHidden && rect(toolbox).top >= -1,
        `Fullscreen ${mode} navigation did not remain visible`);
      const before = rect(toolbox);
      routePointer(before.left + before.width / 2, 0);
      moveToPage(); await delay(350);
      assert(!window.FullScreen.navToolboxHidden && near(rect(toolbox).top, before.top) &&
        rect(toolbox).height > 0 && !window.FluxionFocusMode.state().enabled,
      `Fullscreen ${mode} navigation retracted after real pointer departure`);
      evidence.geometry.push({ label: `browser-fullscreen-${mode}-persistent`, toolbox: rect(toolbox) });
      if (mode === "expanded") evidence.geometry.push(persistentSidebarEvidence(document.getElementById("fluxion-flow"), "fullscreen-expanded-heading"));
    };
    const revealNativeNavigation = async label => {
      const toggler = document.getElementById("fullscr-toggler"), edge = rect(toggler);
      assert(!toggler.hidden && edge.height >= 1, `${label}: native fullscreen edge is unavailable`);
      const point = nativeFullscreenEdgePoint(edge, window.devicePixelRatio);
      assert(toggler.contains(document.elementFromPoint(point.x, point.y)), `${label}: native fullscreen edge is obscured`);
      routePointer(point.x, point.y);
      await wait(() => !window.FullScreen.navToolboxHidden && rect(toolbox).top >= -1,
        `${label}: native top-edge hover did not reveal navigation`);
    };
    const verifyFocusSurfaceRetraction = async label => {
      ui.setSidebarState("focus");
      await wait(() => root.hasAttribute("data-fluxion-native-focus") && window.FullScreen.navToolboxHidden,
        `${label}: per-window fullscreen Focus did not hide navigation`);
      const settingsTab = gBrowser.addTrustedTab("about:preferences?fluxion=general", { skipAnimation: true });
      ui.setTabWorkspace(settingsTab, ui.currentWorkspace()); ui.selectTab(settingsTab);
      const settings = document.getElementById("fluxion-settings");
      let input;
      try {
        await wait(() => {
          if (settings.hidden) return false;
          input = [...settings.querySelectorAll('input[type="text"]')].find(node => {
            const box = rect(node);
            return !node.disabled && box.width >= 24 && box.height >= 24 &&
              node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
          });
          return input;
        }, `${label}: Settings has no usable native text input`);
        clickControl(input);
        await wait(() => document.activeElement === input, `${label}: routed Settings input click did not focus`);
        await revealNativeNavigation(`${label}-settings-hover`);
        const box = rect(input);
        routePointer(box.left + box.width / 2, box.top + box.height / 2);
        await wait(() => window.FullScreen.navToolboxHidden && rect(toolbox).bottom <= 1,
          `${label}: focused Settings input prevented fullscreen navigation retraction`);
        assert(document.activeElement === input, `${label}: retraction stole Settings input focus`);
        evidence.geometry.push({ label: `${label}-settings-input-retraction`, toolbox: rect(toolbox), input: rect(input),
          focusRetained: true, nativeFocus: root.hasAttribute("data-fluxion-native-focus") });

        await revealNativeNavigation(`${label}-sidebar-hover`);
        const flow = document.getElementById("fluxion-flow"), surface = flow.querySelector(".fluxion-surface");
        flow.querySelector(".fluxion-tab-scroll").scrollTop = 0;
        const edge = rect(flow);
        routePointer(edge.left + edge.width / 2, edge.top + Math.min(140, edge.height / 2));
        await wait(() => flow.dataset.revealed === "true" && !surface.inert && window.FullScreen.navToolboxHidden && rect(toolbox).bottom <= 1,
          `${label}: entering the revealed sidebar did not retract fullscreen navigation`);
        await delay(200);
        evidence.geometry.push({ label: `${label}-sidebar-retraction`, ...floatingSidebarEvidence(flow, surface, true), toolbox: rect(toolbox) });
        const outside = rect(settings);
        routePointer(outside.right - 40, outside.top + Math.min(160, outside.height / 2));
        await wait(() => flow.dataset.revealed === "false" && surface.inert, `${label}: leaving floating sidebar did not retract it`);
        await delay(200);
        evidence.geometry.push({ label: `${label}-sidebar-hidden`, ...floatingSidebarEvidence(flow, surface, false) });
      } finally {
        ui.selectTab(tab);
        gBrowser.removeTab(settingsTab, { animate: false });
        browser.focus(); moveToPage();
      }
    };
    const key = event => {
      if ((event.metaKey && event.key.toLowerCase() === "l") || event.key === "Escape")
        evidence.keys.push({ key: event.key, trusted: event.isTrusted, meta: event.metaKey });
    };
    window.addEventListener("keydown", key, true);
    try {
      ui.setSidebarState("expanded");
      await wait(() => !window.FluxionFocusMode.state().enabled, "Expanded mode did not release Focus navigation");
      window.gURLBar.focus();
      await wait(() => document.activeElement === window.gURLBar.inputField, "Implicit location-focus fixture did not focus");
      ui.setSidebarState("focus");
      await wait(() => window.FluxionFocusMode.state().enabled && !window.FluxionFocusMode.state().revealed &&
        document.activeElement !== window.gURLBar.inputField && rect(toolbox).bottom <= 1,
      "Collapsing with inherited New Tab focus kept navigation pinned");
      report.checks.push("collapse-releases-inherited-address-focus-without-blocking-later-native-cmd-l");
      ui.setSidebarState("expanded");
      await wait(() => !window.FluxionFocusMode.state().enabled, "Expanded frame did not recover before fullscreen");
      browser.focus();
      window.fullScreen = true;
      await wait(() => window.fullScreen && root.hasAttribute("inFullscreen") && root.hasAttribute("macOSNativeFullscreen"),
        "Actual macOS browser fullscreen did not enter", 25000);
      evidence.entryPresentation = await settleFullscreenPresentation(true);
      await verifyPersistentNavigation("expanded");
      await verifyPersistentNavigation("compact");
      window.gURLBar.focus();
      ui.setSidebarState("focus");
      await wait(() => !window.FluxionFocusMode.state().enabled && document.activeElement !== window.gURLBar.inputField &&
        window.FullScreen.navToolboxHidden && rect(toolbox).bottom <= 1,
      "Native fullscreen navigation did not hide after explicit collapse", 15000);
      moveToPage();
      evidence.geometry.push(pageCornerEvidence(browser, "browser-fullscreen-hidden"));
      await action("capture-fullscreen-focus-hidden");
      const toggler = document.getElementById("fullscr-toggler"), edge = rect(toggler);
      assert(!toggler.hidden && edge.height >= 1, "Native fullscreen hover target is unavailable");
      const point = nativeFullscreenEdgePoint(edge, window.devicePixelRatio);
      const hit = document.elementFromPoint(point.x, point.y);
      evidence.hover = { edge, point, devicePixelRatio: window.devicePixelRatio, hit: hit?.id || hit?.localName, events: [] };
      assert(hit === toggler || toggler.contains(hit), "Native fullscreen edge is covered by another chrome surface");
      const observed = event => evidence.hover.events.push({ trusted: event.isTrusted, type: event.type,
        x: event.clientX, y: event.clientY, target: event.target?.id });
      toggler.addEventListener("mouseover", observed, true);
      try {
        routePointer(point.x, point.y);
        await wait(() => evidence.hover.events.some(event => event.trusted && event.target === "fullscr-toggler") &&
          !window.FullScreen.navToolboxHidden && rect(toolbox).top >= -1,
        "Native fullscreen top-edge hover did not reach its real target and reveal navigation");
      } finally { toggler.removeEventListener("mouseover", observed, true); }
      await action("capture-fullscreen-focus-revealed");
      moveToPage();
      await wait(() => window.FullScreen.navToolboxHidden, "Native fullscreen toolbar did not re-hide");
      evidence.motion = await verifyNavigationMotion(toolbox, true, async () => {
        await revealNativeNavigation("normal-motion-sidebar-retraction");
        const flow = document.getElementById("fluxion-flow"), edge = rect(flow);
        const point = { x: edge.left + edge.width / 2, y: edge.top + Math.min(140, edge.height / 2) };
        const started = window.performance.now();
        routePointer(point.x, point.y);
        await wait(() => flow.dataset.revealed === "true" && window.FullScreen.navToolboxHidden && rect(toolbox).bottom <= 1,
          "Native normal-motion Flow departure did not reveal the sidebar and retract navigation");
        return { route: "native-top-edge-to-Flow-edge", point, elapsed: window.performance.now() - started,
          sidebar: flow.dataset.state, toolbox: rect(toolbox), animationAttribute: toolbox.hasAttribute("fullscreenShouldAnimate") };
      });
      moveToPage();
      await action("fullscreen-location");
      await wait(() => evidence.keys.some(item => item.trusted && item.meta && item.key.toLowerCase() === "l") &&
        document.activeElement === window.gURLBar.inputField && !window.FullScreen.navToolboxHidden,
      "Native Cmd-L failed after fullscreen Focus collapse");
      assert(rect(window.gURLBar.inputField).height > 0, "Native fullscreen location input is not painted");
      const focusFlow = document.getElementById("fluxion-flow"), focusSurface = focusFlow.querySelector(".fluxion-surface");
      focusFlow.querySelector(".fluxion-tab-scroll").scrollTop = 0;
      const focusEdge = rect(focusFlow);
      routePointer(focusEdge.left + focusEdge.width / 2, focusEdge.top + Math.min(140, focusEdge.height / 2));
      await wait(() => focusFlow.dataset.revealed === "true" && !focusSurface.inert, "Keyboard-held navigation prevented sidebar reveal");
      await delay(200);
      assert(!window.FullScreen.navToolboxHidden && document.activeElement === window.gURLBar.inputField,
        "Sidebar hover stole keyboard-owned native address focus");
      evidence.geometry.push({ label: "fullscreen-sidebar-with-keyboard-held-toolbar", ...floatingSidebarEvidence(focusFlow, focusSurface, true), toolbox: rect(toolbox) });
      evidence.floatingToolbarHitTargets = ["back-button", "forward-button", "reload-button"]
        .map(id => document.getElementById(id)).filter(node => node && rect(node).width > 0)
        .map(navigationControlHitEvidence);
      assert(evidence.floatingToolbarHitTargets.length >= 2, "Fullscreen floating-sidebar fixture lacks native left navigation controls");
      moveToPage(); await delay(250);
      assert(!window.FullScreen.navToolboxHidden && document.activeElement === window.gURLBar.inputField,
        "Fullscreen pointer departure hid genuine keyboard-owned location input");
      evidence.keyboardFocusRetainedOnPointerLeave = true;
      await action("fullscreen-location-escape");
      await wait(() => evidence.keys.some(item => item.trusted && item.key === "Escape") && !window.gURLBar.view.isOpen,
        "Native fullscreen Escape did not dismiss location suggestions");
      // Gecko intentionally retries keyboard-owned toolbar collapse on a real
      // click/keydown, not blur: moving chrome during mousedown can split a
      // click into two ineffective halves. Use the user's actual page click.
      evidence.pageClick = clickNativePage(browser);
      await wait(() => document.activeElement !== window.gURLBar.inputField && window.FullScreen.navToolboxHidden,
        "Native fullscreen did not hide after actual page click");
      evidence.pageClick.focusTransferred = true;
      evidence.pageClick.navigationHidden = true;
      await verifyPersistentNavigation("expanded");
      await verifyPersistentNavigation("compact");
      await verifyFocusSurfaceRetraction("default-autohide");
      evidence.savedAutohideFalse = await withSavedAutohideDisabled(async () => {
        await verifyPersistentNavigation("expanded");
        await verifyPersistentNavigation("compact");
        await verifyFocusSurfaceRetraction("saved-autohide-false");
      });
      assert(Services.prefs.getBoolPref("browser.fullscreen.autohide") &&
        !Services.prefs.prefHasUserValue("browser.fullscreen.autohide"), "Fixture did not restore original fullscreen preference provenance");
      report.fullscreenTested = true;
      report.checks.push("real-macos-browser-fullscreen-delegates-hover-and-cmd-l-with-eight-pixel-page-corners");
      report.checks.push("fullscreen-expanded-and-compact-navigation-stay-visible-focus-alone-retracts-on-native-pointer-leave");
      report.checks.push("fullscreen-focus-retracts-over-settings-and-floating-sidebar-with-saved-autohide-false-unchanged",
        "floating-sidebar-has-viewport-six-pixel-insets-and-heading-padding-even-with-toolbar-visible");
    } finally {
      window.removeEventListener("keydown", key, true);
      window.fullScreen = false;
      await wait(() => !window.fullScreen && !root.hasAttribute("inFullscreen") &&
        near(window.outerWidth, originalSize.width) && near(window.outerHeight, originalSize.height),
      "Native fullscreen did not exit and restore its original window geometry", 25000);
      evidence.exitPresentation = await settleFullscreenPresentation(false);
      ui.setSidebarState("expanded"); browser.focus();
      await wait(() => !window.FluxionFocusMode.state().enabled && rect(toolbox).top >= -1,
        "Normal expanded navigation did not recover after fullscreen");
    }
    evidence.geometry.push(pageCornerEvidence(browser, "normal-expanded-after-fullscreen"));
    await action("capture-fullscreen-restored");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-frame-keyboard-close-and-captures-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("keydown", onKey, true);
      for (const remove of diagnosticListeners) remove();
      report.pointerMoves = pointerMoves;
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null);
      await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
