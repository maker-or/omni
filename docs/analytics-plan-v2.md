# Analytics Plan v2 — Omni / Pipper

This is the implementation contract for product analytics v2. It supersedes the
event scope in `posthog.md` (v1) while keeping v1's architecture and safety
model intact. It is written for a coding agent to execute later.

v1 was designed before the ACP integration and instruments the old edit/mutation
flow. v2 lights up the parts of the product that actually matter now:

1. **Usage & duration** — how long the app is really used (wall-clock, active, work time).
2. **Agents** — which ACP agent is most used, and how much time/tokens/tools each consumes.
3. **The self-improving loop** — the visual/edit mode and the launcher self-update, framed as a health funnel.

The guiding question v2 must answer: **when the software is used — and when it
tries to change itself — what happens, with which agent, and for how long?**

---

## 0. Keep from v1 (unchanged)

- Analytics live in the **main process only** (`electron/analytics.ts`). Renderer
  never talks to PostHog directly; it goes through IPC.
- `posthog-node` client, `distinctId` = Clerk provider user id.
- **Sanitization is the safety boundary.** Every property is whitelisted in
  `sanitizeAnalyticsProperties` (`electron/analytics-sanitize.ts`). A property not
  on the whitelist is dropped. New fields in v2 **must** be added there or they
  will silently not send.
- **Non-goals (still binding):** never send raw prompts, assistant text, file
  contents, diffs, absolute paths, terminal/tool output, or Clerk PII as event
  properties. No full-transcript storage in PostHog. No blanket UI-click tracking.

---

## 1. Foundational plumbing (do this first — everything depends on it)

### 1.1 Base properties: add agent identity

Today base properties are `app_version`, `session_id`, `window_type`, `platform`
(`analytics.ts:49`). Add the active agent so **every** ACP-scoped event is
sliceable by agent with zero extra query work:

- `agent_id` — descriptor id, e.g. `"claude-agent-acp"`, `"cursor-acp"`.
- `agent_name` — stable descriptor `name`, e.g. `"claude-code"`, `"cursor"`
  (NOT `displayName` — keep it a clean enum).
- `model_id` — current model when known.

The connection manager already knows `runtime.agentId`; thread it through the
`captureAnalytics` calls. For main-process events with a clear active thread,
resolve the agent from the active session.

### 1.2 Schema + sanitizer

Extend `AnalyticsEventName` and `AnalyticsProperties`
(`electron/analytics-schema.ts`) and whitelist every new field in
`sanitizeAnalyticsProperties` (`electron/analytics-sanitize.ts`).

New enum/string props: `agent_id`, `agent_name`, `model_id`, `stop_reason`,
`tool_kind`, `active_agent_id`, `from_agent_id`, `to_agent_id`, `install_kind`,
`failure_code`, `phase`, `step`, `status`, `task_category`.

New numeric props (clamp `>= 0`, round, same pattern as
`execution_duration_ms`): `turn_duration_ms`, `tokens_used`, `context_size`,
`cost_amount`, `session_duration_ms`, `tool_call_count`, `tool_duration_ms`,
`connect_duration_ms`, `build_duration_ms`, `download_duration_ms`,
`promotion_duration_ms`, `health_check_duration_ms`, `total_duration_ms`,
`time_to_accept_ms`, `time_in_edit_ms`, `iterations`, `depth`, `heartbeat_seconds`.

New boolean props: `healthy`, `has_images`, `has_resources`, `has_customizations`.

`cost_currency` is a short enum string (`"USD"`), whitelist as identifier.

### 1.3 Pre-auth device id (fixes a blind spot)

`captureAnalytics` early-returns when `!distinctId`
(`analytics.ts:96`), so everything before sign-in is invisible. Generate a stable
`device_id` persisted to disk, use it as `distinctId` before auth, and call
`posthog.alias({ distinctId: providerUserId, alias: device_id })` on identify.
Enables the **open → sign-in** funnel.

---

## 2. Usage & duration

Three signals because "how long is it used" has three meanings.

| Event | Where | Properties | Answers |
|---|---|---|---|
| `app_closed` | `before-quit` / `shutdownAnalytics` (`main.ts:1908`) | `session_duration_ms` | wall-clock open time |
| `app_heartbeat` | interval, gated on window focus | `heartbeat_seconds`, `active_agent_id` | active/attention time, per agent |
| `turn_completed` | see §3 | `turn_duration_ms` | work time |

