import assert from "node:assert/strict";
import test from "node:test";

type Candidate = {
  id: string;
  targetCellId: string;
  requestedAt: number;
};

function selectPartitionHeads(candidates: Candidate[], concurrency: number): Candidate[] {
  const heads = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = heads.get(candidate.targetCellId);
    if (
      !current
      || candidate.requestedAt < current.requestedAt
      || (
        candidate.requestedAt === current.requestedAt
        && candidate.id < current.id
      )
    ) {
      heads.set(candidate.targetCellId, candidate);
    }
  }
  return [...heads.values()]
    .sort((left, right) => left.requestedAt - right.requestedAt || left.id.localeCompare(right.id))
    .slice(0, concurrency);
}

function validateBatch(lastSequence: number, sequences: number[]): boolean {
  const unseen = sequences.filter((sequence) => sequence > lastSequence);
  if (unseen.length === 0) return false;
  return unseen.every((sequence, index) => sequence === lastSequence + index + 1);
}

function retryDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

test("serializes same-target work while allowing different targets in parallel", () => {
  const selected = selectPartitionHeads(
    [
      { id: "later-same-target", targetCellId: "cell-a", requestedAt: 2 },
      { id: "first-same-target", targetCellId: "cell-a", requestedAt: 1 },
      { id: "target-b", targetCellId: "cell-b", requestedAt: 3 },
      { id: "target-c", targetCellId: "cell-c", requestedAt: 4 },
    ],
    3,
  );

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["first-same-target", "target-b", "target-c"],
  );
});

test("accepts contiguous realtime batches and rejects gaps or duplicates", () => {
  assert.equal(validateBatch(10, [11, 12, 13]), true);
  assert.equal(validateBatch(10, [11, 13]), false);
  assert.equal(validateBatch(10, [9, 10]), false);
});

test("bounds exponential retry backoff before dead-lettering", () => {
  assert.equal(retryDelay(1, 1_000, 60_000), 1_000);
  assert.equal(retryDelay(3, 1_000, 60_000), 4_000);
  assert.equal(retryDelay(20, 1_000, 60_000), 60_000);
});