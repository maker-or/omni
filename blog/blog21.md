---
title: "We Benchmarked Live Conversation Streaming: Omni vs T3 Code"
description: "A reproducible performance comparison of live turn-by-turn conversation streaming. Identical data, identical hardware, interleaved runs — Omni ingested and rendered a 100-turn conversation ~56× faster. Full methodology inside."
date: 2026-08-21
author: "The Pipper Team"
category: "Engineering"
tags:
  - performance
  - benchmark
  - streaming
  - architecture
keywords:
  - streaming performance benchmark
  - AI coding app performance
  - conversation rendering benchmark
slug: streaming-benchmark-omni-vs-t3code
---

# We Benchmarked Live Conversation Streaming: Omni vs T3 Code

**TL;DR:** We streamed the same 100-turn, 40 MiB conversation into both apps, turn by turn, through each app's real ingestion pipeline, on one machine. Omni finished in **~3 seconds** per run. T3 Code took **~3 minutes**. The gap comes from an architectural choice: what each app does with a message between "the agent produced it" and "the user can read it." Here's what we measured, how we kept it fair, and where the numbers stop.

## What we measured

When you watch an AI coding assistant work, messages arrive as a stream of small updates — text chunks, tool results, status changes — many times a second. The desktop app has to store that stream, organize it into a conversation, and paint it on screen.

We wanted to answer one question: **how fast can each app swallow a long conversation that arrives live?**

The test:

