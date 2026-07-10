# ACP Migration — Change Plan

> Section-by-section analysis of the Agent Client Protocol v1 and how Pipper must change to adopt it.
> Updated during discussion on 2026-07-09.

---

## Section 1: Initialization

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/initialization

### Key decisions from discussion

#### 1. `initialize` is one-time per connection, not per thread

- App starts → `initialize` handshake (once). Client + Agent negotiate version, capabilities, auth.
- Returning to an existing thread → `session/load` (covered later), not re-initialize.
- Creating a new thread → `session/new`, not re-initialize.
- Switching threads → optional `session/close` → `session/load` with different session ID.
- `initialize` only fires again on reconnect (connection drop or agent swap).

#### 2. Prompt capabilities gate UI elements

After `initialize`, the renderer stores `agentCapabilities.promptCapabilities` and uses it to show/hide features:

| Capability        | `true`                                    | `false`                      |
| ----------------- | ----------------------------------------- | ---------------------------- |
| `image`           | Show image attach button in input         | Hide it                      |
| `audio`           | Show audio attach (future)                | Hide it                      |
| `embeddedContext` | Allow file/@-mentions as embedded context | Hide or disable file context |

Current Pipper always shows image attach because pi-sdk always supports it. This must become dynamic.

**Store:** `agentCapabilities` lives in a zustand store (likely `agent-store.ts` or a new `acp-store.ts`), populated by the `initialize` response. Components read from it.

#### 3. MCP capabilities gate what's sent in session creation

MCP server configuration is **user intent** — stored persistently, independent of which agent is running.

| Layer               | Responsibility                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Storage**         | User's MCP server list saved in `electron/db.ts` (new `mcp_servers` table in `omni.sqlite`)                                                                  |
| **Capability gate** | `session/new` and `session/load` only include `mcpServers` array if `agentCapabilities.mcpCapabilities.http` or `.sse` is `true`                             |
| **Agent switch**    | If user switches to an agent that doesn't support MCP, the UI still shows their configured servers (they don't lose them), but they are not sent in requests |

**New DB table:**

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport_type TEXT NOT NULL,  -- 'http' | 'sse' | 'stdio'
  url TEXT,
  command TEXT,                  -- for 'stdio' transport
  args TEXT,                     -- JSON array
  env TEXT,                      -- JSON object
  created_at INTEGER,
  updated_at INTEGER
);
```

**How init response controls this:**

```typescript
// agent-store.ts or ACP transport layer
const { agentCapabilities } = await connection.initialize({...});

// Store for UI components to read
set({ agentCapabilities });

// Later, when creating a session:
const mcpServers = agentCapabilities.mcpCapabilities.http || agentCapabilities.mcpCapabilities.sse
  ? await db.getMcpServers()
  : []; // or omit field entirely

await connection.sessionNew({ cwd, mcpServers });
```

#### 4. Pipper-specific custom extensions

These are Pipper features ACP v1 doesn't cover. They'll use ACP's `_` prefix convention for custom methods. We'll define them as we encounter each spec section.

#### 5. Authentication

Clerk handles Pipper-level user auth. The `initialize` response will include `authMethods: []` (no agent-level auth required). This may change if we integrate agents that require their own auth (e.g., Gemini CLI API key).

### Files to change

| File                             | Change                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `package.json`                   | Add `@agentclientprotocol/sdk`                                                                                   |
| `electron/db.ts`                 | Add `mcp_servers` table + CRUD helpers                                                                           |
| `src/store/agent-store.ts`       | Replace `window.omni.agent.*` with `ClientSideConnection.initialize()` + store `agentCapabilities` from response |
| `src/electron.d.ts`              | Remove or simplify `window.omni.agent` types                                                                     |
| `electron/preload.ts`            | Remove `agent:*` IPC handlers, expose ACP transport                                                              |
| `electron/main.ts`               | Remove `ipcMain.handle('agent:*')`, wire `AgentSideConnection`                                                   |
| `electron/agent.ts`              | `AgentManager` → implements ACP agent methods (starts with `onInitialize`, more added per section)               |
| `contracts/agent.ts`             | Delete — replaced by SDK types + custom `_` extension types                                                      |
| `src/lib/message-utils.ts`       | Replace `AgentMessage` with `ContentBlock`                                                                       |
| `src/lib/agent-commands.ts`      | Replace `SlashCommandInfo` with `SessionUpdate.slash_command_update`                                             |
| `src/components/agent-panel.tsx` | Gate image attach button on `agentCapabilities.promptCapabilities.image`                                         |

## Section 2: Authentication

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/authentication

### Key decisions from discussion

#### 1. Pipper does NOT manage agent credentials

Users install and authenticate their agents (Cursor, Codex, Claude Code, etc.) **outside of Pipper**. Pipper spawns the agent process and the agent is already authenticated. This means:

- `authMethods` in the `initialize` response will typically be `[]` for already-authenticated agents
- If `authMethods` is non-empty, Pipper shows a UI message like _"This agent requires authentication. Please run `cursor auth login` in your terminal first."_
- No credential storage in Pipper's DB
- No OAuth flows in Pipper's UI for agent auth

#### 2. When auth happens in the flow

```
Clerk auth (Pipper-level, unchanged)
  → Agent selection from registry (user picks Cursor, Codex, Claude, etc.)
    → Initialize with agent → if authMethods non-empty, prompt user to auth externally
      → Project selection
        → Main workspace (session/new, session/load)
