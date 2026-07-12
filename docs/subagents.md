# Cross-agent subagents

Any ACP agent connected to Pipper can spawn any other installed agent as a
subagent. Claude can orchestrate Codex and Gemini workers; Codex can spawn
Claude; chains can nest up to a configurable depth.

## How it works

ACP has no way for a client to hand tools to an agent — but MCP does, and
every session Pipper creates already receives an `mcpServers` list at
`session/new` / `session/load` / `session/resume`. Pipper exploits that seam:

1. `SubagentManager` (electron/subagents/subagent-manager.ts) hosts a tiny
   in-process MCP server (`McpHttpServer`) on `127.0.0.1`. Each ACP session
   gets its own endpoint token at `/mcp/<token>`, so every tool call is
   attributable to the session that made it — that's what depth limits,
   parent→child cancel cascades, and the activity UI key off.
2. Every session's `mcpServers` list gets a `pipper-subagents` entry appended
   (agent-connection-manager.ts → `sessionMcpServers`). Agents that advertise
   http MCP capability get the URL directly; everyone else gets a stdio→HTTP
   proxy shim (`subagent-stdio-proxy.mjs`, materialized into userData), since
   stdio MCP is ACP's baseline transport.
3. When the orchestrator calls `spawn_subagent`, the manager acquires (or
   spawns) a live connection for the target agent **without switching the UI's
   active agent**, opens a fresh ACP session in the orchestrator's cwd, sends
   the task as a prompt, accumulates the streamed reply, and returns the
   subagent's final text as the tool result.

Subagent sessions are headless: their `session/update` stream never reaches
thread timelines, and their permission requests are auto-approved (configurable)
because there is no UI surface to answer them on. Aborting a thread, the
companion editor, or the updater cancels every subagent run it spawned.

## Tools exposed to agents

- `list_subagents` — ids, names, and descriptions of the agents the user
  allows.
- `spawn_subagent { agent_id, task, context?, cwd? }` — blocking; returns the
  subagent's final report. Orchestrators can issue several calls in parallel
  to fan out; the tool description tells them the subagent shares no context,
  so tasks must be self-contained.

## User configuration

`subagents.json` in the app's userData directory (also editable from the
renderer via `window.omni.subagents.getConfig/setConfig`):

```json
{
  "enabled": true,
  "allowedAgents": "all",
  "maxConcurrent": 3,
  "maxDepth": 2,
  "autoApprovePermissions": true,
  "runTimeoutMs": 600000
}
```

- `allowedAgents`: `"all"` (every installed non-mock agent) or an explicit id
  list, e.g. `["claude-agent-acp", "codex-acp"]`. Everyone's installed ACP
  agents differ, so this is per-user preference, not app policy.
- `maxDepth`: how deep chains may go. Depth 0 is a user-facing session; a
  session at depth ≥ maxDepth simply doesn't receive the tool, so runaway
  recursion is structurally impossible.
- `maxConcurrent`: runs beyond this queue rather than fail.
- `runTimeoutMs`: the client cancels runs that exceed this; partial output is
  returned with a timeout note.

## Renderer surface

`subagent-runs` bridge events carry snapshots of all runs (status, agent,
task preview, parent session, result preview) into `useAgentStore().subagentRuns`;
`window.omni.subagents.listRuns()` fetches them on demand.

### The `/subagent` composer

Typing `/subagent` in the thread composer (or picking it from the slash menu —
it's a client-side command from `CLIENT_COMMANDS` in src/lib/agent-commands.ts)
morphs the composer into orchestration mode
(src/components/subagent-composer.tsx):

- **Orchestrator picker** — any installed agent; if it differs from the
  current thread's agent, submit creates a fresh thread owned by that agent.
- **Auto mode** — describe the goal; the orchestrator decides how many
  subagents to spawn. `/subagent <text>` pre-seeds the goal.
- **Manual mode** — add N assignment rows, each with an agent (filtered by
  `allowedAgents`) and a task; an optional overall goal guides synthesis.
- **Inline settings** — `Parallel: N` and `Auto-approve: on/off` chips write
  through to `subagents.json`.

Submit composes one orchestration prompt
(src/lib/subagent-orchestration.ts → `composeOrchestrationPrompt`) instructing
the orchestrator to fan out via `spawn_subagent` (parallel where independent)
and synthesize the reports. Live run chips (src/components/subagent-activity.tsx)
render above the composer from `subagentRuns`: all active runs plus the three
most recently settled.

## Known limitations

- The orchestrator's own MCP client may enforce a per-tool-call timeout
  shorter than `runTimeoutMs`; very long subagent runs can be cut off on the
  caller's side even though the run itself completes.