**Heartbeat mechanics:** emit every 60s **only while a BrowserWindow is focused**
(hook `browserWindow.on("focus"/"blur")`). Count × interval = active minutes.
Tag with `active_agent_id` so attention time is attributable per agent. No
session replay, no autocapture — just a focus-gated ping.

`app_opened` already fires on identify; leave it.

---

## 3. Agents — usage, time, tokens, tools

"Agent" here = the external ACP backend the user picks: Cursor, Codex, Claude,
opencode, Grok, Gemini (`electron/agents/registry.ts:29`). Every thread is bound
to one `agentId`.

### 3.1 Turn lifecycle — instrument `sendPrompt` (`agent-connection-manager.ts:1102`)

Bracket `Date.now()` at line 1127 (prompt in flight) and diff at 1137 (result).

- `prompt_submitted` — `{ has_images, has_resources }` (+ base agent props).
- `turn_completed` — `{ stop_reason, turn_duration_ms, tool_call_count }`. Emit at
  the success path (1137–1145).
- `turn_failed` — `{ error_type }`. Emit in the catch (1146–1150).
- `tokens_reported` — `{ tokens_used, context_size, cost_amount, cost_currency }`,
  **sampled once at turn stop** from `runtime.slice.usage`
  (`acp-session-reducer.ts:244`). Do NOT emit per stream chunk.

### 3.2 Tool-call timing (time per event)

Tool calls transition `pending → in_progress → completed`
(`acp-session-reducer.ts:178`). Bracket start/end in the connection manager, emit:

- `tool_call_finished` — `{ tool_kind, tool_duration_ms, success }`.

Answers "which agent spends most time on which tool kind." **Volume note:** this
is the highest-cardinality event (dozens/turn). Start with per-call; if ingest is
noisy, fall back to per-turn aggregates `{ tool_time_by_kind, tool_count_by_kind }`.

### 3.3 Subagents (nearly free — records already timed)

Each subagent `RunState` has `agentId`, `task`, `status`, `startedAt`,
`finishedAt`, `depth` (`electron/subagents/subagent-manager.ts:71`). On finish
(where `finishedAt` is set):

- `subagent_run_completed` — `{ agent_id, parent_agent_id, duration_ms:
  finishedAt - startedAt, status, depth, task_category }`. Use the existing
  `categorizeIntent` helper (`analytics-sanitize.ts:15`) on `task` — never send
  the raw task string.

### 3.4 Agent lifecycle & selection

- `agent_connected` — in `ensureConnection` success (`agent-connection-manager.ts:374`):
  `{ connect_duration_ms, install_kind }`.
- `agent_connection_failed` — `{ error_type }`.
- `agent_switched` — `{ from_agent_id, to_agent_id }` (defection signal).
- Person property `last_agent_used` on identify/switch.

**Unlocks:** most-used agent = breakdown of any event by `agent_name`; time per
agent = sum `turn_duration_ms` + heartbeat minutes by agent; time per tool per
agent = sum `tool_duration_ms` by `agent_name` × `tool_kind`; stickiness =
`agent_switched` Sankey + retention by `last_agent_used`.

---

## 4. The self-improving loop

The differentiator: the app changes itself, with a health/rollback safety net.
Both surfaces already emit timed, staged records — v2 just forwards sanitized
events at the transition points.

Unifying metric: **self-improvement loop health** — when the software tries to
change itself, does it succeed and stay healthy?

### 4.1 Visual/edit mode funnel

Loop: `enterEditMode` → git baseline → target component → companion mutates own
source → dev server restart + reload (`reloadMainWindow`, `main.ts:1756`) →
accept (commit, advance `customized_head_commit`, stamp `last_healthy_at`, backup)
or reject (restore from backup). See `main.ts:1519`–1709.

- `edit_mode_entered` — `pipper:enterEditMode` (`main.ts:1542`). **Bracket a
  timestamp here** for the whole session. Adoption metric.
- `edit_component_targeted` — enrich existing `component_mutation_requested`
  (`main.ts:1524`) with `agent_id`. `{ component_id, intent_category }`.
- `edit_build_reloaded` — at `reloadMainWindow` (`main.ts:1756`):
  `{ build_duration_ms, success }`. **Critical:** does the app rebuild itself or
  break? High failure here = the loop is broken.