```

#### 3. Agent registry / selection

Pipper will show available ACP agents (installed on the user's machine or from the ACP registry). Users pick which agent to use. This happens:

- During onboarding (first-time setup)
- In settings (switching agents later)

Each agent may have different capabilities, models, and transport requirements.

### What needs to change

| File                                     | Change                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| New: `src/components/agent-selector.tsx` | Agent registry browser — shows available ACP agents, user picks one                                     |
| New: `src/store/agent-registry-store.ts` | Store for available agents, selected agent, connection state                                            |
| `electron/agents/` (new dir)             | Agent process launcher — spawns the right agent binary based on user selection, manages stdio transport |
| `src/launch/`                            | Add agent selection + auth step between Clerk auth and project selection                                |

### Related: Model picker via session config options

ACP provides `sessionConfigOptions` during `session/new` and `session/load` responses. Agents advertise available models via:

```json
{
  "configOptions": [
    {
      "id": "model",
      "name": "Model",
      "category": "model",
      "type": "select",
      "currentValue": "sonnet-4.5",
      "options": [
        { "value": "sonnet-4.5", "name": "Sonnet 4.5" },
        { "value": "haiku-4.1", "name": "Haiku 4.1" }
      ]
    },
    {
      "id": "thought_level",
      "name": "Thinking",
      "category": "thought_level",
      "type": "select",
      "currentValue": "high",
      "options": [...]
    }
  ]
}
```

**UI implications:**

- Each agent provides different models (Cursor models vs OpenAI models vs Anthropic models)
- Model picker in the thread bar reads from the session's `configOptions` array
- When user selects a model, Pipper calls `session/set_config_option` with `configId: "model"` and the chosen value
- `/rfds/model-config-category` also defines `model_config` category for secondary model parameters (context size, fast mode toggle, etc.)
- `/rfds/custom-llm-endpoint` defines `providers/list` and `providers/set` for routing LLM traffic through custom gateways

**The current pi-sdk model/thinking-level cycle logic in `electron/agent.ts` (`cycleModel`, `setModel`, `cycleThinkingLevel`, `setThinkingLevel`) becomes:**

1. Read available options from `configOptions` (from `session/new` response)
2. User picks → call `session/set_config_option`

**Key implication: Pipper must NOT hardcode any config option names or value labels.**
Each agent defines its own vocabulary:

| Concept   | Claude agent config                                                           | Codex agent config                                                                               |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Model     | `id: "model"`, values: `["sonnet-4.5", "haiku-4.1"]`                          | `id: "model"`, values: `["gpt-4o", "o3-mini"]`                                                   |
| Thinking  | `id: "thinking"`, category: `thought_level`, values: `["off", "low", "high"]` | `id: "reasoning_effort"`, category: `thought_level`, values: `["auto", "low", "medium", "high"]` |
| Fast mode | `id: "fast_mode"`, category: `model_config`, type: `boolean`                  | (may not exist)                                                                                  |

Pipper renders whatever the agent provides. The `category` field guides placement (group near model picker for `model_config`/`thought_level`), but the labels and values come from the agent.

### Files to change for model picker

| File                             | Change                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/components/agent-panel.tsx` | Model picker reads from session configOptions instead of `agentStore.getModels()`                                   |
| `electron/agent.ts`              | Remove `cycleModel`, `setModel`, `cycleThinkingLevel`, `setThinkingLevel` — replaced by `session/set_config_option` |
| `src/store/agent-store.ts`       | Remove model/thinking related methods, replace with configOptions store                                             |
| `contracts/agent.ts`             | `AgentModelSummary` → replaced by `ConfigOption` select values                                                      |
| `src/store/agent-store.ts`       | configOptions populated from BOTH `session/new` AND `session/load` responses — not just new sessions                |

### Model picker: new sessions vs resumed sessions

**`session/load` also returns `configOptions`.** The spec confirms `LoadSessionResponse` includes `configOptions` (v1 and v2). This means:

| Scenario           | configOptions source                 | What model picker shows                                                   |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------- |
| New thread         | `session/new` response               | All available models for this agent                                       |
| Resume thread      | `session/load` response              | Same structure — includes `currentValue` showing what model was last used |
| After model change | `session/set_config_option` response | Updated `currentValue` reflecting the change                              |

**Result:** The model picker is always driven by the most recent session response, whether new or resumed. No local model storage per thread needed. No "new thread vs resumed thread" UI distinction. The `configOptions` from `session/load` already reflects the agent's current config for that session — including which model was active.

---

## Section 3: Session Setup

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/session-management

### Session lifecycle vs Pipper thread model

Pipper uses a **tab-based thread model** (no sidebar). The session lifecycle maps directly to the tab lifecycle:

| Pipper action                | ACP method                                    | Notes                                                                                                                                                     |
| ---------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tab → open thread        | `session/new`                                 | Agent returns `session.id`. Store as `agent_session_id` in threads DB.                                                                                    |
| Switch to another open tab   | `session/close` (optional) + `session/load`   | Only `session/close` if agent limits concurrent sessions (memory). Best practice: close if switching away permanently; skip close for rapid tab switches. |
| Close tab                    | `session/close`                               | Frees agent resources. Session is preserved — can be reopened.                                                                                            |
| Delete thread (dropdown)     | `session/delete`                              | Permanent removal from agent history.                                                                                                                     |
| Reopen closed thread         | `session/load` with stored `agent_session_id` | Agent returns thread state.                                                                                                                               |
| Relaunch after agent restart | `session/resume` + `prev_session_id`          | Agent returns new `session.id` that replaces old one in DB.                                                                                               |

