"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const TabStatus = require("../chrome/core/tab-status.js");

test("projects independent Gecko activity states without page data", () => {
  const status = TabStatus.describe({
    busy: true,
    pictureInPicture: true,
    sharing: { camera: true, microphone: true },
    soundPlaying: true,
  });
  assert.deepEqual(status.indicators.map(item => item.kind), [
    "sharing-camera-microphone", "picture-in-picture", "loading",
  ]);
  assert.equal(status.audio.kind, "playing");
  assert.deepEqual(status.labels, [
    "Using the camera and microphone",
    "Video playing in Picture-in-Picture",
    "Loading page",
    "Playing audio",
  ]);
});

test("normalises Gecko sharing strings and objects", () => {
  assert.deepEqual(TabStatus.sharingKinds("screen camera microphone"), [
    "screen", "camera", "microphone",
  ]);
  assert.deepEqual(TabStatus.sharingKinds({ screen: "Window", camera: false, microphone: true }), [
    "screen", "microphone",
  ]);
  assert.deepEqual(TabStatus.sharingKinds(null), []);
});

test("crash state suppresses stale activity and media controls", () => {
  const status = TabStatus.describe({
    crashed: true,
    busy: true,
    pictureInPicture: true,
    sharing: "screen",
    muted: true,
  });
  assert.deepEqual(status.indicators.map(item => item.kind), ["crashed"]);
  assert.equal(status.audio, null);
  assert.deepEqual(status.labels, ["Page crashed"]);
});

test("audio action follows Gecko blocked, muted, and playing precedence", () => {
  assert.deepEqual(TabStatus.describe({ mediaBlocked: true, muted: true }).audio, {
    kind: "blocked", label: "Audio playback blocked", action: "Play audio",
  });
  assert.equal(TabStatus.describe({ muted: true, soundPlaying: true }).audio.action, "Unmute tab");
  assert.equal(TabStatus.describe({ soundPlaying: true }).audio.action, "Mute tab");
  assert.equal(TabStatus.describe({}).audio, null);
});

test("sleeping and attention remain explicit accessible states", () => {
  const status = TabStatus.describe({ sleeping: true, attention: true });
  assert.deepEqual(status.indicators.map(item => item.kind), ["attention", "sleeping"]);
  assert.match(status.labels.join("; "), /Needs attention/);
  assert.match(status.labels.join("; "), /select to restore/);
});
