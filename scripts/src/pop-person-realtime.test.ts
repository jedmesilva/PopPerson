import assert from "node:assert/strict";
import test from "node:test";
import {
  dueHitCountAt,
  hitAtForIndex,
  isTimelineComplete,
  projectileStartAtForIndex,
  type PopPersonTimeline,
} from "../../lib/api-zod/src/popPersonTimeline";

const timeline: PopPersonTimeline = {
  executeAt: 1_000,
  duration: 200,
  staggerMs: 100,
  count: 4,
};

test("uses one server timeline for projectile starts and hit timestamps", () => {
  assert.equal(hitAtForIndex(timeline, 1), 1_200);
  assert.equal(hitAtForIndex(timeline, 4), 1_500);
  assert.equal(projectileStartAtForIndex(timeline, 1), 1_000);
  assert.equal(projectileStartAtForIndex(timeline, 4), 1_300);
});

test("does not process a hit before its authoritative hitAt", () => {
  assert.equal(dueHitCountAt(timeline, 1_199), 0);
  assert.equal(dueHitCountAt(timeline, 1_200), 1);
  assert.equal(dueHitCountAt(timeline, 1_399), 2);
  assert.equal(dueHitCountAt(timeline, 1_800), 4);
});

test("completes only after every hit was persisted and its timeline elapsed", () => {
  assert.equal(isTimelineComplete(timeline, 3, 1_500), false);
  assert.equal(isTimelineComplete(timeline, 4, 1_499), false);
  assert.equal(isTimelineComplete(timeline, 4, 1_500), true);
});

test("deduplicates a hit by actionId and sequence", () => {
  const seen = new Set<string>();
  const persist = (actionId: string, sequence: number) => {
    const key = `${actionId}:${sequence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  assert.equal(persist("action-a", 3), true);
  assert.equal(persist("action-a", 3), false);
  assert.equal(persist("action-a", 4), true);
  assert.equal(persist("action-b", 3), true);
});

test("reconciles delayed and duplicated realtime events without replaying impact", () => {
  const visualized = new Set<string>();
  const values = new Map<string, number>();
  const impacts: string[] = [];

  const commit = (event: {
    actionId: string;
    hitIndex: number;
    value: number;
  }) => {
    const key = `${event.actionId}:${event.hitIndex}`;
    values.set(event.actionId, event.value);
    if (visualized.has(key)) return false;
    visualized.add(key);
    impacts.push(key);
    return true;
  };

  assert.equal(commit({ actionId: "action-a", hitIndex: 1, value: 9 }), true);
  assert.equal(commit({ actionId: "action-a", hitIndex: 1, value: 9 }), false);
  assert.equal(impacts.length, 1);
  assert.equal(values.get("action-a"), 9);
});

test("a snapshot cannot make stateVersion go backwards", () => {
  let version = 10;
  const applySnapshot = (incoming: number) => {
    if (incoming < version) return false;
    version = incoming;
    return true;
  };

  assert.equal(applySnapshot(9), false);
  assert.equal(version, 10);
  assert.equal(applySnapshot(11), true);
  assert.equal(version, 11);
});