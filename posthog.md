# PostHog Analytics Implementation Plan for Omni / Pipper

This document is the implementation contract for product analytics in the desktop app. It is written for a coding agent that will execute the work later.

The goal is to make analytics:

- useful for product decisions
- safe by default
- cheap to maintain
- aligned with the current Electron + React architecture

This is not a generic analytics brainstorm. It is a concrete plan for this codebase.

---

## 1. Objective

We want a minimal but durable product analytics layer for the desktop app.

The analytics system should answer these product questions:

- How many authenticated users open the app and return?
- How often do users create projects and threads?
- How often do users enter the edit workflow and complete a mutation?
- What share of mutations are accepted vs rejected?
- Which models and mutation categories correlate with successful outcomes?
- Where do users drop off in the edit-mode / companion workflow?

This plan is intentionally limited to structured product analytics in PostHog.

It does **not** cover raw full-thread transcript export. That should remain a separate pipeline from PostHog.

---

## 2. Non-Goals

The implementation described here must **not** do the following:

- send raw chat prompts or raw assistant responses to PostHog
- send file contents, diffs, or code snippets to PostHog
- send absolute filesystem paths
- send Clerk email, name, avatar, or other user profile fields as event properties
- send terminal output or tool output as analytics payloads
- use PostHog as storage for full conversation logs
- track every UI click just because it is available

If a future requirement needs transcript-level storage or offline analysis, that should be implemented as a separate sanitized export pipeline in Electron.

---

## 3. Product Context From This Codebase

This repository is a desktop Electron app with:

- a launch/auth flow
- a project selection flow
- a thread-based agent workspace
- an edit workflow centered on `pipper`
- a companion window for self-editing / targeted mutations
- embedded terminal sessions

Relevant architecture:

- Electron orchestration: `electron/main.ts`
- Agent runtime manager: `electron/agent.ts`
- Persistence: `electron/db.ts`, `electron/projects.ts`, `electron/threads.ts`
- Overlay / edit workflow: `src/components/pipper-overlay.tsx`
- Companion workflow: `src/components/companion-view.tsx`
- Main agent workspace: `src/components/agent-panel.tsx`
- Thread/project state: `src/store/*.ts`
- Shared IPC bridge: `electron/preload.ts`

Analytics should follow those boundaries instead of scattering tracking code arbitrarily in the renderer.

---

## 4. Recommended Architecture

### 4.1 Split analytics into two systems

Use:

- **PostHog** for structured product analytics only
- **a separate future export system** for sanitized full transcripts, if needed

Do not mix those systems.

### 4.2 Where analytics should live

The primary analytics orchestration should live on the Electron side.

Reason:

- Electron has access to project/thread lifecycle, launch state, and agent completion state
- Electron is the right place to inject shared metadata consistently
- privacy enforcement is easier when the final event builder is not spread across renderer components

Renderer-side tracking should be minimal and only used when the interaction is purely UI-local and not already represented in Electron.

### 4.3 Proposed module layout

The coding agent should introduce a small analytics subsystem with responsibilities separated cleanly.

Suggested files:

- `electron/analytics.ts`
- `electron/analytics-schema.ts`
- `electron/analytics-context.ts`
- `electron/analytics-sanitize.ts`

Optional renderer helper if needed:

- `src/lib/analytics.ts`

The exact filenames can vary, but the responsibilities should remain distinct.

---

## 5. Identity Model

This is the first decision and should be implemented before any event instrumentation.

### 5.1 Tracking policy

For v1, track only authenticated product usage.

Do **not** send product analytics before auth completes.

Reason:

- this app already has a Clerk-based auth flow
- the codebase already persists auth users locally
- delaying tracking until auth avoids identity merge complexity in the first implementation
- it reduces ambiguity around anonymous pre-auth launch behavior

### 5.2 Stable identity

Use the Clerk `provider_user_id` as the PostHog person identity.

Implementation expectations:

- after auth completes, identify the PostHog user with the Clerk provider user id
- do not send email, name, or avatar as event properties unless there is an explicit product need later
- if person properties are set, keep them minimal

