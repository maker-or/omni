# Pipper resource investigation, 15 October 2026

This change fixes measured retention and disk-growth paths. It does **not** establish a comparable reduction in total application RAM for eight short sessions, and it does not reproduce the reporting users' repositories or real Codex/Claude workloads.

## Measured results

The retention comparison uses three fresh before/after worker pairs, alternates run order, and compares against commit `490f89626a4c63b85a3723cf00be55288b74d192`. Highlighting uses the same committed TypeScript source and SHA-256 in every run. Tool/report fixtures contain generated high-entropy data and exercise production reducers, session lifecycle, SQLite persistence, and hydration with scripted ACP responses. These are controlled workloads, not recordings from customers. Heap figures are deltas after forced garbage collection, not OS RAM limits. Snapshot figures are actual allocated file blocks.

| Workload                                             | Before, median | After, median | Reduction |
| ---------------------------------------------------- | -------------: | ------------: | --------: |
| Highlight cache: 400 real source code blocks         |      51.30 MiB |      8.04 MiB |     84.3% |
| Completed subagents: 24 reports                      |      24.08 MiB |      0.57 MiB |     97.6% |
| Persisted tool expansion: 12 sessions                |      17.42 MiB |      2.80 MiB |     83.9% |
| Snapshot files: 24 text-heavy threads, 64 KiB budget |       0.87 MiB |      0.08 MiB |     91.0% |

Highlight generation time was 7.56s before and 7.54s after. Hydration took 79.2ms before and 79.8ms after. These measurements support retention improvements; they do not demonstrate a speed improvement.

Raw measurements: [retention-comparison.json](retention-comparison.json).

Two actual local databases were opened read-only and backed up through SQLite. Only disposable copies were compacted. All logical table contents were hashed before/after, all row counts were preserved, and `PRAGMA integrity_check` returned `ok`.

- Development database: 301.8 → 71.7 MiB; 230.1 MiB reclaimed. [Data](database-compaction-dev.json).
- Installed application database: 255.5 → 208.7 MiB; 46.8 MiB reclaimed. [Data](database-compaction-installed.json).

The built Electron app was also exercised with eight distinct mock ACP child processes and eight real Git worktrees, four turns per agent, and four 512 KiB tool payloads per thread. Every thread returned its complete tool history after persistence. The Storage screen's preference switch and compaction action were clicked successfully in Electron. Creating an additional Node worktree after disabling automatic installs emitted `skipped` and created neither node_modules nor a package lock; that temporary test worktree was then removed.

Final sampled process-tree RSS was 1304.0 MiB before and 1250.9 MiB after. This single short-run comparison is too close and noisy to establish a whole-app RAM improvement. Summed RSS counts shared pages in each process and is not unique physical memory. The processes are actual mock ACP adapters, not real model-provider CLIs. Stage snapshots are not peak measurements. [Before](agent-load-before.json), [after](agent-load.json).

## Findings and changes

1. **Unbounded syntax-highlight cache.** Source text keys and generated HTML survived for the renderer lifetime. The cache now evicts by recency with 256-entry and 8 MiB estimated-string budgets. Oversized results can still render; they are not permanently cached. This budget excludes mounted component state, Shiki grammars, and other application memory.
2. **Persisted tool bodies repopulated the main runtime cache.** Expanding traces loaded bodies back into every session's map until another snapshot happened. Persisted hydration is now request-scoped; live updates arriving during disk IO take precedence. Responses still return complete requested content.
3. **Completed subagents retained transcripts and connection references.** Completed activity records now retain compact history rather than the full slice and transport. The benchmark caught an additional V8 sliced-string issue: a 300-character preview retained its entire large report. Prefixes are now copied. Success, failure, and cancellation share cleanup.
4. **Snapshot disk budgeting ignored transcript rows.** Budget accounting now includes UTF-8 SQLite transcript bytes plus compressed payload files. Resident backing generations are pinned; they and the newest snapshot can exceed the soft budget rather than lose their payloads. SQLite page overhead is outside this budget. Old unreferenced Pipper generation files receive cleanup on the first write, with a 24-hour grace period. Unrelated files, recent generations, and symlinks are kept.
5. **Background timer/RAF throttling generated freeze incidents.** The installed database had 4,977 freeze incidents occupying approximately 159 MiB of table pages. 3,814 rows were recorded with hidden visibility and timer-drift source. Those historical flags alone do not prove each incident was false. The observer's previously unconditional timer/RAF gap path is reproduced in tests: hidden throttling and visibility transitions now produce no false freeze starts, while a visible 500ms stall still reports. Real Long Task observations remain enabled in the background. [Aggregates](local-freeze-baseline.json).
6. **SQLite free pages remained allocated.** The development database had 58,767 free pages. Settings → Storage → Reclaim space now compacts the app database in a worker thread without deleting logical records. SQLite compaction takes a write lock, may wait on database activity, and needs temporary disk space; failures are surfaced to the user. No live personal database was compacted during this investigation.
7. **Worktree dependency installation multiplies storage and concurrent installer processes.** The local scan found 13 worktrees. This checkout contained 1,092,726,062 bytes of dependency files, across 110,224 files, before the investigation installed the missing marketing test dependencies. Its allocated-block measurement was 1,423,790,080 bytes, which can overcount APFS shared clone extents. Most other worktrees here were small, so this is not a reproduction of customer disk exhaustion. Settings → Storage can disable automatic installs for new workspaces. Automatic installs retain their existing default, and existing worktrees are untouched. Installs are serialized and duplicate pending requests share a job. This does not deduplicate dependency contents or reclaim existing node_modules trees. [Inventory](local-storage-baseline.json).
8. **Obsolete managed updater installers could accumulate.** Recovery and successful downloads now remove obsolete managed installer files while keeping the current installer and unrelated files. Verified with actual temporary files; there was no measured production installer backlog, so no production savings are claimed.

