# Streaming Ingest Benchmark (Omni vs T3 Code)

One test. The only workload measured identically by both harnesses: a fresh, empty conversation receives the entire fixture turn-by-turn through each app's real agent pipeline while the clock runs. The clock stops when the last turn is fully painted.

## Run

```sh
bun run bench:thread -- --fixture benchmarks/fixtures/conversation-100turns-40mib.jsonl --runs 1 \
  --output-dir benchmarks/results/testA-streaming/run1
```

- `--runs 3` loops inside one process; prefer separate invocations (`--runs 1`, three times) to avoid warm-cache flattering.
- Results land in `<output-dir>/latest.json` / `latest.md`, plus per-run captures under `results/runs/`.

To regenerate the fixture: `bun run bench:fixture -- --turns 100 --target-mib 40`.

## Comparing against T3 Code

The T3-side counterpart lives in `~/code/t3code/benchmark/` and runs its `acp-session-load` axis — semantically the same job (fresh thread, all turns inside the clock). Protocol used for the published numbers:

1. Interleave runs: omni → t3 → omni → t3 → omni → t3 (`--runs 1` each).
2. Take the median of the three attempts per mode.
3. Disclose the ~0.4 s of click/navigate/settle overhead included in T3's clock.

Published results and methodology: [`testA-streaming/REPORT.md`](testA-streaming/REPORT.md). Blog write-up: `blog/blog21.md`.

## Historical axes removed

The runner previously also supported `acp-session-load` (bulk session/load open) and `persisted-thread-hydrate` (click a resident thread). These were removed because neither has an equal-work counterpart in T3's harness — T3 windows persisted threads to roughly their last ten turns, so any hydrate/open comparison measures different amounts of work and is not defensible. The streaming test avoids that entirely: both apps must ingest 100% of the data through their own pipeline.
