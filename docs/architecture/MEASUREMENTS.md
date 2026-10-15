# Measured architecture costs

Captured: 2026-10-15T06:48:52.734Z. 3 fresh instrumented Electron processes on darwin/arm64; v24.13.1. The current working tree includes earlier resource fixes.

[Interpretation and limitations](README.md#evidence-and-coverage). Values below are observations, not performance promises. No production refactor was benchmarked against these measurements.

## Thread and workspace requests

Wall-clock time around the Playwright-driven renderer IPC request or explicitly named manager call. Tiny local Git project, local mock CLI, no dependencies/network. Cold means a new **provider process**, not a cold OS page cache. Resident switching is ten alternating requests, reported both as a batch and average per switch. The renderer-store-create row includes its `refresh`; other create rows call preload directly. Full draft attachment/list-refresh work and first paint are excluded.

| Scenario                                  | Median ms | Observed range ms |
| ----------------------------------------- | --------: | ----------------: |
| cold-provider-thread                      |     66.27 |       63.67–67.56 |
| first-thread-warm-provider                |      8.20 |         7.70–9.52 |
| renderer-store-create                     |      7.60 |         5.73–8.21 |
| warm-same-agent-create                    |      4.30 |         3.44–6.08 |
| background-prompt                         |      8.16 |         6.89–9.06 |
| active-prompt                             |      9.45 |        8.02–12.38 |
| resident-switches-10                      |     68.73 |       67.69–80.20 |
| average per resident switch in each batch |      6.87 |         6.77–8.02 |
| close-persisted-thread                    |      2.44 |         2.37–2.45 |
| restore-persisted-thread                  |     10.44 |        6.31–10.58 |
| hydrate-tool                              |      2.04 |         2.02–2.53 |
| create-worktree                           |    145.99 |     145.54–162.46 |
| background-create-blocks-switch           |    449.54 |     447.50–451.45 |
| close-all-sessions                        |     12.50 |       12.05–14.07 |
| catalog-eight-agents                      |     48.25 |       47.09–62.40 |
| catalog-repeat                            |      4.12 |         3.55–4.30 |

`snapshot-settle` deliberately waits 2.3 seconds for the app's 2-second debounce. `idle-ten-seconds` is a fixture interval. Neither is a latency result. Startup values in the raw file include a fixed settling wait and are not app-open metrics.

## Main-process phases and repeated IO

Method durations are inclusive and overlap. IO counts cover the whole scenario, including renderer follow-up and background work landing in that interval. SQL statement execution is observed on the main database connection; statement preparation, worker database calls and stream internals are not comprehensively measured.

| Run | Monitor | Cold create internal ms | Spawn + initialize ms | ACP session/new ms | 10 resident switches: JSON reads / writes | Active deltas / background deltas |
| --- | ------- | ----------------------: | --------------------: | -----------------: | ----------------------------------------- | --------------------------------- |
| 1   | on      |                   47.68 |                 41.76 |               0.65 | 97 / 40                                   | 82 / 0                            |
| 2   | off     |                   46.90 |                 41.39 |               0.70 | 99 / 40                                   | 82 / 0                            |
| 3   | on      |                   50.80 |                 43.15 |               0.78 | 97 / 40                                   | 82 / 0                            |

All active prompt scenarios contain 80 assistant text chunks, one user echo and one tool update. They delivered 82 delta events, three full state events, one tool watermark and two running-thread events plus stop. Background text deltas were correctly suppressed. The harness explicitly selects the visible bridge gate for this comparison; it does not measure paint.

### Controlled queue blocking

| Run | Injected provider initialize delay ms | Resident switch wait ms | Total background preparation + switch ms |
| --- | ------------------------------------: | ----------------------: | ---------------------------------------: |
| 1   |                                   400 |                  428.70 |                                   450.32 |
| 2   |                                   400 |                  424.28 |                                   446.51 |
| 3   |                                   400 |                  426.14 |                                   448.58 |

The switch starts 20 ms after background creation. This demonstrates head-of-line blocking; the injected delay is not an observation about a real provider.

### Catalog lookup and process lifetime

| Run | Resident sessions before / after | Provider processes before / after catalog | Processes still cached after idle interval |
| --- | -------------------------------- | ----------------------------------------- | -----------------------------------------: |
| 1   | 0 / 0                            | 3 / 9                                     |                                          9 |
| 2   | 0 / 0                            | 3 / 9                                     |                                          9 |
| 3   | 0 / 0                            | 3 / 9                                     |                                          9 |

Before discovery, the normal, cold-test and intentionally slow providers were already cached. Eight selected providers include two of those; discovery starts six additional processes. The ninth cached provider is the controlled slow one. Provider-process counts are actual separate child processes; memory savings from a proposed lease policy are not measured.

## Snapshot access and write amplification

Actual `ThreadSnapshotStore`, synthetic high-entropy 4 MiB body set, 128 tools, requesting the last 16 IDs. Sequential/batched order alternates across trials; returned bodies are checked for equality.

| Trial | 16 separate loads ms | One batched load ms |
| ----- | -------------------: | ------------------: |
| 1     |               240.60 |               14.99 |
| 2     |               227.13 |               15.34 |
| 3     |               227.62 |               14.50 |

| Append | Changed JSON bytes | Base compressed bytes | New compressed bytes written | Write ms | Output / changed bytes |
| ------ | -----------------: | --------------------: | ---------------------------: | -------: | ---------------------: |
| 1      |              16413 |               3163979 |                      3176345 |    69.33 |                193.53× |
| 2      |              16413 |               3176345 |                      3188696 |    77.59 |                194.28× |
| 3      |              16413 |               3188696 |                      3201045 |    69.10 |                195.03× |

The write times include store work and budget enforcement against the small fixture database, not just compression. They exclude actual storage-device write amplification and are not CPU-only times.

## Read-only local database measurements

Dataset: 84 snapshot rows, 49674737 transcript bytes, 22673023 compressed-sidecar bytes reported in metadata. Live database state can change between independent audits.

| Query                                                  | Trials | Median ms |    Range ms |
| ------------------------------------------------------ | -----: | --------: | ----------: |
| Current exact budget query                             |     10 |     17.46 | 17.20–17.82 |
| Metadata-only lower bound, omits transcript accounting |     10 |      7.37 |   7.11–7.58 |

The comparison is not a correct replacement query. A correct optimization needs stored byte accounting, and potentially narrow metadata storage. Both queries run synchronously in the current architecture.

Largest transcript row: 12660833 bytes, 214 entries, 180 tool records. Median SQL get: 11.44 ms. Median JSON.parse: 6.80 ms. These are measured separately; neither includes complete store restoration, IPC or paint.

## Streaming reducer and panel projection

Actual production reducer and `toPanelSnapshot`, 1,000 text chunks after warmup; median of three repetitions. Settled user/assistant pairs and completed tool metadata are synthetic. No DOM rendering/layout/paint is included. These are independent cases with JIT/GC noise, not a strictly monotonic model.

| Prior entries | Tool records | Reducer only ms | Reducer + panel projection ms |
| ------------: | -----------: | --------------: | ----------------------------: |
|             0 |            0 |            0.39 |                          0.68 |
|             0 |          500 |            0.55 |                         10.08 |
|           500 |            0 |            0.36 |                         11.74 |
|           500 |          500 |            0.54 |                         17.21 |
|          1500 |            0 |            0.55 |                         33.82 |
|          1500 |          500 |            0.80 |                         27.30 |

Same 1048576-byte string as raw input: 1048656 bytes in a lean tool JSON record. As raw output: 352 bytes. This measures the current representation, not typical production input size.

## Renderer body-cache retention

Actual renderer cache module in a Node worker with forced GC: 24 threads × 524288 body bytes retained 11.90 MiB heap; explicit cache cleanup released 11.51 MiB. A final validation reference can retain one body during cleanup. This demonstrates the cache lifetime, not total Electron renderer RSS or a production leak rate.

## File inventory

513 JavaScript/TypeScript modules and 220 other files were indexed. Generated reports, ignored dependencies/build products and .git are excluded. [Full index](FILE-MAP.md), [AST details and hashes](module-map.json).

| Entry                                | Static local runtime reachability | Including dynamic imports |
| ------------------------------------ | --------------------------------: | ------------------------: |
| electron/main.ts                     |                                82 |                        83 |
| electron/agent-connection-manager.ts |                                31 |                        31 |
| src/main.tsx                         |                               130 |                       138 |
| src/App.tsx                          |                               127 |                       135 |
| src/components/agent-panel.tsx       |                                91 |                        95 |
| src/remote/main.tsx                  |                                16 |                        16 |
| src/settings/app.tsx                 |                                41 |                        45 |

Reachability includes the entry itself; type-only imports and third-party package internals are excluded. Runtime-resolved imports, native linking and filesystem behavior require additional tracing. Counts alone do not demonstrate a performance regression.