### Key constraints (from earlier discussion)

**Session is agent-bound.** A thread started with Cursor can ONLY be resumed with Cursor. Trying to open it with Codex would give a blank conversation because Pipper doesn't store message history — the agent is the source of truth.

This means:

- `agent_id` is a required column in the threads table
- Thread tab shows a visual indicator of which agent owns it (icon/name)
- Switching to a thread from a _different_ agent → terminate current agent process → spawn the correct agent → `initialize` → `session/load(agent_session_id)`
- User sees a brief "switching agent..." state during the swap

### Where `agent_id` comes from

The `initialize` response includes `agentInfo.name` (e.g., `"cursor"`, `"codex-cli"`, `"claude-code"`). This is the agent's canonical name and serves as `agent_id`.

**Uniqueness caveat:** Two instances of the same agent at different versions share the same `name`. For disambiguation, use `agentInfo.name + "@" + agentInfo.version` or append a Pipper-assigned UUID suffix during agent registration.

The user selects an agent from the **ACP registry** (during onboarding, settings, or via an agent picker). Pipper stores the mapping from "agent in registry" to `agentInfo.name` so it knows which binary to spawn.

The agent picker will show: available installed agents from the ACP registry, their capabilities, model lists, and which one is currently active.

### Thread data source

Thread list is populated from the **local DB** (`window.omni.threads.listProject()`), NOT from `session/list`. Rationale:

- Different agents own different sessions; `session/list` only returns sessions for the currently-connected agent
- DB stores threads across ALL projects and agents
- `session/list` is not used at all by Pipper

### Title flow

- ACP has no `session/rename` method — the agent owns the title
- Agent pushes title updates via `session_info_update` notification
- Pipper receives this, updates `title` in the local threads DB
- Thread tab re-renders with new title
- If user creates a thread via `/new` (sends first prompt immediately), title is `null` in DB until first `session_info_update`

### DB schema corrections

**threads table (final):**

```sql
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,           -- identifies which agent ("cursor-acp", "codex-acp", etc.)
  agent_session_id TEXT NOT NULL,   -- ACP session.id from session/new
  title TEXT,                       -- nullable; null until agent sends session_info_update
  sort_order INTEGER,              -- keep: used for tab ordering (insertAfter, delete shift)
  created_at INTEGER,
  last_used_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX idx_threads_project ON threads(project_id);
CREATE INDEX idx_threads_project_last_used ON threads(project_id, last_used_at DESC);
```

**Removed:**

- `session_file` column (replaced by `agent_session_id`)
- `messages` table entirely (agent is source of truth)

**mcp_servers table (new, from Section 1):**

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport_type TEXT NOT NULL,  -- 'http' | 'sse' | 'stdio'
  url TEXT,
  command TEXT,                  -- for 'stdio' transport
  args TEXT,                     -- JSON array
  env TEXT,                      -- JSON object
  created_at INTEGER,
  updated_at INTEGER
);
```

### Agent process management

Pipper's runtime needs a connection manager:

```
AgentConnectionManager (electron/)
  ├── currentAgentId: string | null
  ├── currentConnection: AgentSideConnection | null
  │
  ├── switchAgent(agentId: string): Promise<void>
  │     → close current connection → spawn agent binary → initialize
  │
  ├── getOrCreateConnection(agentId: string): Promise<AgentSideConnection>
  │     → returns existing if same agent, otherwise switchAgent
  │
  └── spawnAgent(agentId: string): ChildProcess
        → reads agent config from a registry/config file
        → spawns the agent process (e.g., `cursor acp`)
        → returns child process + sets up stdio transport
```

This replaces the current `AgentManager` in `electron/agent.ts`.

### session/resume vs session/load

| Scenario                            | Method                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Tab switch (same process)           | `session/load(session_id)`                                                                                           |
| Reconnect after agent crash/restart | `session/resume(prev_session_id)` — agent returns new session ID, replace old in DB                                  |
| First open of a thread              | `session/load(session_id)` (not resume, because this isn't a reconnect — there still IS a session on the agent side) |

**`session/resume`** is specifically for when the connection was lost (agent process died and was restarted). The agent's session was lost, but the agent recognizes the `prev_session_id` and can restore state from its own persistence layer.

### Files to change

| File                                          | Change                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/db.ts`                              | Update threads schema: remove `session_file`, add `agent_id`, `agent_session_id`. Remove `messages` table.                                                                                   |
| `electron/threads.ts`                         | Update CRUD: `agent_id` + `agent_session_id` params on create. `session_file` references → `agent_session_id`. Keep `sort_order` logic unchanged.                                            |
| `electron/agent.ts`                           | `AgentManager` → `AgentConnectionManager` with swarm logic: connect/disconnect per agent, spawn agent process, manage stdio. Handle `session_info_update` notification → update title in DB. |
| `electron/preload.ts`                         | IPC bridge: remove `agent:*` channels (old pi-sdk channel). Add channels for ACP transport.                                                                                                  |
| `src/store/agent-store.ts`                    | Store active session's `configOptions` from `session/new` / `session/load` responses. Store current `agent_id`.                                                                              |
| `src/lib/thread-queries.ts`                   | Update thread type references to include `agent_id`.                                                                                                                                         |
| `src/components/agent-panel.tsx`              | Thread tab shows agent indicator (icon based on `agent_id`). Model picker reads from store's `configOptions` (from session response).                                                        |
| `contracts/threads.ts`                        | Add `agentId` to `Thread` interface. Remove `sessionFile`.                                                                                                                                   |
| `contracts/agent.ts`                          | Delete.                                                                                                                                                                                      |
| New: `src/components/agent-selector.tsx`      | Agent registry browser + picker.                                                                                                                                                             |
| New: `src/store/agent-registry-store.ts`      | Available agents, selected agent, connection state.                                                                                                                                          |
| New: `electron/agents/config.json` or similar | Agent registry config — maps agent_id to spawn command, capabilities, etc.                                                                                                                   |

