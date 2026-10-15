export interface DatabaseCompactionResult {
  beforeBytes: number;
  afterBytes: number;
  reclaimedBytes: number;
  checkpointBusy: boolean;
}
