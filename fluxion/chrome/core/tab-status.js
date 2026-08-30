(function initialiseFluxionTabStatus(global) {
  "use strict";

  const truthy = value => value === true || value === "true" || value === "1";

  function sharingKinds(value) {
    if (!value) return [];
    const words = new Set();
    const add = entry => {
      const text = String(entry || "").toLocaleLowerCase();
      if (/screen|window|display|browser/.test(text)) words.add("screen");
      if (/camera|video/.test(text)) words.add("camera");
      if (/microphone|audio/.test(text)) words.add("microphone");
    };
    if (typeof value === "string") {
      for (const entry of value.split(/[\s,;+]+/)) add(entry);
    } else if (Array.isArray(value)) {
      for (const entry of value) add(entry);
    } else if (typeof value === "object") {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled && enabled !== "none" && enabled !== "false") add(key);
      }
    } else if (truthy(value)) {
      words.add("media");
    }
    return [...words];
  }

  function sharingIndicator(value) {
    const kinds = sharingKinds(value);
    if (!kinds.length) return null;
    if (kinds.includes("screen")) {
      return { kind: "sharing-screen", label: "Sharing the screen", tone: "warning" };
    }
    const camera = kinds.includes("camera");
    const microphone = kinds.includes("microphone");
    if (camera && microphone) {
      return { kind: "sharing-camera-microphone", label: "Using the camera and microphone", tone: "warning" };
    }
    if (camera) return { kind: "sharing-camera", label: "Using the camera", tone: "warning" };
    if (microphone) {
      return { kind: "sharing-microphone", label: "Using the microphone", tone: "warning" };
    }
    return { kind: "sharing-media", label: "Sharing media", tone: "warning" };
  }

  function describe(input = {}) {
    const crashed = truthy(input.crashed);
    const sleeping = truthy(input.sleeping);
    const indicators = [];

    if (crashed) {
      indicators.push({ kind: "crashed", label: "Page crashed", tone: "critical" });
    } else {
      const sharing = sharingIndicator(input.sharing);
      if (sharing) indicators.push(sharing);
      if (truthy(input.pictureInPicture)) {
        indicators.push({
          kind: "picture-in-picture",
          label: "Video playing in Picture-in-Picture",
          tone: "active",
        });
      }
      if (truthy(input.busy)) {
        indicators.push({ kind: "loading", label: "Loading page", tone: "neutral", animated: true });
      }
      if (truthy(input.attention)) {
        indicators.push({ kind: "attention", label: "Needs attention", tone: "active" });
      }
      if (sleeping) {
        indicators.push({ kind: "sleeping", label: "Sleeping; select to restore", tone: "neutral" });
      }
    }

    let audio = null;
    if (!crashed && truthy(input.mediaBlocked)) {
      audio = { kind: "blocked", label: "Audio playback blocked", action: "Play audio" };
    } else if (!crashed && truthy(input.muted)) {
      audio = { kind: "muted", label: "Muted", action: "Unmute tab" };
    } else if (!crashed && truthy(input.soundPlaying)) {
      audio = { kind: "playing", label: "Playing audio", action: "Mute tab" };
    }

    return Object.freeze({
      audio: audio && Object.freeze(audio),
      indicators: Object.freeze(indicators.map(indicator => Object.freeze(indicator))),
      labels: Object.freeze([
        ...indicators.map(indicator => indicator.label),
        ...(audio ? [audio.label] : []),
      ]),
    });
  }

  const api = Object.freeze({ describe, sharingKinds });
  global.FluxionTabStatus = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
