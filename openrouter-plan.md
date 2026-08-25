# Plan: First-party models via OpenRouter ("Pipper Agent")

Status: draft

## 1. Goal & approach decision

**Goal:** ship working models out of the box so a fresh user can prompt without installing any external CLI. Users bring their own key (BYOK) from OpenRouter.

**Decision: build a first-party bundled ACP agent (`pipper-openrouter`)** — an ACP server over stdio backed by the OpenRouter Agent SDK, shipped inside the app bundle and registered like any other agent.

Why this fits this repo:

- Everything downstream already exists and is agent-agnostic: spawn/init (`agent-connection-manager.ts`), model selection via `configOptions` category `model` + `initialModelId` (electron/agent-connection-manager.ts:2545), `session/set_config_option` / Grok-style `session/set_model` routing (:2830), permission dock, subagents, usage/cost rendering (`AcpUsageState.cost`, contracts/acp.ts:113), model-catalog caching (`model-catalog-store.ts`), benchmarks.
- Zero special-casing in the connection manager: just another descriptor in `registry.ts`.

Rejected alternatives:

- *Proxy BYOK into other agents' CLIs* (base-URL overrides per vendor): fragile, drifts per CLI version, breaks their auth flows.
- *In-process runtime in main*: breaks process isolation; crashes take down main; loses the uniform spawn/probe/reconnect model.
- *OpenAI-compatible local server + generic adapter*: same cost with more glue.

## 2. Architecture

```
Renderer --IPC-- Main --spawn(stdio)-- pipper-openrouter agent --HTTPS-- OpenRouter
                                       | agent loop (@openrouter/agent callModel)
                                       | tools: read/write/edit/glob/grep/bash (permissioned)
                                       | transcript persistence (session/load resume)
```

| Component | Location | Notes |
|---|---|---|
| Bundled agent | `electron/agents/openrouter-agent/` (TS) -> standalone ESM bundle at `out/agents/pipper-openrouter.mjs` (rolldown; SDK+zod inlined) | Protocol surface modeled on `mock-agent.mjs` |
| Registry entry | `BUILTIN_ACP_AGENTS` + `contracts/acp.ts` | New `installKind: "bundled"`; always `available: true`; icon `openrouter` |
| Spawn resolution | `probeAgentAvailability` / `resolveAgentSpawn` | Spawn Electron itself with `ELECTRON_RUN_AS_NODE=1`, system-node fallback |
| Key vault | `electron/secrets.ts` (new): `safeStorage` -> encrypted blob in SQLite `secrets` table | First secret storage in app; IPC `secrets:*` in main.ts + preload.ts |
| Settings UI | `src/settings/app.tsx` | OpenRouter card: paste key, validate, show credits, remove |
| Model catalog sync | Agent fetches `GET /api/v1/models` -> advertises model `configOptions`; renderer seeds `useModelCatalogStore.remember("pipper-openrouter", ...)` pre-connect | Disk cache, 24h TTL |

## 3. Phases

### P0 - Decisions (block P2)

- **Loop engine:** prefer `@openrouter/agent` `callModel` only if it supports (a) abort mid-loop for `session/cancel`, (b) per-step streaming callbacks, (c) awaiting async permission gates inside `tool.execute`. Otherwise hand-roll the loop on the lean Client SDK (`chat.send` streaming) - ~200 lines, full control, matches reliability-first rule.
- Curated shortlist (10-20 models incl. one free-tier), ordered; everything else searchable.
- Attribution headers always sent: `HTTP-Referer` + `X-OpenRouter-Title: Pipper`.
- Key precedence: vault key > inherited `OPENROUTER_API_KEY` > none -> protocol `auth_required`.

### P1 - Secrets infrastructure (main process)

- `electron/secrets.ts`: gate on `safeStorage.isEncryptionAvailable()`; rows in new `secrets` table (`service TEXT PRIMARY KEY, ciphertext BLOB, updated_at INTEGER`) using `ensureColumn` migration style from `electron/db.ts`.
- IPC `secrets:set/get/delete/has`; preload bridge additions.
- Never log keys; never send plaintext to renderer beyond masked preview; analytics only via `analytics-sanitize`.
- Fallbacks: safeStorage unavailable (Linux headless/no keyring) -> refuse by default, opt-in plaintext with warning; decrypt failure after OS password change -> prompt re-entry.

### P2 - Agent core

- ACP server methods: `initialize` (advertise loadSession capability + config options), `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/set_config_option` (model switch), `authenticate`; emit `auth_required` when no key so existing needs-auth UI works unchanged.
- Model advertisement via standard path: `session/new` returns `configOptions: [{ id:"model", category:"model", currentValue, options }]`. Also support Grok-style `_meta.modelState` at initialize since the manager special-cases it.
- Streaming mapping: SSE deltas -> `agent_message_chunk`; reasoning tokens -> `agent_thought_chunk`; tool calls -> `tool_call`/`tool_call_update` (kind read/edit/delete/execute/fetch/think); usage -> `usage_update` with `{amount, currency:"USD"}`; title generation after first turn.
- Abort plumbing: one `AbortController` per prompt triggered by `session/cancel`; must also kill running bash children.