### 5.3 Session identity

Generate an app session id for each desktop app launch.

Requirements:

- generate once per launch
- keep in memory for the current process lifetime
- attach to every event after analytics is active

Suggested field:

- `session_id`

### 5.4 Distinct ID rules

For v1:

- use authenticated identity only
- no anonymous queueing
- no alias/merge logic

This keeps the implementation smaller and avoids mistakes.

---

## 6. Privacy Rules

These rules are mandatory.

### 6.1 Never send raw content

Never send:

- raw prompt text
- raw assistant text
- tool call payloads
- tool results
- terminal output
- code diffs
- file contents

### 6.2 Never send machine-identifying paths

Never send:

- absolute project path
- home directory path
- active/backup/shared workspace paths
- generated local callback URLs if they expose local state

If project context is needed, use `project_id` only.

### 6.3 Use derived categories instead of text

For user mutation intent, derive a coarse category locally and send the category only.

Allowed examples:

- `ui_customization`
- `workflow_change`
- `new_feature`
- `integration`
- `automation`
- `performance_improvement`
- `bug_fix`
- `unknown`

### 6.4 Sanitize error data

If errors are tracked:

- do not send raw stack traces to PostHog as event properties
- do not send exception messages if they may contain file paths, user content, or secrets

Instead, prefer:

- `error_type`
- `error_code`
- `error_stage`

### 6.5 Minimize arrays and high-cardinality fields

Avoid properties that create uncontrolled cardinality.

Do not send:

- `files_changed` arrays
- arbitrary component labels if they are not stable
- arbitrary generated titles

Prefer:

- counts
- normalized enums
- booleans

---

## 7. Base Event Schema

All PostHog events should use a shared base schema with a small set of stable properties.

### 7.1 Required base properties

These should be attached to every event that is sent:

```json
{
  "app_version": "string",
  "session_id": "string",
  "window_type": "launch|main|companion|background",
  "platform": "darwin|win32|linux"
}
```

### 7.2 Optional contextual properties

Attach only when valid:

```json
{
  "project_id": "string",
  "thread_id": "string",
  "model_id": "string",
  "model_provider": "string",
  "intent_category": "enum",
  "component_id": "string",
  "source": "enum"
}
```

### 7.3 Fields that should not exist in the base schema

Do **not** make these universal:

- `timestamp`
- `user_id`
- `thread_id`
- `project_id`

Reason:

- PostHog already timestamps events
- user identity belongs in PostHog identification, not duplicated on every event property payload
- project and thread context are not globally valid for all events

---

## 8. Event Catalog for V1

This is the minimum event set that should be implemented first.

No additional events should be added in the first pass unless they answer one of the product questions in Section 1.

---

### 8.1 `app_opened`

Purpose:

- measure authenticated app usage
- support DAU/WAU/retention analysis

Trigger:

- first meaningful post-auth app activation after analytics is ready

Required properties:

- `app_version`
- `session_id`
- `window_type`
- `platform`

Optional properties:

- none

Notes:

- do not fire repeatedly for every window open
- fire once per app launch session after user identity is known

---

### 8.2 `project_created`

Purpose:

- measure how often users onboard a workspace into the app

Trigger:

- successful project creation

Required properties:

- base properties
- `project_id`

Optional properties:

- `icon`

Notes:

- do not send the project path

Likely code touchpoint:

- `projects:create` path in `electron/main.ts`
- `electron/projects.ts`

---

### 8.3 `thread_created`

Purpose:

- measure thread creation frequency and conversation branching

Trigger:

- successful thread creation from any supported path

Required properties:

- base properties
- `project_id`
- `thread_id`

Optional properties:

- `source`

Suggested `source` values:

- `agent_panel`
- `agent_runtime`
- `companion`
- `unknown`

Likely code touchpoint:

- `threads:create`
- `agent:createThread`
- `electron/agent.ts`

---

### 8.4 `component_mutation_requested`

Purpose:

- measure the start of targeted editing intent before execution begins
- support funnel analysis from overlay selection to actual mutation execution

Trigger:

- user opens the inline comment popup or otherwise explicitly targets a component for mutation

Required properties:

- base properties
- `project_id`

Optional properties:

- `thread_id`
- `component_id`
- `source`

Suggested `source` values:

- `overlay`
- `companion`

Notes:

- this event is optional for v1 if the team wants a smaller rollout
- if implemented, it should represent an intentional action, not hover noise

Likely code touchpoint:

- `src/components/pipper-overlay.tsx`

---

### 8.5 `mutation_started`

Purpose:

- mark the beginning of an actual editing / generation attempt

Trigger:

- user submits a mutation request that is handed to the agent

Required properties:

- base properties
- `project_id`
- `source`

Optional properties:

- `thread_id`
- `component_id`
- `intent_category`
- `model_id`
- `model_provider`

Suggested `source` values:

- `overlay_comment`
- `companion_prompt`
- `chat_prompt`

Notes:

- this is more important than `component_mutation_requested`
- if there is ambiguity, prefer firing `mutation_started` rather than weaker earlier funnel events

Likely code touchpoints:

- `src/components/pipper-overlay.tsx`
- `src/components/companion-view.tsx`
- `electron/agent.ts`

---

### 8.6 `mutation_completed`

Purpose:

- measure execution outcomes and performance

Trigger:

- an editing run finishes, regardless of success or failure

Required properties:

- base properties
- `project_id`
- `outcome`
- `execution_duration_ms`

Optional properties:

- `thread_id`
- `component_id`
- `intent_category`
- `model_id`
- `model_provider`
- `files_changed_count`
- `error_type`
- `error_code`

Allowed `outcome` values:

- `success`
- `error`
- `cancelled`

Notes:

- prefer a single completion event over separate success/failure events
- duration should be measured locally using stable start/end markers

Likely code touchpoint:

- `electron/agent.ts`

---

### 8.7 `mutation_accepted`

Purpose:

- track successful user acceptance of generated changes

Trigger:

- user accepts the mutation and commits the result of the edit flow

Required properties:

- base properties
- `project_id`

Optional properties:

- `thread_id`
- `component_id`
- `intent_category`
- `model_id`
- `model_provider`
- `files_changed_count`

Notes:

- do not add a separate `custom_feature_created` event in v1
- any future “feature created” classification should be derived later, not tracked directly now

Likely code touchpoint:

- `pipper:acceptChanges` path in `electron/main.ts`

---

### 8.8 `mutation_rejected`

Purpose:

- track explicit user rejection of generated changes

Trigger:

- user rejects/discards generated changes

Required properties:

- base properties
- `project_id`

Optional properties:

- `thread_id`
- `component_id`
- `intent_category`
- `model_id`
- `model_provider`
- `rejection_stage`

Suggested `rejection_stage` values:

- `before_completion`
- `after_completion`
- `after_review`

Likely code touchpoint:

- `pipper:rejectChanges` path in `electron/main.ts`

---

### 8.9 `rollback_executed`

Purpose:

- measure how often backup restoration or revert logic is actually invoked

Trigger:

- the app performs a revert/restore operation

Required properties:

- base properties
- `project_id`
- `success`

Optional properties:

- `thread_id`
- `last_intent_category`
- `last_model_id`
- `last_model_provider`
- `last_execution_duration_ms`
- `files_changed_count`
- `error_type`
- `error_code`

Notes:

- do not send filenames in v1
- count is enough for first-pass analytics

Likely code touchpoints:

- `pipper:rejectChanges`
- workspace restore path in Electron

---

### 8.10 `agent_run_completed`

Purpose:

- track agent run performance outside of mutation acceptance specifically
- compare model usage and output volume over time

Trigger:

- any agent run completes successfully or terminally

Required properties:

- base properties
- `project_id`
- `execution_duration_ms`
- `outcome`

Optional properties:

- `thread_id`
- `model_id`
- `model_provider`
- `tokens_used`
- `source`
- `error_type`
- `error_code`

Allowed `outcome` values:

- `success`
- `error`
- `cancelled`

Notes:

- avoid duplicating this event if `mutation_completed` already captures the same exact run and no broader analysis is needed
- if both exist, ensure semantics are distinct:
  - `mutation_completed` is edit-workflow specific
  - `agent_run_completed` is general runtime telemetry

Likely code touchpoint:

- `electron/agent.ts`

---

## 9. Events Explicitly Deferred From V1

These should not be implemented in the initial rollout.

### 9.1 `workspace_snapshot`

Reason:

- state snapshots are easy to misuse
- most counts can be derived from event history
- they introduce repeated bulk events with limited signal

### 9.2 `custom_feature_created`

Reason:

- too subjective
- overlaps with `mutation_accepted`
- better derived later via classification

### 9.3 `component_selected`

Reason:

- likely high-volume noise
- unclear product value in the first rollout
- can distort funnel interpretation if users click/hover repeatedly

---

## 10. Required Enumerations

The coding agent should centralize enums to avoid drift across files.

### 10.1 `window_type`

Allowed values:

- `launch`
- `main`
- `companion`
- `background`

### 10.2 `source`

Allowed values:

- `launch`
- `agent_panel`
- `agent_runtime`
- `overlay`
- `overlay_comment`
- `companion`
- `companion_prompt`
- `chat_prompt`
- `unknown`

### 10.3 `intent_category`

Allowed values:

- `ui_customization`
- `workflow_change`
- `new_feature`
- `integration`
- `automation`
- `performance_improvement`
- `bug_fix`
- `unknown`

### 10.4 `outcome`

Allowed values:

- `success`
- `error`
- `cancelled`

### 10.5 `rejection_stage`

Allowed values:

- `before_completion`
- `after_completion`
- `after_review`

---

## 11. Event-to-Code Mapping

This section tells the coding agent where to instrument.

### 11.1 Launch and auth

Primary files:

- `electron/main.ts`
- `electron/db.ts`
- `electron/launch-state.ts`
- `src/launch/app.tsx`

Expected responsibilities:

- initialize analytics after auth is known
- identify the user once per app session
- fire `app_opened` once after analytics activation

### 11.2 Project lifecycle

Primary files:

- `electron/main.ts`
- `electron/projects.ts`
- `src/launch/add-project-form.tsx`

Expected responsibilities:

- fire `project_created` after successful persistence

### 11.3 Thread lifecycle

Primary files:

- `electron/main.ts`
- `electron/threads.ts`
- `electron/agent.ts`
- `src/components/agent-panel.tsx`

Expected responsibilities:

- fire `thread_created` after successful thread creation
- attach `project_id` and `thread_id`

### 11.4 Edit-mode workflow

Primary files:

- `src/components/pipper-overlay.tsx`
- `src/components/companion-view.tsx`
- `electron/main.ts`
- `electron/agent.ts`

Expected responsibilities:

- optional: fire `component_mutation_requested`
- fire `mutation_started` when a real edit request is submitted
- fire `mutation_completed` when the run finishes
- fire `mutation_accepted` and `mutation_rejected` from the explicit workflow actions

### 11.5 Restore / rollback workflow

Primary files:

- `electron/main.ts`
- `electron/workspace-manager.ts`

Expected responsibilities:

- fire `rollback_executed` with `success` and compact diagnostics

### 11.6 Agent runtime completion

Primary files:

- `electron/agent.ts`

Expected responsibilities:

- measure duration
- read selected model information
- extract token usage if available from runtime stats
- fire `agent_run_completed`

---

## 12. Event Construction Rules

The coding agent should implement a single event builder path instead of ad hoc calls.

### 12.1 Analytics service requirements

The shared analytics service should:

- refuse to send events before auth activation
- attach base properties automatically
- accept event-specific properties
- validate enums
- strip undefined values
- sanitize diagnostic properties
- no-op safely when PostHog is unavailable

### 12.2 Validation behavior

If an event payload is malformed:

- log locally in development
- do not crash the app
- do not send partially invalid payloads blindly

### 12.3 Environment control

The implementation should support:

- analytics disabled in development if desired
- analytics disabled by env flag
- analytics disabled gracefully when config is missing