- `edit_accepted` — enrich `mutation_accepted` (`main.ts:1651`):
  `{ files_changed_count, intent_category, iterations, time_to_accept_ms }`.
  `iterations` = companion turns since enter; `time_to_accept_ms` = enter→accept.
- `edit_rejected` — enrich `mutation_rejected` (`main.ts:1682`):
  `{ iterations, time_in_edit_ms, rejection_stage }`.
- `edit_rollback_health` — reject/restore path (`main.ts:1690`–1708): `{ success }`.
  Did the safety net work?

### 4.2 Launcher self-update & health

Health-gated promotion state machine in `electron/update-manager.ts`:
`downloading → verifying → promoting → awaiting-health-check →
finalized/completed`, with `rollbackPromotion()` on failure and typed failure
codes (`PROMOTION_HEALTH`, `PROMOTION_SWAP`, `PROMOTION_FINALIZE`). Emit one event
per transition, keyed by `run_id`, so the funnel and per-phase timing reconstruct
in PostHog.

- `update_available` / `update_download_completed` — `{ target_version, download_duration_ms }`.
- `update_promoted` — `{ promotion_duration_ms }`.
- `update_health_result` — health gate (`update-manager.ts:435`/`497`):
  `{ healthy, health_check_duration_ms }`. **Fleet-level loop-health metric.**
- `update_completed` — finalize (`update-manager.ts:478`): `{ target_version, total_duration_ms }`.
- `update_rolled_back` — every `rollbackPromotion()` call: `{ failure_code, phase }`.
  `failure_code` is the existing typed enum — already safe.
- `onboarding_step` — setup funnel `onboarding:startSetup` (`main.ts:1560`):
  `{ step, status, error_type }` for git/mise/node/bun. First-run drop-off.

### 4.3 Health as person properties

On identify, stamp `installed_version`, `has_customizations` (boolean derived
from `customized_head_commit`, NOT the raw SHA), and `last_healthy_at`. Cohort:
do customized users retain better? does version X see more rollbacks?

---

## 5. Full event catalog (v2 additions)

Duration: `app_closed`, `app_heartbeat`.
Agents: `prompt_submitted`, `turn_completed`, `turn_failed`, `tokens_reported`,
`tool_call_finished`, `subagent_run_completed`, `agent_connected`,
`agent_connection_failed`, `agent_switched`.
Self-improve (edit): `edit_mode_entered`, `edit_component_targeted` (enrich),
`edit_build_reloaded`, `edit_accepted` (enrich), `edit_rejected` (enrich),
`edit_rollback_health`.
Self-improve (launcher): `update_available`, `update_download_completed`,
`update_promoted`, `update_health_result`, `update_completed`,
`update_rolled_back`, `onboarding_step`.

Kept from v1: `app_opened`, `project_created`, `thread_created`,
`component_mutation_requested`, `mutation_started/completed/accepted/rejected`,
`rollback_executed`, `agent_run_completed`.

---

## 6. Dashboards this enables

- **Usage:** DAU/WAU, wall-clock vs active minutes, work minutes, per user.
- **Most used agent:** breakdown of `turn_completed` by `agent_name`.
- **Time & cost per agent:** sum `turn_duration_ms`, heartbeat minutes, and
  `tokens_used`/`cost_amount` by `agent_name`.
- **Time per event per agent:** sum `tool_duration_ms` by `agent_name` × `tool_kind`.
- **Agent stickiness:** `agent_switched` Sankey; retention by `last_agent_used`.
- **Self-improvement loop health:** `edit_build_reloaded.success` +
  `update_health_result.healthy` — the headline "does self-modification work"
  number, sliced by agent and version.
- **Self-edit funnel:** entered → targeted → reloaded → accepted, with drop-off.
- **Iteration cost:** median `iterations` and `time_to_accept_ms` per accepted edit.
- **Rollback economics:** reject rate + `update_rolled_back` by `failure_code`.
- **Customization retention:** retention split by `has_customizations`.

---

## 7. Suggested implementation order

1. **§1 plumbing** — base agent props, schema + sanitizer, device id. Nothing
   else works cleanly without this.
2. **§2 duration** — highest-value, self-contained (`app_closed`, heartbeat).
3. **§3.1–3.2 turn + tool timing** — core agent usage/time answers.
4. **§4.1 edit funnel** + **§4.2 update funnel** — the self-improving insights.
5. **§3.3–3.4 subagents & lifecycle**, **§4.3 person props** — enrichment.

Each step is independently shippable and independently verifiable in PostHog.
