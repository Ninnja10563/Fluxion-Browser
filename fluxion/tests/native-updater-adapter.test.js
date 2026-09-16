const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../modules/FluxionNativeUpdater.sys.mjs"), "utf8")
  .replace("export const FluxionNativeUpdater", "globalThis.subject");
function fixture() {
  const calls = [], state = { available: false, state: "unavailable", message: "Unsafe profile" };
  const f = { calls, state, nullPointer: false, raw: null, commandCode: 0 };
  const api = {
    FluxionUpdaterStart(profile) { calls.push(["start", profile]); return state.available ? 0 : 1; },
    FluxionUpdaterCommand(json) { calls.push(["command", JSON.parse(json)]); return f.commandCode; },
    FluxionUpdaterCopyState() { return { isNull: () => f.nullPointer, readString: () => f.raw ?? JSON.stringify(state) }; },
    FluxionUpdaterFree() { calls.push(["free"]); },
  };
  const contents = { leafName: "Contents", clone: () => ({ path: "/app/Contents", append(name) { this.path += "/" + name; }, exists: () => true, isFile: () => true }) };
  const context = vm.createContext({ Services: { appinfo: { OS: "Darwin" }, dirsvc: { get: key => key === "GreD"
    ? { leafName: "Resources", parent: contents } : { path: "/profile" } } }, Ci: { nsIFile: {} },
    ChromeUtils: { importESModule: () => ({ ctypes: { char: { ptr: {} }, open(path) {
      calls.push(["open", path]); return { declare: name => api[name] };
    } } }) } });
  vm.runInContext(source, context); f.subject = context.subject; return f;
}
test("native adapter fails closed then revalidates host without reopening its live library", async () => {
  const f = fixture();
  assert.equal((await f.subject.prepare()).canInstall, false);
  f.state.available = true; f.state.state = "idle";
  assert.equal((await f.subject.prepare()).canInstall, true);
  assert.equal(f.calls.filter(call => call[0] === "open").length, 1);
  assert.ok(f.calls.filter(call => call[0] === "start").length >= 2);
  assert.equal(f.calls[0][1], "/app/Contents/Frameworks/libFluxionUpdater.dylib");
});
test("native status uses UI states and always frees copied native memory including malformed data", () => {
  const f = fixture();
  for (const [native, normalized] of [["awaiting-quit", "retry"], ["cancelled", "canceled"], ["installed", "current"], ["unavailable", "unsupported"]]) {
    f.state.state = native; assert.equal(f.subject.getState().state, normalized);
  }
  f.raw = "{"; assert.throws(() => f.subject.getState());
  f.raw = "x".repeat(16385); assert.throws(() => f.subject.getState(), /bound/);
  assert.equal(f.calls.filter(call => call[0] === "free").length, 6);
  f.nullPointer = true; assert.throws(() => f.subject.getState(), /no status/);
  assert.equal(f.calls.filter(call => call[0] === "free").length, 6);
});
test("native commands reject unsupported actions, oversized input and bridge refusal", () => {
  const f = fixture();
  assert.throws(() => f.subject.command({ action: "shell" }), /Invalid/);
  assert.throws(() => f.subject.command({ action: "install", version: "x".repeat(1024) }), /refused/);
  assert.equal(f.calls.length, 0);
  f.commandCode = 3; assert.throws(() => f.subject.command({ action: "retry" }), /refused/);
  f.commandCode = 0; f.subject.command({ action: "cancel" });
  assert.equal(f.calls.at(-1)[1].action, "cancel");
});