Suggested flags:

- `POSTHOG_KEY`
- `POSTHOG_HOST`
- `ANALYTICS_ENABLED`

The exact naming can vary, but the gating behavior should exist.

---

## 13. Intent Classification Strategy

This app wants to understand the type of mutation without sending raw prompt text.

### 13.1 V1 expectation

V1 should use a simple local classifier that produces one of the allowed intent enums.

This can be:

- keyword-based
- heuristic-based
- placeholder returning `unknown` when confidence is low

### 13.2 Constraint

The classifier output may be sent.
The raw input text may not be sent to PostHog.

### 13.3 Acceptable fallback

If no safe classifier is ready, send:

- `intent_category: "unknown"`

That is better than sending raw text or inventing unstable categories.

---

## 14. Implementation Phases

The coding agent should execute in phases rather than landing everything at once.

### Phase 1: foundation

Deliver:

- analytics config and service
- authenticated identity activation
- session id generation
- shared base property injection
- local validation and safe no-op behavior

No business events yet except a testable `app_opened` if helpful.

### Phase 2: lifecycle events

Deliver:

- `app_opened`
- `project_created`
- `thread_created`

Validate:

- events appear once
- identities are stable
- properties are shaped correctly

### Phase 3: mutation funnel

Deliver:

- `mutation_started`
- `mutation_completed`
- `mutation_accepted`
- `mutation_rejected`
- `rollback_executed`

Optional in this phase:

- `component_mutation_requested`

### Phase 4: runtime performance

Deliver:

- `agent_run_completed`
- model metadata
- token usage if available
- error categorization

### Phase 5: dashboard and QA pass

Deliver:

- final event dictionary verification
- basic PostHog insight templates
- instrumentation review for duplicates and privacy leaks

---

## 15. Verification Checklist

The coding agent should consider the task incomplete until these checks are done.

### 15.1 Identity checks

- authenticated events are attributed to the expected PostHog person
- no pre-auth events are sent in v1
- one session id is reused across the app lifecycle

### 15.2 Privacy checks

- no raw prompt text in any event
- no file paths in any event
- no email/name/avatar in event payloads
- no tool output in any event

### 15.3 Event integrity checks

- `app_opened` fires once per launch
- `project_created` fires only on success
- `thread_created` fires only on success
- mutation events have coherent start/completion/accept/reject semantics
- rollback event is not duplicated accidentally

### 15.4 Runtime checks

- analytics failures do not crash the app
- missing PostHog config degrades gracefully
- development logging is sufficient to inspect payloads locally

---

## 16. Suggested Dashboards / Queries

These are the first product questions the event set should support.

### 16.1 Adoption

- daily authenticated app opens
- weekly active users
- returning users over time

### 16.2 Workspace creation

- projects created per week
- threads created per active user

### 16.3 Mutation funnel

- mutation started -> completed
- mutation completed -> accepted
- mutation completed -> rejected
- rollback rate after completed mutation

### 16.4 Quality and performance

- acceptance rate by `intent_category`
- acceptance rate by `model_id`
- median `execution_duration_ms` by model
- error rate by model and source

If an implemented event does not support one of these queries or another clearly stated product question, that event should be reconsidered.

---

## 17. Explicit Instructions to the Coding Agent

When implementing this plan:

1. Do not invent additional events unless required by the product questions above.
2. Do not send raw text content to PostHog.
3. Keep analytics orchestration centralized.
4. Prefer Electron-side tracking when the event reflects app state or runtime state.
5. Treat renderer-side tracking as a thin input signal only.
6. Introduce enums/constants to prevent string drift.
7. Make analytics safe to disable.
8. Add local debug logging for payload inspection during development.
9. Keep the first rollout narrow and verifiable.

---

## 18. Final Recommendation

The correct implementation path is:

- build a small authenticated analytics foundation
- instrument only the highest-signal lifecycle and mutation events
- enforce privacy at the event-construction boundary
- keep transcript export out of PostHog

This plan is intentionally conservative. That is a feature, not a limitation. A smaller, strict schema will produce better analytics than a larger, noisy one.