## Coverage and limits

[Source inventory](source-inventory.json) records paths, hashes, sizes, line counts and resource-signal counts for all 711 tracked files at the time of inventory. It is a mechanical inventory, not a claim that every file received line-by-line manual review. Detailed review focused on the Electron agent/session, snapshot, connection, worktree/install, updater, terminal, database/monitor and renderer cache/reducer paths. Marketing, mobile, assets and most UI files were inventoried and included in the applicable build/test checks, not individually performance-profiled.

Remaining areas are explicit:

- Actual provider CLI memory, project build servers, and npm/pnpm/Bun cache and clone behavior need the affected workload. No customer repository, agent count or OS was supplied during this run.
- Short-run total process RSS has not shown a material win. Cache-retention percentages must not be presented as application-wide RAM reductions.
- Full tool `rawInput` remains in lean session records and renderer hydration caches can keep expanded content. These paths were observed in code; additional end-to-end measurements and UI-lifecycle changes are needed before changing their fidelity.
- Provider connections remain cached, and model discovery warms selected providers. Releasing those connections safely requires accounting for temporary catalog/auth requests and subagent users, not only open thread counts.
- Recorded monitor sessions and existing generated project files are not deleted automatically. The new worktree install toggle is a user choice, not an automatic storage reduction.
- There is no production memory ceiling, automatic deletion of user worktrees, dependency sharing via writable symlinks, or performance claim for Windows from this macOS run.

## Reproduce

Run with the repository's installed dependencies and Node 24. The full suite also imports the marketing project's attestation code, so `bun install --frozen-lockfile --ignore-scripts` in `marketing/` is needed if Astro is absent. The original `bench:fixture`, `bench:thread`, `bench:open`, and `bench:query` scripts reference absent ignored files under `benchmarks/`; the new resource harnesses live under tracked `scripts/`.

```sh
bun run bench:resources --baseline 490f89626a4c63b85a3723cf00be55288b74d192 --runs 3
bun run build
bun run bench:agents --check-settings
bun run audit:resources --database /path/to/omni.sqlite --directory /path/to/app-data
node scripts/benchmark-database-compaction.mjs /path/to/omni.sqlite
```

The retention harness archives the original commit into a temporary directory and never replaces working source. The live harness uses temporary user data, a temporary repository and worktree root, local mocks, and disabled analytics/remote access. `--app-root /path/to/built/baseline` allows a second build to run through the same live scenario. The original live baseline build only patched benchmark-mode protocol registration to prevent a test changing the OS protocol handler. Disk audits read metadata and skip symlinks; database audits read aggregates, not prompts or credentials. Compaction benchmarks operate on private temporary SQLite backups and delete them afterward.

## Validation

- Full Vitest regression suite passed: 855 tests across 126 files; four opt-in benchmark tests are skipped in the ordinary suite. Expo tests remain excluded by the repository configuration because that separate project's dependencies are not installed.
- Production build including macOS native helpers passed.
- React Doctor: 100/100, no findings.
- Lint passed with the same nine existing unused-variable warnings.
- Formatting and diff whitespace checks passed.
- An additional TypeScript comparison found 94 diagnostic lines in the original commit. The final change adds no TypeScript diagnostics; these existing errors are not presented as a passing full type check.
- Controlled retention runs, read-only local storage/database inventories, compaction content/integrity validation, and live Electron multi-agent/settings checks are saved alongside this report.
