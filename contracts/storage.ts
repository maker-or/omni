export interface DatabaseCompactionResult {
  /**
   * completed: VACUUM ran. busy: the app did not become idle in time, so
   * nothing ran. insufficient-space: not enough free disk for SQLite's
   * temporary copy, so nothing ran.
   */
  status: "completed" | "busy" | "insufficient-space";
  beforeBytes: number;
  afterBytes: number;
  reclaimedBytes: number;
  checkpointBusy: boolean;
  /** Free bytes needed before compaction may start (insufficient-space). */
  requiredFreeBytes?: number;
  availableFreeBytes?: number;
}
