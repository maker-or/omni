# Pipper

pipper is agentic inference which can update it-self

## Purpose

every individual has a different way of working , so instead of we adapting to the new tools and worlflow , what if the tool can evolve around us , think it as a claude code or codex instance costumoized to each individual's needs?

and pipper is built on ACP so it support many agents out of the box like claude code , codex , cursor , opencode , Grok, this open a completely new way to interact with all these agent , like i can use sol as orchitrator to spin up composer 2.5

## INSTALLATION

You can download actaul application from the pipper[https://www.pipper.dev/download] both the mac and windows builds are unsigned to for mac after droping the DMG into your Applications folder. run the following command in the terminal `xattr -cr "/Applications/Pipper Code (Alpha).app"` for the windows build i have seens the its running in the older windows machine , i can do much here

## Architecture

Pipper is a normal Electron desktop client with a stable launcher and a bundled renderer. The packaged application loads its UI from `out/renderer`; it does not start a guest Vite server or require a mutable active workspace.

The renderer talks to the Electron main process through the preload bridge. Main-process responsibilities include SQLite-backed projects and threads, ACP agent sessions, terminals, worktrees, MCP configuration, authentication, and launcher binary updates. User projects remain separate Git repositories and are used as agent working directories.

## Benchmarks

Generate a deterministic conversation fixture with `bun run bench:fixture`. The Electron thread benchmark defines four **separate jobs**; its current CLI exposes the publishable streaming job and the snapshot opening-latency job.

- `acp-session-load` / **native-open**: click a thread that is not resident. Clock includes `session/load` and full fixture replay.
- `persisted-thread-hydrate` / **resident-hydrate**: conversation already in the process session cache. Clock is click to paint.
- `persisted-thread-snapshot` / **snapshot-restore**: conversation is not resident, but a settled display snapshot is on disk. Clock is click to cached paint while ACP replay reconciles in the background.
- `live-turn-stream`: empty thread is already open. Clock includes every live `session/prompt` until the last turn paints. This is the streaming job.

```bash
bun run bench:thread -- \
  --fixture benchmarks/fixtures/conversation-v2-100turns-40mib.jsonl \
  --axis live-turn-stream \
  --runs 1
```

To assert the persisted snapshot opening budget:

```bash
bun run bench:thread -- \
  --fixture benchmarks/fixtures/conversation-v2-500turns-200mib.jsonl \
  --runs 1 \
  --axis persisted-thread-snapshot \
  --expect-snapshot
```

Reports print job name, ready time, **row counts**, and resource use.

To benchmark the conversation pipeline without opening Electron or Chromium, add `--node-only`. That report is not a UI comparison:

```bash
bun run bench:thread -- \
  --node-only \
  --fixture benchmarks/fixtures/conversation-500turns-200mib.jsonl \
  --runs 3
```

The node-only report is written to `benchmarks/results/node` by default. It measures fixture streaming, JSON parsing, the real session reducer, tool-payload retention, final state size, and process memory. It does not measure React, DOM, virtualization, or browser paint.
