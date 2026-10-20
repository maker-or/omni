import { expect, test } from "vitest";
import { SnapshotFreshness } from "./snapshot-freshness.ts";

test("measures persist lag from the first unpersisted settle and restore age", () => {
  const freshness = new SnapshotFreshness();
  freshness.noteSettled("t1", 1_000);
  // Repeated settling of the same pending revision keeps the earliest time.
  freshness.noteSettled("t1", 3_000);
  freshness.noteSettled("t2", 4_000);
  expect(freshness.summary(10_000).oldestPendingMs).toBe(9_000);

  freshness.notePersisted("t1", 5_000);
  freshness.forget("t2");
  freshness.noteRestored(2_000, 62_000);
  freshness.noteRestored(undefined, 62_000);

  expect(freshness.summary(70_000)).toEqual({
    persistLag: { count: 1, maxMs: 4_000, p50Ms: 4_000, p95Ms: 4_000 },
    restoreAge: { count: 1, maxMs: 60_000, p50Ms: 60_000, p95Ms: 60_000 },
    oldestPendingMs: null,
  });
});
