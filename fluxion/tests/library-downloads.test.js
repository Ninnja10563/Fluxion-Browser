"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Downloads = require("../chrome/core/library-downloads.js");

test("download presentation distinguishes progress, resumable cancellation, missing files and blocks", () => {
  assert.equal(Downloads.describe({ hasProgress: true, currentBytes: 30, totalBytes: 100 }).status, "30%");
  const paused = Downloads.describe({ stopped: true, canceled: true, hasPartialData: true });
  assert.equal(paused.status, "Paused");
  assert.equal(paused.retryLabel, "Resume");
  assert.equal(paused.retry, true);
  assert.equal(Downloads.describe({ stopped: true, canceled: true }).status, "Canceled");
  const missing = Downloads.describe({ succeeded: true, stopped: true, target: { exists: false } });
  assert.equal(missing.status, "File moved or missing");
  assert.equal(missing.open, false);
  for (const input of [{ hasBlockedData: true }, { error: { becauseBlocked: true } }]) {
    const state = Downloads.describe({ stopped: true, ...input });
    assert.equal(state.status, "Blocked");
    assert.equal(state.retry, false);
    assert.equal(state.open, false);
  }
});

test("removing a download finalizes partial data before detaching its record", async () => {
  const calls = [];
  let finish;
  const download = { finalize: async flag => { calls.push(["finalize", flag]); await new Promise(resolve => { finish = resolve; }); } };
  const list = { remove: async target => { assert.equal(target, download); calls.push(["remove"]); } };
  const removing = Downloads.remove(download, list);
  assert.deepEqual(calls, [["finalize", true]]);
  finish();
  await removing;
  assert.deepEqual(calls, [["finalize", true], ["remove"]]);
});

test("failed cleanup retains the download record for recovery", async () => {
  let removed = false;
  await assert.rejects(Downloads.remove({ finalize: async () => { throw new Error("disk unavailable"); } },
    { remove: async () => { removed = true; } }), /disk unavailable/);
  assert.equal(removed, false);
});

function blockedFixture() {
  const calls = [];
  const download = { hasBlockedData: true,
    error: { becauseBlocked: true, becauseBlockedByReputationCheck: true, reputationCheckVerdict: "uncommon" },
    unblock: async () => calls.push("unblock"), confirmBlock: async () => calls.push("confirmBlock"),
  };
  return { download, calls };
}

test("removal completes native blocked-data and policy cleanup before detaching", async () => {
  for (const hasBlockedData of [true, false]) {
    const calls = [];
    const download = { hasBlockedData, error: { becauseBlockedByContentAnalysis: true },
      confirmBlock: async () => calls.push("confirmBlock"),
      respondToContentAnalysisWarnWithBlock: async () => calls.push("policyBlock"),
      finalize: async flag => calls.push(["finalize", flag]),
    };
    await Downloads.remove(download, { remove: async target => { assert.equal(target, download); calls.push("remove"); } });
    assert.deepEqual(calls, [hasBlockedData ? "confirmBlock" : "policyBlock", ["finalize", true], "remove"]);
  }
});

test("failed blocked-data cleanup keeps the record and does not finalize prematurely", async () => {
  await assert.rejects(Downloads.remove({ hasBlockedData: true,
    confirmBlock: async () => { throw new Error("blocked cleanup failed"); },
    finalize: async () => assert.fail("finalized before blocked cleanup"),
  }, { remove: async () => assert.fail("removed before blocked cleanup") }), /blocked cleanup failed/);
});

test("reputation review uses the native choice contract for the exact download", async () => {
  for (const action of ["unblock", "confirmBlock"]) {
    const { download, calls } = blockedFixture();
    const unrelated = blockedFixture();
    assert.equal(Downloads.describe(download).review, true);
    assert.equal(await Downloads.review(download, { confirm: async options => {
      assert.deepEqual(options, { verdict: "uncommon", becauseBlockedByReputationCheck: true, dialogType: "chooseUnblock" });
      return action;
    } }), action);
    assert.deepEqual(calls, [action]);
    assert.deepEqual(unrelated.calls, []);
  }
});

test("cancelled or unexpected native review decisions never release blocked data", async () => {
  for (const action of ["cancel", "open", undefined]) {
    const { download, calls } = blockedFixture();
    assert.equal(await Downloads.review(download, { confirm: async () => action }), "cancel");
    assert.deepEqual(calls, []);
  }
});

test("review refuses stale decisions after blocked data or its verdict changes", async () => {
  for (const change of [
    download => { download.hasBlockedData = false; },
    download => { download.error = { ...download.error }; },
    download => { download.error.reputationCheckVerdict = "malware"; },
    download => { download.error.becauseBlockedByContentAnalysis = true; },
  ]) {
    const { download, calls } = blockedFixture();
    let finish;
    const pending = Downloads.review(download, { confirm: () => new Promise(resolve => { finish = resolve; }) });
    change(download); finish("unblock");
    assert.equal(await pending, "stale");
    assert.deepEqual(calls, []);
  }
});

test("policy blocks and items without retained data cannot invoke reputation review", async () => {
  for (const change of [
    download => { download.hasBlockedData = false; },
    download => { download.error = { becauseBlocked: true, becauseBlockedByParentalControls: true }; },
    download => { download.error = { becauseBlocked: true, becauseBlockedByContentAnalysis: true }; },
  ]) {
    const { download, calls } = blockedFixture(); change(download);
    assert.equal(Downloads.describe(download).review, false);
    assert.equal(await Downloads.review(download, { confirm: async () => assert.fail("policy override prompted") }), "unavailable");
    assert.deepEqual(calls, []);
  }
});

function queueFixture(refresh) {
  let next = 0;
  const timers = new Map();
  const errors = [];
  const queue = Downloads.createRefreshQueue({ refresh,
    setTimer: callback => { timers.set(++next, callback); return next; },
    clearTimer: id => timers.delete(id), reportError: error => errors.push(error),
  });
  const tick = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); return callback(); };
  return { queue, timers, errors, tick };
}

test("continuous progress cannot postpone the first refresh or overlap pending queries", async () => {
  let finish;
  let calls = 0;
  const f = queueFixture(async () => { calls++; await new Promise(resolve => { finish = resolve; }); });
  f.queue.schedule();
  const timer = [...f.timers.keys()][0];
  for (let n = 0; n < 100; n++) f.queue.schedule();
  assert.deepEqual([...f.timers.keys()], [timer]);
  const first = f.tick();
  f.queue.schedule();
  assert.equal(f.timers.size, 0);
  assert.equal(calls, 1);
  finish(); await first;
  assert.equal(f.timers.size, 1);
  const second = f.tick(); finish(); await second;
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
});

test("teardown cancels queued work and prevents pending refresh from rescheduling", async () => {
  const first = queueFixture(async () => assert.fail("closed queue ran"));
  first.queue.schedule(); first.queue.close(); first.queue.schedule();
  assert.equal(first.timers.size, 0);
  let finish;
  const second = queueFixture(() => new Promise(resolve => { finish = resolve; }));
  second.queue.schedule(); const pending = second.tick(); second.queue.schedule();
  second.queue.close(); finish(); await pending;
  assert.equal(second.timers.size, 0);
});
