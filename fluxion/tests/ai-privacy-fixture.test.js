"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function fixture(t) {
  const { startAIPrivacyFixture } = await import("../scripts/ai-privacy-fixture.mjs");
  const server = await startAIPrivacyFixture();
  t.after(() => server.close());
  return server.origin;
}

test("AI fixture distinguishes the exact key, wrong key, and absent header without recording secrets", async t => {
  const origin = await fixture(t);
  for (const authorization of ["Bearer fluxion-native-fixture-synthetic-only", "Bearer wrong-key", null]) {
    const response = await fetch(`${origin}/a/v1/models`, { headers: authorization ? { authorization } : {} });
    assert.equal(response.status, 200);
  }
  const state = await (await fetch(`${origin}/state`)).json();
  assert.deepEqual(state.models.map(({ headerPresent, expectedCredential }) => [headerPresent, expectedCredential]),
    [[true, true], [true, false], [false, false]]);
  assert.doesNotMatch(JSON.stringify(state), /Bearer|wrong-key|synthetic-only/);
});

test("AI fixture counts only parsed chat bodies and records real supplied page context", async t => {
  const origin = await fixture(t);
  const send = body => fetch(`${origin}/b/v1/chat/completions`, { method: "POST", body });
  assert.equal((await send("malformed")).status, 400);
  const response = await send(JSON.stringify({ messages: [{ role: "user", content: "This controlled article explains privacy." }] }));
  assert.ok((await response.json()).choices[0].message.content);
  const state = await (await fetch(`${origin}/state`)).json();
  assert.deepEqual(state.posts, [{ path: "/b/v1/chat/completions", headerPresent: false,
    expectedCredential: false, hasPageContext: true }]);
  assert.match(await (await fetch(`${origin}/article`)).text(), /This controlled article explains/);
});

test("AI fixture rejects oversized page requests before recording or processing them", async t => {
  const origin = await fixture(t);
  const response = await fetch(`${origin}/a/v1/chat/completions`, { method: "POST", body: "x".repeat(65537) });
  assert.equal(response.status, 413);
  assert.deepEqual((await (await fetch(`${origin}/state`)).json()).posts, []);
});
