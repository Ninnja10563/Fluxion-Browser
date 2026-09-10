"use strict";
// Reproducible CPU-only comparison with the frozen 0.54 candidate. This does
// not measure Gecko paint, native input latency, or OS scheduling.
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const currentScope = vm.createContext({});
vm.runInContext(require("node:fs").readFileSync(require.resolve("../chrome/core/search.js"), "utf8"), currentScope);
const current = currentScope.FluxionSearch;
const baseline = vm.createContext({});
vm.runInContext(execFileSync("git", ["show", "c0523796be08af4f226cc33d074245bd53928aae:fluxion/chrome/core/search.js"], { encoding: "utf8" }), baseline);
const queries = ["w", "we", "web", "webs", "websocket", "websocket a", "websocket auth"];
for (const count of [200, 1000, 3000]) {
  const items = Array.from({ length: count }, (_, i) => ({ label: `Research ${i}: WebSocket authentication and browser session restoration — Documentation`,
    detail: `https://docs.example.test/reference/browser/security/session-restoration?topic=websocket&record=${i}`,
    keywords: ["development", "Browser research"], boost: i === 0 ? 18 : 0 }));
  for (const [name, engine] of [["baseline", baseline.FluxionSearch], ["prepared", current]]) {
    const samples = [];
    for (let repeat = 0; repeat < 12; repeat++) for (const query of queries) {
      const start = performance.now(); engine.rankSearchItems(query, items, 12);
      if (repeat > 1) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ count, name, samples: samples.length,
      p50: samples[Math.floor(samples.length * .5)], p95: samples[Math.floor(samples.length * .95)], max: samples.at(-1) }));
  }
}
