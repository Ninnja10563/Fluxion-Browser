"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planGroupDrop, planGroupMove } = require("../chrome/core/flow-drag.js");
function fixture() {
  const allTabs = Array.from({ length: 8 }, (_, id) => ({ id, parentNode: {}, isConnected: true, workspace: "focus" }));
  const group = { tabs: allTabs.slice(0, 2), parentNode: {}, isConnected: true };
  const targetGroup = { tabs: allTabs.slice(5, 7), parentNode: {}, isConnected: true };
  for (const value of group.tabs) value.group = group;
  for (const value of targetGroup.tabs) value.group = targetGroup;
  const split = { tabs: allTabs.slice(2, 4), parentNode: {}, isConnected: true };
  for (const value of split.tabs) value.splitview = split;
  const common = { allTabs, workspaceId: "focus", workspaceOf: value => value.workspace };
  return { allTabs, group, targetGroup, split,
    drop: (tabs, target = targetGroup) => planGroupDrop({ ...common, tabs, group: target }),
    move: target => planGroupMove({ ...common, group, target }) };
}
test("either split pane and duplicate selections produce one intact native unit in native order", () => {
  const f = fixture();
  assert.deepEqual(f.drop([f.allTabs[3]]), [f.split]);
  assert.deepEqual(f.drop([f.allTabs[4], f.allTabs[3], f.allTabs[2], f.allTabs[4]]), [f.split, f.allTabs[4]]);
  assert.equal(f.allTabs[2].group, undefined);
  assert.deepEqual(f.split.tabs, f.allTabs.slice(2, 4));
});
test("existing group members are omitted and an entirely existing selection is a no-op", () => {
  const f = fixture();
  assert.equal(f.drop(f.targetGroup.tabs), null);
  assert.deepEqual(f.drop([f.allTabs[5], f.allTabs[4]]), [f.allTabs[4]]);
  assert.equal(f.drop([]), null);
});
test("group moves normalize ordinary rows, split panes and grouped split targets without flattening", () => {
  const f = fixture();
  assert.deepEqual(f.move(f.allTabs[4]), { group: f.group, target: f.allTabs[4] });
  assert.equal(f.move(f.allTabs[2]).target, f.split);
  assert.equal(f.move(f.split).target, f.split);
  assert.equal(f.move(f.allTabs[5]).target, f.targetGroup);
  f.split.group = f.targetGroup;
  for (const member of f.split.tabs) member.group = f.targetGroup;
  f.targetGroup.tabs.push(...f.split.tabs);
  assert.equal(f.move(f.split).target, f.targetGroup);
  assert.equal(f.move(f.allTabs[3]).target, f.targetGroup);
  assert.equal(f.move(f.group), null);
  assert.equal(f.move(f.allTabs[0]), null);
});
test("every split member and target group member must be live, unpinned and in this workspace", () => {
  for (const mutate of [tab => { tab.pinned = true; }, tab => { tab.closing = true; },
    tab => { tab.parentNode = null; }, tab => { tab.isConnected = false; }, tab => { tab.workspace = "other"; }]) {
    const source = fixture(); mutate(source.allTabs[3]);
    assert.equal(source.drop([source.allTabs[2]]), null);
    const target = fixture(); mutate(target.allTabs[6]);
    assert.equal(target.drop([target.allTabs[4]]), null);
    assert.equal(target.move(target.allTabs[5]), null);
    const group = fixture(); mutate(group.allTabs[1]);
    assert.equal(group.move(group.allTabs[4]), null);
  }
});
test("stale or foreign members, incomplete splits and mismatched identity backreferences reject atomically", () => {
  const foreign = fixture();
  foreign.split.tabs[1] = { ...foreign.allTabs[3] };
  assert.equal(foreign.drop([foreign.allTabs[2]]), null);
  const stale = fixture(); stale.split.tabs = [stale.allTabs[2]];
  assert.equal(stale.drop([stale.allTabs[2]]), null);
  const mismatch = fixture(); mismatch.allTabs[3].splitview = { ...mismatch.split };
  assert.equal(mismatch.drop([mismatch.allTabs[2]]), null);
  const target = fixture(); target.allTabs[6].group = { ...target.targetGroup };
  assert.equal(target.move(target.allTabs[5]), null);
  const detached = fixture(); detached.split.parentNode = null;
  assert.equal(detached.drop([detached.allTabs[2]]), null);
});
test("group moves cannot accept a half-owned split or empty and detached group wrappers", () => {
  const f = fixture(); f.allTabs[0].splitview = f.split; f.split.tabs = [f.allTabs[0], f.allTabs[2]];
  assert.equal(f.move(f.allTabs[4]), null);
  const empty = fixture(); empty.group.tabs = [];
  assert.equal(empty.move(empty.allTabs[4]), null);
  const detached = fixture(); detached.targetGroup.isConnected = false;
  assert.equal(detached.drop([detached.allTabs[4]]), null);
});
test("planning is immutable and uses live group identity rather than a persisted identifier", () => {
  const f = fixture(); f.group.id = f.targetGroup.id = "same-persisted-id";
  for (const tab of f.allTabs) Object.freeze(tab);
  Object.freeze(f.group.tabs); Object.freeze(f.targetGroup.tabs); Object.freeze(f.split.tabs);
  Object.freeze(f.group); Object.freeze(f.targetGroup); Object.freeze(f.split); Object.freeze(f.allTabs);
  assert.equal(f.move(f.targetGroup).target, f.targetGroup);
  assert.deepEqual(f.drop(Object.freeze([f.allTabs[3]])), [f.split]);
});
