"use strict";
// CPU-only shipped grouping-helper comparison. No Gecko paint, OS input or
// browsing-speed claim. Both corpora and helper objects are built in their VM.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const BASELINE = "eca27212472017d3b174dc4d158a7709b0ed5e0a";
const repo = path.resolve(__dirname, "../..");
const read = (revision, file) => revision
  ? execFileSync("git", ["show", `${revision}:fluxion/${file}`], { cwd: repo, encoding: "utf8" })
  : fs.readFileSync(path.join(repo, "fluxion", file), "utf8");

function engine(revision, count) {
  const source = read(revision, "chrome/fluxion-palette.js");
  const start = source.includes("  function sameOrganisationRecord(")
    ? source.indexOf("  function sameOrganisationRecord(") : source.indexOf("  function organisationSuggestion(");
  const end = source.indexOf("  function applyOrganisationSuggestion(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ NativeURL: URL });
  vm.runInContext(read(revision, "chrome/core/tab-organisation.js"), context);
  vm.runInContext(`
    let analyses = 0, parsedURLs = 0, organisationCache = null;
    const nativeSuggest = FluxionTabOrganisation.suggestGroup;
    FluxionTabOrganisation = { suggestGroup(records) { analyses++; return nativeSuggest(records); } };
    function URL(value) { parsedURLs++; return new NativeURL(value); }
    const layer = { hidden: false };
    const gBrowser = { tabs: Array.from({ length: ${count} }, (_, index) => ({
      id: index, label: 'Research '+index+': WebSocket authentication and session restoration — Documentation',
      linkedBrowser: { currentURI: { spec: 'https://docs'+(index%8)+'.example.test/security?record='+index } },
      workspace: 'development', parentNode: {}, pinned: false, group: null, splitview: null, getAttribute() { return ''; }
    })) };
    const ui = { currentWorkspace: () => 'development', tabWorkspace: tab => tab.workspace };
    ${source.slice(start, end)}
    globalThis.api = {
      run(cold = false) { if (cold) organisationCache = null; return organisationSuggestion(); },
      change() { gBrowser.tabs[0].label += ' revised'; },
      resetCounts() { analyses = 0; parsedURLs = 0; },
      counts() { return { analyses, parsedURLs }; },
      summary() { const result = organisationSuggestion(); return JSON.stringify(result && {
        name: result.name, reason: result.reason, tabs: result.records.map(record => record.tab.id)
      }); }
    };
  `, context);
  return context.api;
}
const stats = samples => {
  const values = [...samples].sort((a, b) => a - b);
  const at = p => values[Math.ceil(values.length * p) - 1];
  return { samples: values.length, p50: at(.5), p95: at(.95), max: at(1) };
};
console.log(JSON.stringify({ benchmark: "palette-grouping-helper", baseline: BASELINE,
  node: process.version, platform: process.platform, arch: process.arch,
  scope: "same-VM corpus; alternating order; CPU-only; no native/browser-speed claim" }));
for (const count of [200, 1000, 3000]) {
  const engines = [engine(BASELINE, count), engine(null, count)];
  assert.equal(engines[0].summary(), engines[1].summary());
  for (const phase of ["cold-open", "warm-same-open", "metadata-changed"]) {
    for (let repeat = 0; repeat < 6; repeat++) for (const item of engines) item.run(true);
    for (const item of engines) item.resetCounts();
    const samples = [[], []];
    for (let repeat = 0; repeat < 30; repeat++) {
      for (const index of repeat % 2 ? [1, 0] : [0, 1]) {
        if (phase === "metadata-changed") engines[index].change();
        const start = performance.now(); engines[index].run(phase === "cold-open");
        samples[index].push(performance.now() - start);
      }
    }
    for (const [index, name] of ["baseline", "current"].entries())
      console.log(JSON.stringify({ count, phase, name, ...stats(samples[index]), operations: engines[index].counts() }));
    assert.equal(engines[0].summary(), engines[1].summary(), `Ranking changed at ${count} ${phase}`);
  }
}
