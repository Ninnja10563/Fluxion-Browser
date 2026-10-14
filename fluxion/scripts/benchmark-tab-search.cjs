"use strict";
// Reproducible CPU-only comparison with the frozen 0.75 release. This does
// not measure Gecko paint, native input latency, or OS scheduling.
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const BASELINE = "5cf540467a718051b11aa39ab5469d263859393c";
const currentScope = vm.createContext({});
vm.runInContext(require("node:fs").readFileSync(require.resolve("../chrome/core/search.js"), "utf8"), currentScope);
const current = currentScope.FluxionSearch;
const baseline = vm.createContext({});
vm.runInContext(execFileSync("git", ["show", `${BASELINE}:fluxion/chrome/core/search.js`], { encoding: "utf8" }), baseline);
console.log(JSON.stringify({ baseline: BASELINE, node: process.version, platform: process.platform,
  arch: process.arch, scope: "CPU-only ranking; alternating order; no native/Speedometer claim" }));
const queries = ["w", "we", "web", "webs", "websocket", "websocket a", "websocket auth"];
for (const count of [200, 1000, 3000]) {
  const items = Array.from({ length: count }, (_, i) => ({ label: `Research ${i}: WebSocket authentication and browser session restoration — Documentation`,
    detail: `https://docs.example.test/reference/browser/security/session-restoration?topic=websocket&record=${i}`,
    keywords: ["development", "Browser research"], boost: i === 0 ? 18 : 0 }));
  const engines = { baseline: baseline.FluxionSearch, current };
  const samples = { baseline: [], current: [] };
  for (const query of queries) {
    const before = Array.from(engines.baseline.rankSearchItems(query, items, 12));
    const after = Array.from(current.rankSearchItems(query, items, 12));
    assert.deepEqual(after, before);
  }
  for (let repeat = 0; repeat < 24; repeat++) {
    for (const name of repeat % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
      for (const query of queries) {
        const start = performance.now(); engines[name].rankSearchItems(query, items, 12);
        if (repeat > 3) samples[name].push(performance.now() - start);
      }
    }
  }
  for (const [name, values] of Object.entries(samples)) {
    values.sort((a, b) => a - b);
    console.log(JSON.stringify({ count, name, samples: values.length,
      p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], max: values.at(-1) }));
  }
}
