# Spotlight support for Pipper App Intents

## Goal

Make Pipper projects/agents searchable in macOS Spotlight (and resolvable by Siri / Apple Intelligence). Results are display-only in v1 (no tap-to-open — see Non-goals). Thread creation stays on the existing `siri-requests/` + `pipper://siri/<id>` handoff.

## Background

- Today `native/pipper-intents/Sources/PipperIntents.swift` uses `String` IDs + `DynamicOptionsProvider` for `StartThreadIntent`, deliberately avoiding `AppEntity` (pre-`perform` decode failed with `LNPerformActionErrorCodeUnsupportedValueType`).
- Electron writes `siri-catalog.json` (`electron/siri/siri-catalog.ts`) to `~/Library/pipper/`, App Support, and App Group container; the extension reads it via `SiriCatalogStore`.
- Apple path (per docs): `AppEntity` → `IndexedEntity` → donate via `CSSearchableIndex.indexAppEntities` → `IndexedEntityQuery` for reindexing. (`OpenIntent` for tap-to-open is deliberately out of scope — see Non-goals.)

## Work items

### 1. `ProjectEntity` / `AgentEntity` as `IndexedEntity`

- File: `native/pipper-intents/Sources/PipperIntents.swift` (new section; keep String-ID providers as fallback until proven).
- `struct ProjectEntity: IndexedEntity, Codable, Sendable`:
  - `id: String` (catalog project id), `@Property(title: "Name") name: String`
  - `@ComputedProperty(indexingKey: \.contentDescription) path`
  - optional custom key for project id: `CSCustomAttributeKey(keyName: "com.maker-or.omni.pipper.project.id")`
  - `displayRepresentation`: title=name, subtitle=path
  - `attributeSet` only if extra data needed later.
- `struct AgentEntity: IndexedEntity`: `id`, `@Property displayName`, displayRepresentation.
- Queries: `ProjectQuery: IndexedEntityQuery`, `AgentQuery: IndexedEntityQuery` reading `SiriCatalogStore.load()`:
  - `entities(for:)` — filter catalog by ids
  - `suggestedEntities()` — all projects / available agents
  - `reindexEntities(for:indexDescription:)` + `reindexAllEntities(indexDescription:)` — re-donate via named `CSSearchableIndex`.
- Risk: re-trigger of the `AppEntity` decode crash. Mitigate: keep `StartThreadIntent` on Strings in parallel; add one bisect intent with entity param first.

### 2. Migrate `StartThreadIntent` params to entities

- Change `@Parameter projectId/agentId: String` → `@Parameter project: ProjectEntity`, `agent: AgentEntity` (keep `prompt: String?`).
- `perform()`: validate `available`, stage `{requestId, projectId: project.id, agentId: agent.id, prompt}` to every `candidateDirs()/siri-requests` (existing logic), return `opensIntent: OpenURLIntent(pipper://siri/<id>)` on macOS 15.2+.
- Keep old String-ID intent (renamed, `isDiscoverable=false`) until entity path ships reliably on ad-hoc-signed builds.

### 3. Donation to Spotlight index

- Named index, e.g. `CSSearchableIndex(name: "com.maker-or.omni.pipper.projects")` (never default index).
- Donate after catalog load: `try await index.indexAppEntities(projectEntities)` (+ agents index or same index). Entity `id` dedupes/updates.
- Where: inside `suggestedEntities()`/reindex methods + explicit donate call from a new `DonateCatalogIntent` (for Shortcuts/testing) or from Electron-triggered refresh. Extension sandbox can only read `~/Library/pipper/` etc. — no SQLite access.
- Deletion: `deleteAppEntities(withIdentifiers:)` for projects removed from catalog (compute diff or wipe+reindex on catalog version change).

### 4. Electron changes

- `electron/siri/`: no catalog format change required. Log donation visibility for debugging (`intents-debug.log` already exists).
- Consider triggering donation refresh after `refreshSiriCatalog()` (can't call Spotlight from Electron directly — needs Swift helper binary or rely on extension-side donation on next query/reindex).

### 5. Build / signing / entitlements

- `Extension/PipperIntents.entitlements`: Spotlight/CoreSpotlight needs no extra entitlement for `indexAppEntities` from extension; verify ad-hoc-signed builds can write the named index.
- `scripts/build.js` + `electron-builder.yml`: no change expected (extension already embedded); confirm `Metadata.appintents` regenerates with new entities.
- Preview app: add sample projects/agents for metadata inspection (existing Demo Project pattern).

### 6. Tests

- Extend `Tests/PipperIntentsTests/`: entity encode/decode round-trip, `entities(for:)` filtering, staging payload uses `entity.id`, reindex methods donate without throw (mock index or `#if` gate).
- Manual: donate → Spotlight search project name → result appears with correct title/subtitle. Verify Siri phrase still resolves entity ("start a thread in FolkLore with Codex"). Verify reindex after catalog refresh.

## Order

1. Entities + queries + bisect intent (no behavior change).
2. Donation + reindex.
3. Migrate `StartThreadIntent` to entities, keep String fallback.
4. Tests + manual Spotlight/Siri verification + remove fallback.

## Non-goals (v1)

- **No `OpenIntent` / tap-to-open.** `OpenIntent` defaults to `openAppWhenRun = true`, which relies on the App Intents host-app launch handshake that fails on ad-hoc-signed builds (same reason `StartThreadIntent.openAppWhenRun` is false). Spotlight results are therefore display-only: tapping a project does not navigate into Pipper. Revisit if/when builds are Developer ID-signed.
- No `ShowInAppSearchResultsIntent`.

## Open questions

- Root cause of prior `AppEntity` pre-`perform` decode failure — retest with minimal entity before full migration.
- Whether ad-hoc-signed (no Team ID) extensions can donate to named Spotlight index; fallback is signed-build-only Spotlight.
- Donation trigger cadence (on query vs. explicit refresh) given extension has no background runtime.