### P3 - Tools + permissions

- Tools on session cwd: `read_file` (size-capped), `write_file`, `edit_file` (exact string replace), `list_dir`, `glob`, `grep` (pure JS), `bash` (child_process + output ring buffer), optional `todo_write` -> plan entries.
- Permission gating: every `bash`, and all writes/edits in v1 -> ACP `session/request_permission`, awaited inside `tool.execute`; honor `allow_always` scoped per project+tool.
- Path safety: realpath resolve (symlink escape), Windows normalization/case, protect `.git/`, forbid writes outside cwd.
- Env hygiene: strip `OPENROUTER_API_KEY` from bash child env by default.

### P4 - Context & cost management

- Per-model context window from catalog; running token estimate; trim oldest turns near limit (keep system + recent window); compaction affordance reusing `isCompacting` state.
- `finish_reason=length` -> friendly copy + suggest compact/new thread.
- Images only on vision-capable models; otherwise dropped with inline warning.
- Cost: usage badge mapping; settings guardrails - soft monthly warning, hard per-turn ceiling (abort loop).

### P5 - Model catalog UX

- Fetch `/api/v1/models`, cache to disk 24h; seed `model-catalog-store` under `pipper-openrouter` right after key validation so the draft `@model` picker works pre-session.
- Curated shortlist + search over hundreds of slugs; group by provider; show pricing + context length; favorites + recents persisted.
- Keep IPC-borne configOptions list bounded (top N + favorites); full search runs against the cached catalog.

### P6 - Session persistence & resume

- Append-only JSONL transcript per thread in userData (mirrors `session_file` semantics); implement `session/load` replaying updates.
- Tolerate a truncated final line (crash mid-write) on load.
- Version field in header line for future transcript migrations.

### P7 - Subagent + MCP interplay

- Verify `pipper-openrouter` lands in the subagent pool automatically (`allowedAgents: "all"` excludes only mocks) and that `maxConcurrent`/`maxDepth` gate it.
- Orchestrator spawning Pipper Agent with no key -> clean `auth_required` in run status, never a crash loop.
- MCP servers from `mcp_servers` table: pass natively (Agent SDK has first-class MCP tool support) instead of the stdio-proxy path; stdio MCP servers spawned by the agent get the same env scrubbing as bash tools.
- Headless subagent sessions inherit permission auto-approval - confirm desired default for a cloud-model agent.

### P8 - Packaging, build, telemetry

- `scripts/build.js`: bundle agent deps into one ESM file; assert no dynamic imports that break asar; size budget check.
- Fix latent packaged-spawn gap while here: bundled kind spawns `process.execPath` + `ELECTRON_RUN_AS_NODE: 1`; system-node fallback for dev.
- PostHog events: connect outcome by error class, model_selected (sanitized via existing `sanitizeIdentifier`), turn duration/cost buckets - never prompts, never keys.
- README architecture section + "Bring your own key" docs page.

## 4. Edge-case matrix

### Spawn / runtime
- Packaged app has no guaranteed system `node` -> spawn `process.execPath` with `ELECTRON_RUN_AS_NODE: 1`. Verify mac + win packaged builds (mock agent has this latent gap today).
- Agent crash mid-turn: child exit while SSE in-flight surfaces as `stop` with error on that thread only; sibling threads sharing the connection reconnect via existing spawn dedupe.
- stdout is protocol-only - SDK/diagnostic logging goes to stderr + rotating file, or JSON-RPC framing breaks.
- Zombie cleanup on quit/crash: reuse terminal-manager kill patterns; SIGTERM handler flushes transcript before exit.
- Windows: no .cmd shim needed (we spawn Electron binary directly), but verify PATHEXT-independent resolution and long paths.

### Auth & key lifecycle
- Invalid/revoked key mid-session (worked, then 401): surface needs-auth state, keep thread and transcript intact; prompt resumes after key fix without session loss.
- Insufficient credits (402) mid-stream: end turn gracefully with balance link; partial output preserved.
- Key rotation while sessions live: vault change restarts pipper-openrouter connections (existing reconnect machinery), sessions resume from transcript.
- Env-var vs vault precedence conflict: show key source in settings to avoid confusion.
- Account banned/moderation-blocked: map to clear error class, not generic failure.

### Network
- Offline at spawn vs offline mid-turn: distinguishable states; queued prompt fails fast with retry affordance.
- DNS failure, TLS interception (corporate MITM proxies): actionable error copy; document proxy expectations.
- HTTP_PROXY/HTTPS_PROXY support: undici needs explicit dispatcher - explicit work item, not free.
- Timeouts: connect vs first-token vs inter-chunk stall watchdog (no chunk N s -> abort, single transparent retry if nothing billed yet).
- Retry policy: GETs freely; completions POST retried only when zero tokens received (avoid double billing).

