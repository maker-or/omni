# Migration Plan: Bundled Codex Binary → npx-based Codex ACP

## Background (verified)

- `@agentclientprotocol/codex-acp` (the adapter) is a plain Node bin (`codex-acp` → `dist/index.js`). It **pulls `@openai/codex` + `@openai/codex-darwin-arm64` as its own deps** and spawns the binary via Branch B (`createRequire(...).resolve("@openai/codex/bin/codex.js")`) — it does **not** need `CODEX_PATH` or Electron's `ELECTRON_RUN_AS_NODE` when run under plain Node.
- The current `CODEX_PATH` + `ELECTRON_RUN_AS_NODE`/`ELECTRON_NO_ASAR` machinery in `electron/agents/registry.ts` exists **only** because the adapter runs _inside Electron_ with an asar. Via `npx`, it runs under plain Node — **all that special-casing becomes dead code.**
- The `npx` agent pattern already exists in this codebase: `claude-agent-acp`, `opencode-acp`, `grok-acp`, `gemini-acp`, `copilot-acp`, `antigravity-acp`. Codex will become the 7th, using the identical path.

**Size impact:** removes `@openai/codex-darwin-arm64` (~297MB unpacked), `@openai/codex` (16K), and the `codex-acp` asarUnpack entries. `.app` goes ~893MB → ~595MB; DMG ~308MB → est. **~180-200MB** (the binary compresses heavily in the DMG).

---

## Phase 1 — Registry config (behavior)

**1.1 Update `electron/agents/config.json`** — change the `codex-acp` entry from `installKind: "binary"` to the npx shape:

```jsonc
{
  "id": "codex-acp",
  "name": "codex-cli",
  "displayName": "Codex",
  "command": "codex-acp",
  "args": [],
  "installKind": "npx",              // was "binary"
  "detectCommands": ["codex-acp"],   // prefer a globally-installed codex-acp
  "npmPackage": "@agentclientprotocol/codex-acp",
  "installHint": "Fetched via npx on first use.",
  ...
}
```

**1.2 Mirror the same change in `BUILTIN_ACP_AGENTS`** in `electron/agents/registry.ts` (lines 110-123) so the builtin catalog (when `config.json` is absent) matches.

## Phase 2 — Delete the bundled-Codex machinery

**2.1 In `electron/agents/registry.ts`, remove:**

- The `codex-acp` special-case branch in `probeAgentAvailability` (lines 381-396) — Codex now flows through the generic detect→PATH→npx branch like Claude/opencode.
- The `codex-acp` special-case branch in `resolveAgentSpawn` (lines 538-576) — including `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ASAR`, `CODEX_PATH` env.
- Helper functions `bundledCodexAcpPath` (85-91), `bundledCodexNativeBinaryPath` (63-82), `codexTargetTriple` (39-48), and the `CODEX_PLATFORM_PACKAGE` map (50-57).
- `preferAsarUnpackedPath` (28-36) — **only** codex used it; delete it + its 2 tests.

Result: `resolveAgentSpawn` for codex returns `{ command: npx, args: ["-y", "@agentclientprotocol/codex-acp"], env }` — identical to Claude.

## Phase 3 — Remove the binary from the build

**3.1 `package.json`:** remove `"@agentclientprotocol/codex-acp": "1.1.2"` from `dependencies`. This also drops `@openai/codex` and `@openai/codex-darwin-arm64` transitively (they're the adapter's deps, not direct deps).

- Keep `@agentclientprotocol/sdk` — it's the ACP protocol lib used by the app itself.

**3.2 `bun.lock`:** regenerate (`bun install`).

**3.3 `electron-builder.yml`:** remove the two asarUnpack entries:

```yaml
- "**/node_modules/@agentclientprotocol/codex-acp/**/*"
- "**/node_modules/@openai/codex*/**/*"
```

Keep `node-pty`.

**3.4 Sanity:** confirm nothing else references `@openai/codex` / `codex-darwin` (already grepped — only `registry.ts` + `registry.test.ts` + `electron-builder.yml`).

## Phase 4 — Tests

**4.1 `electron/agents/registry.test.ts`:**

- Rewrite the codex test (lines 120-135) — currently asserts `ELECTRON_RUN_AS_NODE=1` and `CODEX_PATH`. Replace with the Claude-style assertion: `available === hasNpx`, spawn command is `npx`, args contain `-y @agentclientprotocol/codex-acp` exactly once (idempotency).
- Delete the 2 `preferAsarUnpackedPath` tests (94-118).
- Update the catalog test (line 28-30): assert `codex.installKind === "npx"` and `detectCommands` contains `codex-acp`.
- Extend the existing npx-idempotency test (54-69) or add a codex variant covering the same re-probe loop.

**4.2 Verify the subagent/UX tests that reference `codex-acp`** (`src/components/subagent-ux.behavior.test.tsx`, `src/lib/subagent-orchestration.test.ts`) still pass — they use `codex-acp` as a _label/ID_, not the binary, so they should be unaffected. Run to confirm.

## Phase 5 — Build & measure

**5.1** `bun install` (regenerates lock, prunes `@openai/*`).
**5.2** `bun run build` then `bun run dist`.
**5.3** Measure:

```bash
du -sh "release/mac-arm64/Pipper Code (Alpha).app"
ls -lh release/*.dmg
```

Expect `.app` ≈ 595MB, DMG ≈ 180-200MB. Confirm `@openai` is gone from `app.asar.unpacked`.

## Phase 6 — Manual smoke test

**6.1** Launch the packaged app, open the agent selector → Codex shows **available** with "Will launch via npx (first run downloads)".
**6.2** Start a Codex session → confirm first-run download (~297MB) then a working ACP conversation.
**6.3** Repeat with a globally-installed `codex-acp` on PATH → confirm it's used directly (no npx re-download).
**6.4** Confirm Claude/opencode/Cursor agents are unaffected.

## Phase 7 — Docs & release notes

**7.1** Update the "Bundled with Pipper Code." install hint anywhere it surfaces in UI copy.
**7.2** Note the product-behavior change in release notes: **Codex is no longer included in the installer — first use downloads it via npx.** Requires Node/npm (npx) present, same as the other npx agents.

---

## Product behavior changes

| Aspect            | Before                   | After                                     |
| ----------------- | ------------------------ | ----------------------------------------- |
| Installer size    | 308MB DMG / 893MB app    | ~180-200MB / ~595MB                       |
| First Codex use   | Instant (pre-bundled)    | First-run npx download (~297MB, one-time) |
| Offline Codex     | Works                    | Needs one-time online fetch               |
| Existing sessions | Spawn via Electron       | Spawn via Node/npx                        |
| Requires Node     | No (Electron bundled it) | Yes (npx) — same as Claude/opencode       |

**Net:** no functional loss — Codex still works, just on-demand like the other agents. The only real trade-off is the one-time first-run download.
