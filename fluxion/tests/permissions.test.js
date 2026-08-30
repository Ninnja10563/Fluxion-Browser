"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Permissions = require("../chrome/core/permissions.js");

test("permission records expose only safe HTTP origins", () => {
  assert.equal(Permissions.safeOrigin("https://user:secret@example.com:8443/private?q=1"), "https://example.com:8443");
  assert.equal(Permissions.safeOrigin("file:///Users/person/secret.txt"), "");
  assert.equal(Permissions.normalise({ origin: "about:config", type: "camera" }), null);
});

test("permission records preserve Gecko decisions and expiry semantics", () => {
  const permanent = Permissions.normalise({
    origin: "https://camera.example/path", type: "camera", capability: 1,
    expireType: 0, modificationTime: 42,
  }, 1000);
  assert.equal(permanent.site, "camera.example");
  assert.equal(permanent.typeLabel, "Camera");
  assert.equal(permanent.state, "Allow");
  assert.equal(permanent.tone, "allow");
  assert.equal(permanent.expiry, "Permanent");

  const session = Permissions.normalise({
    origin: "https://voice.example", type: "microphone", capability: 2,
    expireType: 1, originAttributes: "^privateBrowsingId=1&userContextId=4",
  });
  assert.equal(session.state, "Block");
  assert.equal(session.expiry, "Until Fluxion closes");
  assert.equal(session.context, "Private session · Container 4");

  const tab = Permissions.normalise({
    origin: "https://notify.example", type: "desktop-notification", capability: 3,
    expireType: 4, browserId: 81,
  });
  assert.equal(tab.state, "Always ask");
  assert.equal(tab.expiry, "This tab");
  assert.equal(tab.context, "Tab-specific");
});

test("permission filtering and grouping require every search term", () => {
  const records = [
    Permissions.normalise({ origin: "https://meet.example", type: "camera", capability: 1 }),
    Permissions.normalise({ origin: "https://meet.example", type: "microphone", capability: 2 }),
    Permissions.normalise({ origin: "https://maps.example", type: "geo", capability: 1 }),
  ];
  assert.equal(Permissions.matches(records[0], "meet allow camera"), true);
  assert.equal(Permissions.matches(records[0], "meet blocked"), false);
  const groups = Permissions.group(records, "meet");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].permissions.length, 2);
  assert.deepEqual(groups[0].permissions.map(item => item.typeLabel), ["Camera", "Microphone"]);
});

test("unknown Gecko permission types remain manageable without raw punctuation", () => {
  assert.equal(Permissions.typeLabel("open-protocol_handler"), "Open Protocol Handler");
  const record = Permissions.normalise({
    origin: "http://localhost:8080", type: "future.permission", capability: 17,
    expireType: 99,
  });
  assert.equal(record.typeLabel, "Future Permission");
  assert.equal(record.state, "Custom decision (17)");
  assert.equal(record.expiry, "Custom duration");
});
