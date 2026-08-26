# Thread startup and switching benchmark

Status: DONE

## 500-turn / 200 MiB snapshot restore

| Metric                    |          Baseline |           Current |               Delta |
| ------------------------- | ----------------: | ----------------: | ------------------: |
| Snapshot paint            |            135 ms |            151 ms |              +16 ms |
| Background reconciliation |          8,225 ms |          6,989 ms |  -1,236 ms (-15.0%) |
| Peak process-tree RSS     |       2,285.1 MiB |       1,971.4 MiB | -313.7 MiB (-13.7%) |
| Average raw CPU           |             80.5% |             72.8% |         -7.7 points |
| Freeze incidents          |                 1 |                 0 |                  -1 |
| ACP parity                | 8,226 / 198.8 MiB | 8,226 / 198.8 MiB |           preserved |

The snapshot paint sample remains below the benchmark's 400 ms expectation. A second optimized sample painted in 103 ms; the final sample above is retained as the conservative comparison.

## 100-turn / 40 MiB live stream

- Completion: 4,662 ms
- Rows: 465 total / 11 mounted
- ACP parity: 1,586 updates / 39.8 MiB
- Freeze incidents: 0
- Peak process-tree RSS: 1,141.0 MiB
- Per-tool-call bridge deltas reduced bridge traffic from 75.51 MiB to 50.71 MiB (-32.8%) in consecutive runs.

The earlier live timeout was a harness defect: it scrolled the virtual list's inner height spacer rather than its scrollable parent, so the completion sentinel never mounted. The corrected harness completes the target workload.

## App open and milestone naming

The 10-turn / 4 MiB label-validation run recorded:

- Launch to interactive: 729 ms
- Renderer first contentful paint: 509.2 ms
- Snapshot click highlight: 22.2 ms
- Background reconciliation complete: 281 ms

Snapshot reconciliation is reported separately and is not labeled first paint or thread-ready.

## Artifacts

- Baseline snapshot: `/tmp/pipper-bench-20260826/snapshot-200mib-clean-retry/latest.json`
- Final snapshot: `/tmp/pipper-bench-optimized-20260826/snapshot-200mib-final/latest.json`
- Live stream: `/tmp/pipper-bench-optimized-20260826/live-40mib-v4-delta/latest.json`
- App-open naming: `/tmp/pipper-bench-optimized-20260826/app-open-label-v1/latest.json`
