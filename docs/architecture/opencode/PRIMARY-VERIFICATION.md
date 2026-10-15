# Primary-agent verification alongside OpenCode exploration

These are independent primary-agent checks performed while the OpenCode reviewers examine separate source areas. They are not presented as OpenCode-authored findings. The raw artifacts distinguish reproduced behavior from performance hypotheses. No application implementation was changed.

## Monitor isolation fails in the current build

**Reproduced in the actual built Electron app.** `electron/monitor/worker-client.ts:235` constructs `new Worker(new URL("./worker.ts", import.meta.url))`. The compiled `out/main/index.js` retains that reference. The resolved `out/main/worker.ts` is absent: `electron.vite.config.ts` has the main entry but no emitted monitor worker entry. `electron-builder.yml:7` packages the build output; a source-only worker is not made reachable by that rule.

The saved verification script starts the existing built application with an isolated user-data directory, temporary Git project, mock ACP registry, remote disabled and analytics disabled, then reads the public `monitor.getLive()` interface. [Raw evidence](monitor-worker-verification.json) records:

- The built reference exists and the resolved worker file does not.
- Worker-health failure callbacks increment to 2; the final error is `Monitor worker exited with code 1`.
- Sampling continues, with three recorded sample ticks in the fixture interval.

The two callbacks are not proof of two distinct failed workers: the source increments on both error and a nonzero exit. `handleWorkerCrash` at `worker-client.ts:414` selects `useFallback`; `request` at line 351 calls `executeCommandInProcess` when that mode is set. Sampling's asynchronous subprocesses remain asynchronous, but database writes/pruning in that fallback execute on the calling main thread. The earlier architecture report's assertion that most sampling/recording was running in a worker was therefore incorrect for this build and has been corrected.

**Recommendation:** explicitly build and package the worker, resolve its emitted JS path, expose execution mode in health, and add a built-artifact startup test that asserts worker readiness without fallback. Preserve an intentional, tested degraded mode for actual worker failure. This check proves current-build behavior; it does not measure total CPU overhead or verify an already distributed installer.

Reproduce after `bun run build`:

```sh
node scripts/verify-built-monitor-worker.mjs
```

## Worker compaction still contends with synchronous main writes

**Reproduced using the production `compactDatabase` implementation and a private SQLite backup.** `electron/database-compaction.ts:21` runs `VACUUM` in a worker with its own connection. The main application connection uses `DatabaseSync` and `PRAGMA busy_timeout = 5000` in `electron/db.ts:173`. Moving the maintenance computation off thread does not remove SQLite's writer exclusion.

The probe opens the source read-only, creates a private backup, adds a tiny probe table, and detects the VACUUM writer lock using a zero-timeout update. It then attempts another synchronous update with the application's 5-second busy timeout. The original tables are not modified. [Raw evidence](compaction-contention-verification.json):

| Observation                     | Measured value |
| ------------------------------- | -------------: |
| Uncontended probe write         |       0.046 ms |
| Contended synchronous write     |    1,219.60 ms |
| Maximum 5 ms heartbeat interval |    1,220.57 ms |
| Integrity check                 |           `ok` |
| Worker checkpoint reports busy  |         `true` |

These are single controlled observations, not percentiles or a measurement of Electron paint. The lock-detection step deliberately ensures contention; it does not estimate how often users will hit it. Other investigation processes may compete for CPU. The worker's returned database-plus-WAL size also grew temporarily because checkpointing was busy; the reported reclaimed bytes were zero in this scenario. This is not evidence that VACUUM corrupted or permanently enlarged the database.

**Recommendation:** treat maintenance as shared-database work. Establish an idle/maintenance policy and asynchronous ownership of writes, or move the shared synchronous database operations behind a storage worker. Preserve SQLite locking, rollback, transactions and user data. A worker-only maintenance function cannot promise that the rest of the app stays responsive while main-thread writes wait for its lock.

**Regression check:** deliberately hold the maintenance writer lock while an application write is requested; verify that the UI/main-loop heartbeat continues, and that the write either completes later or returns a defined retryable result. Also test checkpoint-busy handling and disk usage after the final connection releases its readers/writers.

Reproduce against an explicitly chosen source path; only the backup is mutated:

```sh
node scripts/verify-compaction-contention.mjs /absolute/path/to/omni.sqlite
```

## Live process snapshot: useful for attribution, not a benchmark

[Process snapshot](live-process-snapshot.json) records names, parents and RSS for the running installed Pipper tree during exploration. It includes existing provider sessions, investigation tools and a descendant development Electron process. The sum is therefore not a steady-state application baseline and cannot be attributed to the three OpenCode tasks. RSS double-counts shared pages. It supplies a concrete process inventory for later attribution, not a claimed memory saving or leak rate.

The snapshot is another reason to report renderer/main, provider processes and investigation tools separately. A single undifferentiated process-tree number would misrepresent this workload.