1. Start with an empty conversation.
2. Feed it 100 turns (a turn = one user prompt plus the agent's full reply), one at a time, in order — the way a real session arrives.
3. Start the clock when the first turn is requested.
4. Stop it when the final turn is fully received _and_ visible on screen — verified by counting rendered rows in the app's real UI, not by asking the app when it thinks it's done.

A deterministic script generated the content: multi-paragraph replies, code blocks, and tool-call records, sized to 40 MiB across 235 messages. Both apps read the same file, and we confirmed the bytes matched by checksum rather than trusting two separately generated copies.

Both apps talked to a mock agent backend instead of a real model. A real model adds seconds of network latency per turn, which would bury the thing we're measuring: the cost of the app's own plumbing. With an instant backend, every millisecond in these numbers belongs to the app under test.

## How we kept it fair

Benchmarks usually break in predictable ways: mismatched data, warm caches, cherry-picked runs. Here's what we did about each.

**Same data, provably.** One fixture generator, one output file, copied to both sides. Checksums match.

**No cache carry-over.** Each measurement was a separate process launch — three launches per app, one cold-and-warm pair each. We skipped both apps' built-in repeat-run modes for the headline numbers, because repeated runs inside one process reuse warmed-up state and flatter whoever benefits.

**Interleaved execution.** Run order was Omni, T3, Omni, T3, Omni, T3, so thermal throttling or background load hits both sides equally instead of penalizing whoever goes second.

**Same telemetry.** Both harnesses sample CPU, memory, and GPU with the same OS-level tools at the same intervals, and compute the same summary statistics (median, p95) over the same run structure.

**Published raw output.** Every run's full capture file — timings, memory samples, process tables — ships with this post. If a number looks wrong, check it against the raw record.

## The numbers

Median of three attempts, 100 turns / 40 MiB each:

|                                |           Omni |                      T3 Code |
| ------------------------------ | -------------: | ---------------------------: |
| Cold stream + render           |     **3.15 s** |                      176.8 s |
| Warm stream + render           |     **2.74 s** |                      198.9 s |
| Average time per turn          |         ~31 ms |                    ~1,768 ms |
| Renderer heap growth           | flat (~21 MiB) | grew every run (33 → 71 MiB) |
| Whole-app peak memory          |    ~1.0–1.4 GB |                  ~2.1–2.4 GB |
| Frozen frames during streaming |              0 |                            0 |

Individual attempts:

| Attempt | Omni cold | Omni warm | T3 cold | T3 warm |
| ------- | --------: | --------: | ------: | ------: |
| 1       |    3.15 s |    2.74 s | 337.4 s | 198.9 s |
| 2       | 7.78 s \* | 15.6 s \* | 176.8 s | 187.2 s |
| 3       |    2.89 s |    2.66 s | 151.8 s | 216.5 s |

\* Attempt 2 ran right after a T3 run that had pinned the CPU for nine straight minutes, so the machine hadn't settled. Even Omni's worst number against T3's best leaves a gap above 20×.

Two details for precision:

- T3's timing includes about 0.4 seconds of structural overhead Omni's doesn't (a click-to-navigate wait and a small settle delay in its harness). At 177 seconds that's 0.2% — no effect on any conclusion, but it's there, so we're saying so.
- Neither app dropped a frame badly enough to count as a freeze. This is a throughput gap, not a jank contest.

## Why the gap exists

The gap survives warm runs, best-of attempts, and every tuning knob we touched. A difference that stable is structural, so follow one update through each app.

**In Omni**, an arriving update crosses from the agent into the main process over an already-open connection, gets applied to an in-memory conversation model through a small pure function, and a compact diff of what changed is pushed to the interface over the existing channel. No disk write, no re-encoding beyond what transport requires, no round-trip to any authority before the text appears. One hop, microseconds of real work.

**In T3 Code**, the same update takes a longer road. It enters through a local server, passes a validation/serialization layer, flows through a session manager, and gets written to durable storage — the conversation is persisted to disk as it grows. Only after the turn is durably recorded does the app call it complete and reflect that state back to the interface, which reconciles its view with what the server says is true. Every hop is reasonable on its own. Across 784 updates, they add up to roughly 1.8 seconds a turn.

So the framing isn't "T3 is slow." The two apps made opposite bets:

- **T3 is durability-first.** Every turn is committed to storage before the app admits it happened. Crash mid-conversation and nothing is lost. The price: your conversation speed is chained to your storage engine, on every update.
- **Omni is memory-first.** The live stream renders from memory at full speed; persistence happens off the critical path. The cost is a different engineering problem — keeping memory bounded across very long sessions — which is what our memory-growth instrumentation watches.

Neither bet is free. But for "how fast does a live conversation appear on screen," the memory-first pipeline wins by orders of magnitude, and tuning won't close the gap while a durability round-trip sits between the agent and the screen.

One more signal backs the structural read: T3 got _slower_ as conversations grew within our runs — warm runs consistently slower than cold, interface-side memory climbing across successive runs. Per-update costs that scale with conversation size point to work proportional to total history rather than to each new update. Omni stayed flat: warm runs marginally faster than cold, memory steady regardless of turn count.

## What this benchmark does not claim

- **It measures live ingestion only.** Opening an already-saved conversation is a different workload with different trade-offs, and our tests for that path aren't yet fair enough to publish. No claim here.
- **Absolute seconds don't transfer to real models.** With a real LLM, both apps spend multiple seconds a turn waiting on it. What transfers is the _overhead per turn_ — the app's own tax on every update — which is what this test isolates. Omni's tax is ~31 ms per turn; T3's is ~1,800 ms.
- **Zero freezes ≠ identical smoothness.** Both apps were stable under this workload. We're claiming a throughput and resource-efficiency gap, not a stability gap.
- **Mock backend, on purpose.** If you want to dispute these numbers, reproduce them with a real model endpoint — but know that mostly measures the model provider, which is why we didn't.

## Reproduce it

Everything is scripted and versioned: fixture generator, both runners, and the raw capture files for all six runs above (timings, memory samples, GPU/CPU telemetry, per-run metadata). Point both harnesses at the same fixture, run each once per launch, three launches each, interleaved, and compare medians. If your numbers come out materially different, tell us.

## The takeaway

If your day is spent watching agents work — streaming long sessions, switching threads, keeping dozens of conversations alive — the app's internal plumbing stops being academic. It sets whether the interface keeps up with the agent or falls behind.

We built Omni so the stream never waits for the machinery. This benchmark is the first public test of that, and it's the standard we'll keep publishing against.
