"use strict";
// CPU-only, invocation-local selection comparison. Not Gecko startup, paint,
// physical input latency, SessionStore IO, or a website-performance benchmark.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { performance } = require("node:perf_hooks");
const repository = path.resolve(__dirname, "../..");
const baselineCommit = "eca27212472017d3b174dc4d158a7709b0ed5e0a";
const member = "fluxion/chrome/core/workspace-tabs.js";
const baselineSource = execFileSync("git", ["show", `${baselineCommit}:${member}`], { cwd: repository, encoding: "utf8" });
const currentSource = fs.readFileSync(path.join(repository, member), "utf8");
function engine(source) {
  // Both implementations and fixture objects share a realm: crossing a VM
  // membrane inside every comparison would distort the ordinary CPU cost.
  const module = { exports: {} };
  new Function("module", "globalThis", source)(module, {});
  return module.exports;
}
const baseline = engine(baselineSource), current = engine(currentSource);
const config = { seed: 0x51a7e, counts: [200, 1000, 3000], workspaceCounts: [1, 4], warmup: 20, iterations: 100 };
function random(seed = config.seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
}
function corpus(count, workspaceCount) {
  const next = random();
  return Array.from({ length: count }, (_, id) => ({ id, workspace: `workspace-${id % workspaceCount}`,
    remembered: id % 97 === 0, lastAccessed: next(), closing: id % 101 === 100 }));
}
function selection(api, tabs, workspace) {
  const reads = { workspace: 0, remembered: 0 };
  const selected = api.preferredTab(tabs, workspace, {
    workspaceOf: tab => { reads.workspace++; return tab.workspace; },
    isRemembered: tab => { reads.remembered++; return tab.remembered; },
  });
  return { id: selected?.id ?? null, reads };
}
// Establish equivalent winners before starting any timed comparison. Include
// malformed values here but not in the normal-native-state timing corpus.
let differentialCases = 0;
const malformed = [undefined, null, 0, -7, 42, NaN, Infinity, -Infinity, "unknown", "12", "", Number.MAX_VALUE];
const next = random();
for (let index = 0; index < 800; index++) {
  const tabs = Array.from({ length: 2 + next() % 90 }, (_, id) => ({ id,
    workspace: `workspace-${next() % 4}`, remembered: malformed[next() % malformed.length],
    lastAccessed: malformed[next() % malformed.length], closing: next() % 17 === 0 }));
  const workspace = `workspace-${index % 4}`;
  assert.equal(selection(current, tabs, workspace).id, selection(baseline, tabs, workspace).id);
  differentialCases++;
}
const cases = [];
for (const count of config.counts) for (const workspaceCount of config.workspaceCounts) {
  const tabs = corpus(count, workspaceCount), workspace = `workspace-${workspaceCount - 1}`;
  const old = selection(baseline, tabs, workspace), improved = selection(current, tabs, workspace);
  assert.equal(improved.id, old.id);
  differentialCases++;
  cases.push({ count, workspaceCount, tabs, workspace, old, improved });
}
console.log(JSON.stringify({ schema: 1, kind: "configuration", baselineCommit,
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
  currentSourceSha256: createHash("sha256").update(currentSource).digest("hex"),
  node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model,
  ...config, differentialCases,
  boundary: "CPU-only selection function with counted callbacks; not native SessionStore or browsing latency" }));
for (const item of cases) {
  const implementations = [["baseline", baseline, item.old], ["linear", current, item.improved]];
  const collected = { baseline: [], linear: [] };
  for (let index = 0; index < config.warmup + config.iterations; index++) {
    for (const [name, api] of index % 2 ? [...implementations].reverse() : implementations) {
      const start = performance.now(); api.preferredTab(item.tabs, item.workspace);
      if (index >= config.warmup) collected[name].push(performance.now() - start);
    }
  }
  for (const [name, , proof] of implementations) {
    const samples = collected[name];
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ schema: 1, kind: "result", name, count: item.count, workspaceCount: item.workspaceCount,
      selected: proof.id, readsPerInvocation: proof.reads, samples: samples.length,
      milliseconds: { p50: samples[Math.floor(samples.length * .5)], p95: samples[Math.floor(samples.length * .95)], max: samples.at(-1) } }));
  }
}
