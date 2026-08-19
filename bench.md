- To produce the conversation -> bun run bench:fixture -- --turns 500 --target-mib 200

- Native open (session/load full history) -> bun run bench:thread -- --fixture benchmarks/fixtures/conversation-400turns-160mib.jsonl --runs 1 --output-dir benchmarks/results/scaling/400 --no-monitor

- All three jobs (native-open, resident-hydrate, live-turn-stream) -> bun run bench:thread -- --fixture benchmarks/fixtures/conversation-100turns-40mib.jsonl --axis all --runs 1 --output-dir benchmarks/results/scaling/100-jobs

- Live turn stream only -> bun run bench:thread -- --fixture benchmarks/fixtures/conversation-100turns-40mib.jsonl --axis live-turn-stream --runs 1

- To run the node-only benchmark -> bun run bench:thread -- --node-only --fixture benchmarks/fixtures/conversation-500turns-200mib.jsonl

Jobs are not one score. `native-open` times opening a long thread via session/load. `resident-hydrate` times click-to-paint when the session is already in memory. `live-turn-stream` times a live conversation (one session/prompt per fixture turn). Compare those to the matching T3 _user job_, not to a similarly named axis.

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