---

## Section 4: Prompt Turn

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/prompt-turn

### The lifecycle

```
session/prompt(sessionId, ContentBlock[])
  → session/update notifications stream back during processing
    → agent_message_chunk (text)
    → agent_thought_chunk (internal reasoning)
    → tool_call (new tool)
    → tool_call_update (tool progress)
    → plan (TODO list)
    → usage_update (tokens/cost)
  → session/request_permission (separate request, not a notification)
  → session/cancel (user abort, optional)
  → session/prompt response (stopReason: end_turn | max_tokens | refusal | cancelled)
```

### Key decisions

#### 1. No snapshot store — incremental event accumulation

Each `session/update` notification independently updates its slice in the store:

```
store.messages:    Record<messageId, AssistantMessage>   // agent_message_chunk
store.thoughts:    Record<messageId, string>              // agent_thought_chunk
store.toolCalls:   Record<toolCallId, ToolCallState>      // tool_call + tool_call_update
store.plan:        PlanEntry[] | null                     // plan (full replace each time)
store.usage:       { used, size, cost } | null            // usage_update (full replace)
store.configOptions: ConfigOption[]                       // config_option_update (full replace)
store.commands:    AvailableCommand[]                     // available_commands_update (full replace)
store.isStreaming: boolean
```

Components subscribe to only the slices they need. No monolithic re-render.

#### 2. `session/prompt` response replaces `window.omni.agent.prompt()` return

Current: `sendPrompt` → await snapshot refresh.
ACP: `session/prompt` → returns only `stopReason`. Content arrives via streaming `session/update` notifications during the turn.

#### 3. Cancellation

`session/cancel` notification replaces current `agentStore.abort()`. No separate IPC call.

### Eager session creation

When user opens a new thread tab, `session/new` fires immediately (before user types anything). This makes `configOptions` available instantly for model/mode/thought-level pickers in the composer. Cost of an idle agent session per open tab is negligible.

### New thread creation flow

```
1. User clicks "+" → project selection
2. User selects agent → AgentConnectionManager.switchAgent()
3. session/new → returns sessionId + configOptions
4. Thread opens with empty chat + composer showing model/mode/thought_level pickers
5. User adjusts config, types message, sends → session/prompt
```

### Slash commands removed

All existing hardcoded slash commands are removed. ACP slash commands are agent-advertised via `available_commands_update` notification. Pipper renders them in the autocomplete menu dynamically.

### Files to change

| File                                         | Change                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/store/agent-store.ts`                   | Replace snapshot with incremental store (messages, toolCalls, plan, usage, isStreaming). Remove sendPrompt → use session/prompt via ACP transport. Remove abort → use session/cancel. |
| `src/components/agent-panel.tsx`             | Replace `snapshot.messages` + `snapshot.streamingMessage` with accumulated store. Replace `snapshot.queue` with `plan` TODO list popover.                                             |
| `src/components/ui/thinking-indicator.tsx`   | Currently shown when `isStreaming && !streamingMessage`. ACP equivalent: shown when turn is active but no agent_message_chunk received yet.                                           |
| `src/components/ui/assistant-trace-deck.tsx` | Already renders `thinking` + `toolCall` trace parts. `agent_thought_chunk` → `thinking` trace. `tool_call`/`tool_call_update` → `toolCall` trace.                                     |
| `src/components/ui/context-window-ring.tsx`  | Replace `snapshot.stats` input with `usage` from usage_update.                                                                                                                        |
| `src/lib/agent-commands.ts`                  | Delete or replace — commands now come from `available_commands_update`, not hardcoded.                                                                                                |

---

## Section 5: Content Types

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/content

ACP uses the same `ContentBlock` types as MCP. Pipper's current message types must map to these.

### ContentBlock types for prompts (input)

| ACP type        | Pipper input                            | Gated by                             |
| --------------- | --------------------------------------- | ------------------------------------ |
| `text`          | User text input                         | Always supported                     |
| `resource`      | @-mention files (embedded file content) | `promptCapabilities.embeddedContext` |
| `resource_link` | File reference (agent fetches)          | Always supported (baseline)          |
| `image`         | Image attachment                        | `promptCapabilities.image`           |
| `audio`         | Audio attachment (future)               | `promptCapabilities.audio`           |

### Current mapping

Pipper currently sends: text string + optional base64 images. These become:

```json
{
  "prompt": [
    { "type": "text", "text": "user message" },
    { "type": "image", "data": "...", "mimeType": "image/png" }
  ]
}
```

File @-mentions (embedded context) become `resource` blocks.

### ContentBlock types in output (session/update)

Output content blocks appear in:

- `agent_message_chunk` → text content
- `tool_call` / `tool_call_update` → ToolCallContent (content, diff, terminal)

No UI change needed for output — existing ChatMessage and MarkdownRenderer handle text.

### Files to change

| File                             | Change                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/message-utils.ts`       | Replace `AgentMessage` types with `ContentBlock` types. `stringifyMessageContent` → handle ContentBlock.     |
| `src/components/agent-panel.tsx` | Input message assembly → produce ContentBlock[] instead of raw text. Prompt capabilities gate content types. |
| `contracts/agent.ts`             | Delete — `AgentPromptImage` → `ContentBlock::Image`. `AgentPromptInput` → `ContentBlock[]`.                  |