### Streaming protocol
- SSE disconnect mid-tool-call (partial args JSON): fail that tool call cleanly, emit tool_call_update cancelled, end turn with error entry, transcript stays consistent.
- Malformed/unknown chunk types: ignore forward-compatibly; log to stderr file.
- Unicode multibyte split across chunk boundaries: buffer-decode safely.
- Empty completion (no text, no tool call): synthesize visible fallback message.
- finish_reason variants: stop / length / content_filter each get distinct user-facing copy.
- Duplicate/out-of-order deltas and heartbeat frames: idempotent handling.
- Parallel tool calls in one step: preserve order, unique ids, no interleaved arg corruption.

### Model catalog & selection
- Catalog endpoint down at startup: disk cache; never-fetched case falls back to curated static list baked into bundle.
- Persisted thread pinned to deprecated/removed slug: session/load succeeds, falls back to default model + inline notice.
- Alias models (`~openai/gpt-latest`) have unknown context window: conservative estimate until first usage reading.
- Hundreds of models: bounded configOptions payload; search against local cache; virtualized dropdown.
- Provider routing prefs (ZDR/data policy) and :nitro/:floor variants behind advanced settings toggle.
- Non-vision model + image prompt: strip images with warning (never hard-fail).
- Models without function-calling support: hide from default list or degrade to text-only mode with banner.

### Tools & permissions
- Cancel arrives while permission request pending: respond cancelled (AcpPermissionResponse.cancelled exists), tool never executes.
- allow_always persistence per project+tool, revocable later; scoped so "always" never leaks across projects.
- bash cross-platform quoting (cmd vs POSIX shells), timeout kill, zombie reaping, Ctrl+C propagation, streaming output cap.
- read_file: binary sniffing, huge-file truncation marker, encoding detection.
- edit_file: ambiguous multi-match requires uniqueness or replace_all flag; stale-content conflict detection.
- glob/grep: ignore node_modules/.git by default; result caps.
- Symlink escape, `../` traversal, absolute paths outside cwd, UNC paths, reserved device names on Windows.
- Two parallel tool calls writing one file: serialize per-path writes.

### Concurrency
- One agent process multiplexes N sessions across threads (manager dedupes spawns by agentId): session state keyed per sessionId; a slow stream must not starve others.
- Multiple concurrent streams share one API key -> account-wide OpenRouter rate limits: shared 429 backoff / circuit breaker, queue rather than parallel-fail.
- Subagent runs spawning pipper-openrouter at depth+1: maxConcurrent queue applies; verify depth gating.
- App quit mid-stream: transcript flush + child kill ordering.

### Cost & billing guardrails
- usage cost null for some providers -> badge hides gracefully.
- Hard per-turn ceiling exceeded mid-loop: abort with clear message; monthly soft warning banner.
- Trust OpenRouter's reported usage/cost fields; never estimate silently.

### Privacy & compliance
- First cloud-model selection shows one-time disclosure that code/prompts leave the machine.
- ZDR routing option in advanced settings.
- Analytics carry only sanitized metadata (model_id), never prompts/keys/file contents.
- Attribution headers always present.

## 5. Testing strategy

- Behavior tests colocated per AGENT.md. Local mock OpenRouter HTTP server drives the real bundled agent over stdio - extend `handshake-probe.test.ts` / `mock-agent-replay.test.ts` patterns.
- Streaming edge-case fixtures (truncated SSE, partial tool args, 401/402/429 bodies) replayed like `benchmarks/fixtures`.
- Contract tests on the built bundle: initialize / session/new / set_config_option / cancel / session/load.
- Secrets tests with safeStorage mocked (available, unavailable, decrypt-failure).
- `bench:thread` live-turn-stream job pointed at pipper-openrouter to keep streaming perf honest.
- Manual packaged-build checklist (mac arm64 + win x64): spawn path, keychain prompt, proxy env.

## 6. Rollout

- Ship behind registry feature flag until contract tests + packaged QA pass.
- Onboarding: Pipper Agent appears as the zero-setup option in the agent picker immediately; needs-auth card links to settings key entry.
- Default-agent switch decision deferred (config.json `defaultAgentId` stays codex-acp initially).
- Docs: README architecture note + BYOK page before public release.

## 7. Open questions

1. Does `@openrouter/agent` callModel support abort + per-step streaming + async permission gates? If not, confirm hand-rolled loop on the Client SDK.
2. bash tool in v1, or read/write-only first slice?
3. OAuth/PKCE key onboarding vs paste-key v1?
4. Per-project model defaults, or global default only?
5. Should the key also be offered to external agents via env injection (e.g. ANTHROPIC-compatible proxies), or strictly scoped to Pipper Agent?
