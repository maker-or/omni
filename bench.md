- To produce the conversrtation -> bun run bench:fixture -- --turns 500 --target-mib 200

- to run the benchmark -> bun run bench:thread -- --fixture benchmarks/fixtures/conversation-400turns-160mib.jsonl --runs 1  --output-dir benchmarks/results/scaling/400 --no-monitor

- To run the node-only benchmark -> bun run bench:thread -- --node-only --fixture benchmarks/fixtures/conversation-500turns-200mib.jsonl

Fixture

100 - 40 MiB

200 - 80 MiB

300 - 120 MiB

400 - 160 MiB

500 - 200 MiB

600 - 240 MiB

700 - 280 MiB

800 - 320 MiB

900 - 360 MiB

1000 - 400 MiB
