const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-palette.js"), "utf8");
const start = source.indexOf("  async function waitForGroundingOwners(");
const end = source.indexOf('\n  if (Services.env.get("FLUXION_VISUAL_GROUNDING_TEST")', start);
assert.ok(start >= 0 && end > start);
const wait = vm.runInNewContext(`${source.slice(start, end)}; waitForGroundingOwners`);

test("grounding waits for every enabled owner, not merely embedding restoration", async () => {
  const enabled = new Set(["FLUXION_VISUAL_EMBEDDING_SETTINGS_TEST", "FLUXION_VISUAL_AI_COMPARE_TEST", "FLUXION_VISUAL_CLEAR_DATA_TEST"]);
  const ready = new Set(["fluxion.memory.embeddingSettings.health"]);
  const stages = []; let pauses = 0;
  await wait(flag => enabled.has(flag), pref => ready.has(pref), async () => {
    ready.add(++pauses === 1 ? "fluxion.ai.compare.visual.health" : "fluxion.dataClearing.cancel.health");
  }, pending => stages.push(Array.from(pending)), () => 0);
  assert.equal(pauses, 2);
  assert.deepEqual(stages[0], ["fluxion.dataClearing.cancel.health", "fluxion.ai.compare.visual.health"]);
  assert.deepEqual(stages.at(-1), []);
});

test("grounding standalone has no unrelated fixture dependencies", async () => {
  await wait(() => false, () => false, () => assert.fail("must not wait"), pending => assert.equal(pending.length, 0));
});

test("missing owner fails boundedly with its exact marker instead of starting grounding", async () => {
  let time = 0, pauses = 0;
  await assert.rejects(wait(flag => flag === "FLUXION_VISUAL_SEARCH_ENGINE_TEST", () => false,
    async () => { pauses++; time += 10000; }, () => {}, () => time), /timed out: fluxion.palette.localAddress.health/);
  assert.equal(pauses, 7);
});