---

## Section 6: Tool Calls

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/tool-calls

### Lifecycle

```
tool_call(toolCallId, status: "pending")      // created
  → tool_call_update(toolCallId, status: "in_progress")  // running
    → tool_call_update(toolCallId, status: "completed", content: [...])  // done
    → tool_call_update(toolCallId, status: "failed")  // error
```

### Permission requests

Before sensitive tool execution, agent sends `session/request_permission` with `options`:

- `allow_once` / `allow_always` / `reject_once` / `reject_always`

Pipper responds with `{ outcome: { outcome: "selected", optionId: "..." } }`.

Current `AgentUiRequest` (select/confirm/input) maps to this. `allow_always`/`reject_always` imply Pipper should persist the choice.

### Tool kind

`kind` field helps choose icons: `read`, `edit`, `delete`, `search`, `execute`, `think`, `fetch`, `other`.

### Content in tool calls

Tool calls can produce:

- `content` — standard ContentBlock (text)
- `diff` — file modifications with `oldText`/`newText` (for rendering as diff view)
- `terminal` — live terminal output via `terminalId`

### Existing UI mapping

| ACP tool event                   | Current component                                  |
| -------------------------------- | -------------------------------------------------- |
| `tool_call` (pending)            | `AssistantTraceDeck` creates `toolCall` trace part |
| `tool_call_update` (in_progress) | Updates trace status                               |
| `tool_call_update` (completed)   | Trace shows completed state                        |
| `diff` content                   | No existing diff UI — future                       |

### Files to change

| File                                         | Change                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `src/store/agent-store.ts`                   | `toolCalls` record: create/update/remove by `toolCallId`         |
| `src/components/ui/assistant-trace-deck.tsx` | Already renders toolCall traces — may need `kind` icon mapping   |
| `src/components/agent-panel.tsx`             | `AgentUiRequest` → `session/request_permission` response handler |
| `electron/agent.ts`                          | Remove old permission logic — replace with `onRequestPermission` |

---

## Section 7: Slash Commands

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/slash-commands

### Agent-advertised, not hardcoded

Agent sends `available_commands_update` notification after session creation (and can update dynamically):

```json
{
  "sessionUpdate": "available_commands_update",
  "availableCommands": [
    { "name": "web", "description": "Search the web", "input": { "hint": "query" } }
  ]
}
```

### Execution

Commands are run as regular `session/prompt` with `/name` text. Pipper just inserts the command text — no special handling.

### Decisions

- All existing hardcoded slash commands (`/new`, `/compact`, etc.) are removed
- Slash command menu is populated dynamically from `available_commands` in the store
- When user selects a command, insert `/name ` into input (add space if command has `input.hint`)
- On submit, send as normal `session/prompt`

### Files to change

| File                             | Change                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/agent-commands.ts`      | Delete — replace with store reading `availableCommands`                                     |
| `src/components/agent-panel.tsx` | Autocomplete reads from `store.commands` instead of `mergeAgentCommands(snapshot.commands)` |
| `src/store/agent-store.ts`       | Store `commands` array from `available_commands_update`                                     |

---

## Section 8: Cancellation

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/cancellation

### Two layers

1. `session/cancel` — prompt-turn cancellation (what user triggers via abort button)
2. `$/cancel_request` — generic JSON-RPC cancellation (used by agent for cascading)

### Flow

```
User clicks abort → Client → session/cancel(sessionId)
  → Agent cascades: $/cancel_request to nested operations
    → Client responds -32800 for each cancelled nested request
  → Agent → session/prompt response (stopReason: "cancelled")
