(function exposeFlowTabContent(scope) {
  "use strict";

  function update(item, state, { create, fallbackIcon, statusGlyph, controlGlyph }) {
    const parts = item._fluxionParts;
    const attribute = (element, name, value) => {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    };
    const property = (element, name, value) => { if (element[name] !== value) element[name] = value; };
    const className = (name, value) => {
      if (item.classList.contains(name) !== Boolean(value)) item.classList.toggle(name, value);
    };
    className("is-sleeping", state.sleeping);
    className("is-multiselected", state.multiselected);
    attribute(item, "data-active", String(state.active));
    attribute(item, "data-status", state.status.indicators.map(indicator => indicator.kind).join(" "));
    attribute(item, "aria-selected", String(state.active || state.multiselected));
    attribute(item, "aria-label", [state.label, ...state.status.labels].join(", "));
    property(item, "title", [state.label, state.url, ...state.status.labels].filter(Boolean).join("\n"));
    if (parts.title.textContent !== state.label) parts.title.textContent = state.label;
    attribute(parts.close, "aria-label", `Close ${state.label}`);

    if (parts.faviconURL !== state.faviconURL) {
      const next = state.faviconURL ? create("img", "fluxion-favicon") : fallbackIcon();
      if (state.faviconURL) {
        next.alt = "";
        next.src = state.faviconURL;
        next.addEventListener("error", () => {
          if (parts.favicon !== next) return;
          const fallback = fallbackIcon();
          next.replaceWith(fallback);
          parts.favicon = fallback;
        });
      }
      parts.favicon.replaceWith(next);
      parts.favicon = next;
      parts.faviconURL = state.faviconURL;
    }
    property(parts.peek, "hidden", !state.peek);
    property(parts.split, "hidden", !state.splitLabel);
    property(parts.split, "title", state.splitLabel);
    attribute(parts.split, "aria-label", state.splitLabel);
    const indicatorsKey = JSON.stringify(state.status.indicators);
    if (parts.indicatorsKey !== indicatorsKey) {
      parts.indicators.replaceChildren(...state.status.indicators.map(statusGlyph));
      parts.indicatorsKey = indicatorsKey;
    }
    property(parts.indicators, "hidden", !state.status.indicators.length);
    const audio = state.status.audio;
    if (!audio && parts.audio.ownerDocument?.activeElement === parts.audio) item.focus({ preventScroll: true });
    property(parts.audio, "hidden", !audio);
    if (parts.audioKind !== audio?.kind) {
      parts.audio.replaceChildren(...(audio ? [controlGlyph(audio.kind)] : []));
      parts.audioKind = audio?.kind;
    }
    property(parts.audio, "title", audio?.action || "");
    attribute(parts.audio, "aria-label", audio?.action || "");
  }

  function activateAudio(tab, readStatus) {
    const audio = readStatus().audio;
    if (!audio) return false;
    if (audio.kind === "blocked") tab.resumeDelayedMedia();
    else tab.toggleMuteAudio();
    return true;
  }

  const api = Object.freeze({ update, activateAudio });
  scope.FluxionFlowTabContent = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
