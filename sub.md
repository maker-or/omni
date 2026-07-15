# Subagent MCP Bridge: Problems Found

> All findings — no solutions.

## 1. Single Shared Connection Per Agent Type

`acquireConnection()` caches one `LiveConnection` per `agentId` (`agent-connection-manager.ts:413-414`). Every `spawn_subagent` call to the same agent shares one process, one stdio pipe, one JSON-RPC channel. No connection pooling exists.

## 2. Parallel Spawns Time Out (claude-agent-acp, opencode-acp)

Parallel `session/new` + `session/prompt` calls on the shared connection interleave on a single stdio transport. The agents' ACP SDKs cannot safely multiplex concurrent session lifecycles — overlapping requests corrupt internal session state, causing prompt loops to deadlock or never return. Runs hit the 10-minute default timeout.

## 3. `codex-acp` ENOTDIR on Spawn (Any Count)

Codex-acp runs inside Electron's bundled Node via `ELECTRON_RUN_AS_NODE=1` (`registry.ts:454-466`). Its ACP adapter calls `getConfigMcpServerNames(cwd)` on `session/new`, which does `fs.stat` on `.codex/config`. Inside the packaged `.app` bundle, the resolved `cwd` fails with `ENOTDIR`. Not fixable in this repo.

## 4. `maxConcurrent: 3` Does Not Help

The FIFO semaphore (`subagent-manager.ts:482-498`) allows up to 3 runs to proceed concurrently, but they all land on the same shared connection. This makes the failure _more_ likely — serializing to 1 would at least work reliably for sequential use.

## 5. JSON-RPC Batch Rejected

`McpHttpServer` (`mcp-http-server.ts:142-145`) returns 400 for JSON-RPC batch arrays. The orchestrator cannot batch `tools/call` requests.

## 6. Concurrent Dispatch on Same Endpoint Token

Node's HTTP server processes requests concurrently. Two near-simultaneous POSTs to the same `/mcp/<token>` both enter `dispatch()` before either completes — both call `runSubagent()` in parallel, both send ACP messages on the same connection simultaneously.

## 7. Cancellation Race: Slot Accounting Glitch

When a run is cancelled while waiting on `acquireSlot()`, the waiter callback is never removed from `slotWaiters`. When a slot opens, the callback fires and increments `activeRuns`, then the `try` block throws immediately (line 401). `releaseSlot()` decrements it in `finally`, but `activeRuns` is temporarily inflated under cancellation load.