```

### Decision

- `session/cancel` replaces Pipper's current `abort()` method
- Client MUST respond to all pending `session/request_permission` with `cancelled` outcome after sending `session/cancel`
- Client SHOULD continue accepting tool call updates after sending cancel (agent may send final updates before responding)

### Files to change

| File                       | Change                                            |
| -------------------------- | ------------------------------------------------- |
| `src/store/agent-store.ts` | `abort()` → send `session/cancel` notification    |
| `electron/agent.ts`        | Remove old abort logic — handled by ACP transport |

---

## Section 9: File System

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/file-system

### Client capabilities (Agent → Client calls)

ACP defines `fs/read_text_file` and `fs/write_text_file` that the Agent calls on Pipper. Pipper advertises support via `clientCapabilities.fs` in `initialize`:

```json
{
  "clientCapabilities": {
    "fs": { "readTextFile": true, "writeTextFile": true }
  }
}
```

### Current state

Pi-sdk handles file access directly (agent has full filesystem access). With ACP, the agent still has direct filesystem access — `fs/*` methods are specifically for:

1. Reading unsaved editor state
2. Letting Pipper track file modifications

### Decision

- Implement `fs/read_text_file` and `fs/write_text_file` handlers in the ACP transport layer
- Advertise `clientCapabilities.fs.readTextFile: true, writeTextFile: true` in initialize
- For now, delegate to Node.js `fs` module (same as what pi-sdk does)

### Files to change

| File                                                 | Change                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `electron/main.ts` or new `electron/acp-handlers.ts` | Implement `onReadTextFile` / `onWriteTextFile` handlers                                     |
| `electron/preload.ts`                                | Expose fs methods if needed for IPC (unlikely — agent calls them directly on the transport) |

---

## Section 10: Architecture — Streaming Store Model

### Core principle: no snapshot

ACP has 11 `session/update` variants. Each updates exactly one slice of state. Components subscribe independently.

### Store shape

```typescript
interface AcpStore {
  // Messages built from chunks
  messages: Record<string, { text: string; thought: string; toolCalls: string[] }>;
  activeMsgId: string | null;
  activeText: string; // accumulated from agent_message_chunk

  // Tool calls with independent lifecycle
  toolCalls: Record<string, ToolCallState>;

  // Full-replace entities
  plan: PlanEntry[] | null;
  usage: { used: number; size: number; cost?: { amount: number; currency: string } } | null;
  configOptions: ConfigOption[];
  commands: AvailableCommand[];

  // Streaming state
  isStreaming: boolean;
}
```

### Event handler dispatch

```typescript
handleUpdate(update: SessionUpdate): void {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      // Append text to messages[messageId]
    case "agent_thought_chunk":
      // Append to messages[messageId].thought
    case "tool_call":
      // Insert toolCalls[toolCallId]
    case "tool_call_update":
      // Merge into toolCalls[toolCallId]
    case "plan":
      // Replace plan entirely
    case "usage_update":
      // Replace usage
    case "config_option_update":
      // Replace configOptions entirely
    case "available_commands_update":
      // Replace commands entirely
    case "current_mode_update":
      // Update current mode
    case "session_info_update":
      // Update title in DB
    case "user_message_chunk":
      // During session/load history replay
  }
}
```

### UI mapping (zero UI changes)

| ACP event                        | Existing component                             | Store slice               |
| -------------------------------- | ---------------------------------------------- | ------------------------- |
| `agent_message_chunk`            | ChatMessage + MarkdownRenderer in virtual list | `messages[msgId].text`    |
| `agent_thought_chunk`            | AssistantTraceDeck (thinking traces)           | `messages[msgId].thought` |
| `tool_call` / `tool_call_update` | AssistantTraceDeck (toolCall traces)           | `toolCalls[toolCallId]`   |
| `usage_update`                   | ContextWindowRing + cost display               | `usage`                   |
| `plan`                           | **New**: plan popover attached to composer     | `plan`                    |
| `available_commands_update`      | Slash autocomplete menu                        | `commands`                |
| `config_option_update`           | Model picker / thought level / mode buttons    | `configOptions`           |
| `session_info_update`            | Thread tab title                               | DB update                 |

### Plan popover UX

- Appears during agent execution as a dropdown attached to the composer (same positioning as model picker: `absolute right-0 bottom-full`)
- Shows plan entry `content` text only (no priority)
- Completed entries show a checkmark
- Popover auto-closes when `stopReason` is received (turn complete)

---

## Section 11: Terminals

**ACP Spec:** https://agentclientprotocol.com/protocol/v1/terminals

### Overview

Terminals let the agent run shell commands on Pipper's machine via Pipper's process management. The agent calls Pipper; Pipper spawns `child_process`, streams output, manages lifecycle.

### Methods

| ACP method               | What Pipper does                                                         |
| ------------------------ | ------------------------------------------------------------------------ |
| `terminal/create`        | Spawn `child_process.spawn()`, return `terminalId` (UUID)                |
| `terminal/kill`          | Send SIGTERM to process. terminalId stays valid for output/exit queries. |
| `terminal/output`        | Return buffered output + truncated flag + exit status                    |
| `terminal/wait_for_exit` | Await exit promise, return exit code + signal                            |
| `terminal/release`       | Kill if running + delete from map. terminalId invalid after.             |

### Capability advertisement

Pipper advertises `clientCapabilities.terminal: true` in the `initialize` request. Without this, agents don't call terminal methods.

### TerminalManager (Electron main process)

```typescript
interface TerminalInstance {
  process: ChildProcess;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  exitResolve: () => void;
  exitPromise: Promise<void>;
}

class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();

  create(params): string {
    const id = crypto.randomUUID();
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd,
      env: { ...process.env, ...formatEnv(params.env) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Track output with byte-limit truncation
    // Emit IPC events to renderer per chunk
    // Handle exit
    this.terminals.set(id, instance);
    return id;
  }

  kill(id): void {
    /* SIGTERM, keep terminalId */
  }
  getOutput(id): TerminalOutput {
    /* return buffered output */
  }
  waitForExit(id): Promise<ExitStatus> {
    /* await exitPromise */
  }
  release(id): void {
    /* kill + delete */
  }
}
```

### Output streaming to renderer

When a terminal is embedded in a tool call (`ToolCallContent::Terminal`), the tool call card needs to show live output:

1. **Electron main** → pushes each stdout/stderr chunk to renderer via IPC:
   ```
   mainWindow.webContents.send("terminal-output", {
     terminalId: "term_xyz",
     output: "...chunk of text...",
     append: true,
   })
   ```
2. **Renderer** → accumulates output per `terminalId` in a store (zustand or React state)
3. **Tool call card** → when content has `type: "terminal"`, subscribes to the accumulated output for that `terminalId`, renders in a scrollable terminal-like view that auto-scrolls to bottom
4. **On release/exit** → card shows final output with exit code

### Edge cases

| Case                                    | Handling                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Output byte limit**                   | Truncate from start of buffer when exceeded. Must truncate at character boundary (not byte).  |
| **Cancellation via `$/cancel_request`** | If agent cancels the prompt turn, cascades to terminal/kill for all active terminals          |
| **Zombie prevention**                   | Pipper kills all tracked processes on app exit                                                |
| **Concurrent terminals**                | Multiple terminals per session allowed, tracked independently by terminalId                   |
| **Environment variables**               | Merge provided env vars on top of `process.env`                                               |
| **Working directory**                   | `cwd` must be absolute path; omit = default to process cwd                                    |
| **Process never exits**                 | Agent calls terminal/kill + terminal/release when done. No timeout — agent manages lifecycle. |

### Tool call content rendering

Current `AssistantTraceDeck` doesn't handle terminal content. Two approaches:

- **Simple**: store accumulated output per terminalId in a store, render terminal tool call content as a `<pre>` block with monospace text, auto-scrolling, and a subtle terminal header bar (command + exit code)
- **Advanced**: use a terminal emulator like xterm.js for ANSI escape code rendering (if agents output colored logs)

Start with the simple approach — the spec doesn't mandate ANSI support.

### Files to change

| File                                         | Change                                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New: `electron/terminal-manager.ts`          | `TerminalManager` class — spawn, track, kill, output, wait, release                                                                                                                                  |
| `electron/agent.ts`                          | Replace `AgentManager` with `AgentConnectionManager`. Register `onTerminalCreate`, `onTerminalKill`, `onTerminalOutput`, `onTerminalWaitForExit`, `onTerminalRelease` handlers on the ACP transport. |
| `electron/preload.ts`                        | Expose IPC channel `terminal-output` for renderer to receive output chunks                                                                                                                           |
| New: `src/store/terminal-store.ts`           | Accumulate output per `terminalId` from IPC events                                                                                                                                                   |
| `src/components/ui/assistant-trace-deck.tsx` | Handle `ToolCallContent::Terminal` — render terminal content type with live output view                                                                                                              |
| `src/electron.d.ts`                          | Add terminal IPC types                                                                                                                                                                               |

- No existing UI to remove — this is net new

---

# Gaps — functionality NOT covered by the 11 sections above

## A. Named agent-client operations not in ACP spec

### A.1 `replacePrompt`

- **IPC**: `agent:replacePrompt`
- **What**: Edit-and-resend — user edits a previous message, re-sends it
- **ACP gap**: No standard method. Propose custom `_pipper/replace_prompt` with `{promptId, text}` body
- **Files**: `electron/agent.ts` → `preload.ts` → `agent-panel.tsx`

### A.2 `compact`

- **IPC**: `agent:compact`
- **What**: Continue-when-context-full. Agent summarises history and continues
- **ACP gap**: No equivalent. Either custom `_pipper/compact` or leave to agent-internal handling
- **Likely outcome**: Drop the explicit UI trigger; let the agent decide when to compact. `isCompacting` flag still useful for UI feedback

### A.3 `setEditorText` / `getEditorText` / `pasteToEditor` / `reportEditorText`

- **IPC**: `agent:setEditorText`, `agent:getEditorText`, `agent:pasteToEditor`, `agent:reportEditorText`
- **What**: Agent reads/writes text to the user's code editor (VS Code-like)
- **ACP gap**: These are about agent↔editor communication. Not in spec. Propose `clientCapabilities.textEditor` capabilities group:
  - `_pipper/setEditorText` → `{text: string}`
  - `_pipper/getEditorText` → `{text: string}`
  - `_pipper/pasteToEditor` → `{text: string}`
  - `_pipper/reportEditorText` → notification `{text: string}`

## B. Editor mode (Companion View)

- **IPC namespace**: `editor:*`
- **Component**: `companion-view.tsx` — a second, independent agent panel opened in a separate Electron BrowserWindow
- **What**: Full second agent lifecycle — activate, sendPrompt, abort, setModel, dispose. Has its OWN event stream (`editor:event`), its OWN snapshot, its OWN IPC channel
- **`companion:open` / `companion:minimize` / `companion:close`** manages the companion BrowserWindow
- **Entirely absent from current plan**. Needs its own section mapping `editor:*` → ACP `session/new` + `session/load` with a separate connection or a multiplexed session on the same connection

### B.1 Editor IPC surface

| Current IPC         | Proposed ACP mapping                                            |
| ------------------- | --------------------------------------------------------------- |
| `editor:activate`   | `session/new` with session metadata for "editor mode"           |
| `editor:getState`   | `session/load` (returns configOptions + initial messages state) |
| `editor:sendPrompt` | Standard prompt turn via `session/update` (same as main agent)  |
| `editor:abort`      | `session/cancel`                                                |
| `editor:setModel`   | Model change via config in `session/update`                     |
| `editor:dispose`    | `session/close`                                                 |
| `editor:event`      | Same ACP events as main agent — events dispatched per session   |

### B.2 Companion window management

- `companion:open` — create new BrowserWindow, load the companion route, create editor session
- `companion:minimize` / `companion:close` — standard window operations
- ACP doesn't define this; keep as is but replace `editor:activate`/`dispose` with session calls

## C. Updater mode

- **IPC**: `update:getUpdaterSnapshot`, `update:onUpdaterEvent`
- **Event stream**: `updater:event` (uses same `AgentBridgeEvent` type)
- **What**: Pipper uses a temporary agent session to auto-commit code changes during the self-update flow
- **Architecture**: Runs a one-shot agent session, gets snapshot updates via the same event bridge pattern
- **Proposed**: Replace with ACP `session/new` → prompt turn with auto-commit instructions → `session/close`. The updater can instantiate a lightweight `AgentConnection` without opening a UI

## D. `pipper:*` IPC — self-improvement system

| Current IPC                | ACP relevance                                        |
| -------------------------- | ---------------------------------------------------- |
| `pipper:enterEditMode`     | Kept as-is (Electron overlay logic, not agent-level) |
| `pipper:exitEditMode`      | Kept as-is                                           |
| `pipper:setProcessing`     | Kept as-is (companion UI state)                      |
| `pipper:setOverlayVisible` | Kept as-is (companion UI state)                      |
| `pipper:addComment`        | Kept as-is (creates a comment in the editor overlay) |
| `pipper:acceptChanges`     | Kept as-is (git-commit edited files)                 |
| `pipper:rejectChanges`     | Kept as-is (discard changes)                         |
| `pipper:stateChanged`      | Kept as-is                                           |
| `pipper:commentAdded`      | Kept as-is                                           |

- **Not agent-level operations** — these are overlay/git-commit operations on the editor side. No ACP change needed.

## E. Existing terminal system (`terminal:*`)

- **Current**: Pipper already has `terminal-store.ts` + `terminal:*` IPC for **interactive user terminals** (xterm.js — user types commands)
- **ACP terminals**: **Agent-facing** — the agent asks Pipper to run commands and stream output
- **These are different systems** that share the same IPC namespace
- **Need to decide**: Keep the existing `terminal:*` for user terminals, add a separate channel or namespace for ACP agent-requested terminals. Or merge them — the xterm.js component could also show agent-spawned terminal output

## F. Messages IPC — removal

- `messages:list` / `messages:create` routes in both preload and Electron main must be removed
- Plan mentions removing the `messages` table from DB but doesn't explicitly call out removing the IPC handlers

## G. Contracts to update

- `contracts/agent.ts` — `AgentRuntimeSnapshot` (snapshot pattern → remove), `AgentBridgeEvent` (keep but add new event types), `AgentModelSummary` (replaced by ACP `configOptions`), `AgentPromptInput`, `AgentReplacePromptInput`, `AgentUiResponse` (update or remove)
- `contracts/threads.ts` — Thread type: add `agent_id`, `agent_session_id`, remove `session_file`
- `contracts/messages.ts` — DELETE this file entirely (agent is source of truth)

## H. Tests that will break

| Test file                                   | Reason                                          |
| ------------------------------------------- | ----------------------------------------------- |
| `src/store/agent-store.behavior.test.ts`    | Replaces snapshot store with event accumulation |
| `src/store/pipper-store.behavior.test.ts`   | Edit mode state management                      |
| `src/store/terminal-store.behavior.test.ts` | Current uses IPC-based approach                 |
| `src/store/thread-store.behavior.test.ts`   | Thread schema changes                           |

## I. Theme IPC

- `theme:getCurrent` / `theme:changed` / `theme:onChanged`
- Not agent-related — kept as-is
- Plan doesn't mention it but no change needed

## J. `dialog:pickDirectory` / `analytics:componentMutationRequested`

- Not agent-related — kept as-is
- No change needed

---

# Implementation order

1. **Foundation** — ACP SDK types, transport layer, AgentConnectionManager replacing AgentManager (Sections 1+10)
2. **Session lifecycle** — session/new, session/load, session/close, session/delete + DB schema migration (Section 3)
3. **Main prompt flow** — convert `agent:sendPrompt` / `agent:onEvent` to ACP prompt turn (Section 4)
4. **Model picker** — read from session `configOptions` (Section 3 appendix)
5. **Content types** — images, audio, embedded context (Section 5)
6. **Tool calls** — tool/advertise, tool/call, rendering (Section 6)
7. **File system** — clientCapabilities.fs (Section 9)
8. **Terminals** — ACP terminal support (Section 11)
9. **Slash commands** — `available_commands_update` (Section 7)
10. **Cancellation** — session/cancel + $/cancel_request (Section 8)
11. **Editor mode** — map `editor:*` to ACP session lifecycle (Gap B)
12. **Updater mode** — map updater agent to ACP one-shot session (Gap C)
13. **Edge operations** — replacePrompt → custom `_pipper/replace_prompt`, compact → drop or custom (Gap A)
14. **Testing** — update all behavior tests (Gap H)
15. **Cleanup** — remove `contracts/agent.ts`, `contracts/messages.ts`, `pipper-store.ts`, old IPC handlers, old types
