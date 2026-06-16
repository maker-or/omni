# Conversation Export Implementation Plan for Omni / Pipper

This document is the implementation contract for the conversation export pipeline.

It is written for a coding agent that will execute the work later.

The purpose of this pipeline is to export completed self-improvement / edit-workflow conversations for later analysis, while keeping the system privacy-first and operationally safe.

This pipeline is **not** the same as PostHog product analytics.

Use:

- `posthog.md` for structured product analytics
- this document for sanitized conversation export

---

## 1. Objective

We want to capture complete edit-workflow conversations so they can be analyzed later for product and model insights.

The export pipeline should help answer questions like:

- What kinds of edit requests are users making most often?
- Which edit requests are accepted vs rejected?
- Which assistant behaviors or tool sequences correlate with acceptance?
- Where does the agent struggle in companion/edit mode?
- Which tool calls and tool results commonly appear in successful self-improvement loops?

The pipeline must preserve enough detail for later analysis, including:

- user messages
- assistant messages
- tool calls
- tool results
- completion outcome

At the same time, it must avoid shipping raw identity and machine context.

---

## 2. Non-Goals

This system must **not** do the following:

- export every thread in the app
- export generic agent conversations unrelated to edit workflows
- send raw unsanitized transcripts to remote storage by default
- attach Clerk user identity to exported conversations
- use PostHog as the storage system for these transcripts
- block the UI while uploading
- require remote sanitization before a record can be stored safely

If remote second-pass sanitization is added later, it is an additional safety layer, not the primary privacy boundary.

---

## 3. Scope

### 3.1 Included in v1

V1 should export only conversations that belong to:

- `companion` mode
- `edit` mode / `pipper` overlay initiated workflows

Only completed workflows should be exported.

### 3.2 Excluded in v1

Do not export in v1:

- general agent panel conversations unrelated to edit workflows
- launch/auth/project selection interactions
- terminal sessions as standalone transcripts
- passive browsing or non-edit exploratory interactions

---

## 4. Export Unit Definition

The most important design choice is the unit of export.

Do **not** treat a full thread as the unit of export.

Instead, define one export record as:

- one completed edit workflow attempt

That workflow starts when the user submits an editing request and ends only when the user:

- accepts the changes, or
- rejects the changes

This is the only point when a conversation is considered complete and eligible to send.

### 4.1 Completion rule

A workflow is exportable only when:

- it belongs to `companion` or `edit` mode
- the app has enough context to assemble the full conversation for that workflow
- the user has explicitly accepted or rejected the changes

### 4.2 Not exportable yet

Do not export:

- partial runs
- in-progress conversations
- abandoned sessions without a terminal action

Abandonment handling may be added later, but it is out of scope for v1.

---

## 5. Why This Boundary Is Correct

This boundary is recommended because it:

- maps to a concrete user workflow
- avoids exporting irrelevant full-thread history
- keeps analysis focused on the self-improvement loop
- makes acceptance/rejection comparisons straightforward
- limits privacy exposure by shrinking the exported window

This is better than exporting the entire thread every time.

---

## 6. Product Context From This Codebase

This repository already has the right signals to identify these workflows.

Relevant files:

- `electron/agent.ts`
- `electron/main.ts`
- `electron/threads.ts`
- `src/components/companion-view.tsx`
- `src/components/pipper-overlay.tsx`
- `contracts/agent.ts`
- `contracts/threads.ts`

The companion and edit workflow are already distinct in the codebase:

- companion mode is driven through `CompanionView`
- edit mode is driven through `PipperOverlay`
- accept/reject actions already exist in Electron IPC paths

This means the export lifecycle can be implemented reliably without guessing.

---

## 7. Recommended Architecture

This pipeline should be implemented primarily on the Electron side.

Reason:

- Electron has the best access to runtime lifecycle and persistence
- Electron is the best privacy enforcement boundary before network transmission
- Electron can manage queueing and retries without leaking complexity into the renderer

### 7.1 Suggested modules

The coding agent should introduce a dedicated export subsystem.

Suggested files:

- `electron/conversation-export.ts`
- `electron/conversation-sanitizer.ts`
- `electron/conversation-queue.ts`
- `electron/conversation-storage.ts`
- `electron/conversation-types.ts`

Optional:

- `electron/conversation-redaction-rules.ts`

These exact filenames can vary, but the responsibilities should remain separated.

### 7.2 Module responsibilities

#### `conversation-types.ts`

Own:

- schema definitions
- enums
- record state types
- queue status types

#### `conversation-export.ts`

Own:

- workflow tracking
- assembling conversation payloads
- determining when a workflow is complete
- invoking sanitization
- passing records to the queue

#### `conversation-sanitizer.ts`

Own:

- local privacy sanitization
- redaction summaries
- string and structured payload normalization

#### `conversation-queue.ts`

Own:

- queue persistence
- retry behavior
- background sending
- failure status transitions

#### `conversation-storage.ts`

Own:

- remote write adapter
- storage destination integration
- metadata write behavior

---

## 8. Data Flow

The intended flow is:

1. user enters edit workflow
2. workflow is marked as export-eligible
3. runtime messages and tool activity for that workflow are collected
4. user accepts or rejects
5. workflow is marked complete
6. full export record is assembled
7. local sanitization runs
8. sanitized record is queued
9. background sender uploads it
10. remote storage confirms receipt
11. queue marks record as sent

The upload must be asynchronous and must not block the user’s workflow.

---

## 9. Eligibility Rules

### 9.1 Eligible workflows

A conversation is eligible for export if:

- it is associated with `companion` mode, or
- it is associated with an edit-mode initiated mutation workflow

### 9.2 Required inclusion

For eligible workflows, the export should include:

- user messages
- assistant messages
- tool calls
- tool results
- workflow metadata
- completion outcome

### 9.3 Out-of-scope records

Do not export:

- unrelated chat messages from the same thread outside the workflow window
- terminal-only sessions
- project metadata beyond hashed identifiers

---

## 10. Message Inclusion Rules

The exported conversation should include the workflow-local slice of the interaction.

### 10.1 Include

Include all messages belonging to the workflow:

- initial mutation request message
- assistant replies during that workflow
- tool calls made during that workflow
- tool results produced during that workflow
- system or UI-request messages if they materially shaped the workflow

### 10.2 Exclude

Exclude:

- earlier unrelated thread history
- later unrelated thread history
- generic application state noise

### 10.3 Tool data

Tool calls are important and should be preserved.

Include:

- tool name
- sanitized tool arguments
- tool success/failure
- sanitized tool result
- timestamps if available

Do not store raw tool outputs blindly.

---

## 11. Completion Semantics

V1 should export only at terminal workflow completion.

### 11.1 Terminal states

Allowed terminal states for export:

- `accepted`
- `rejected`

### 11.2 Explicitly not in v1

Do not export on:

- start of workflow
- intermediate progress
- every message
- idle timeout
- mutation completion before user decision

If later you need abandoned workflow analysis, add it in a future phase with explicit rules.

---

## 12. Identity and Privacy Model

This pipeline should not attach user identity.

### 12.1 Do not send

Do not send:

- Clerk user id
- email
- full name
- avatar URL
- raw project path
- raw thread id
- machine-specific identifiers

### 12.2 Allowed identifiers

The pipeline may send:

- `conversation_id`
- `session_id`
- hashed `thread_id`
- hashed `project_id`

These are needed for grouping and analysis.

### 12.3 Hashing requirements

Hashed identifiers must not be plain unsalted hashes.

Use:

- a salt
- a stable hashing strategy

If the system needs long-term correlation across exports, use a stable salt.

If the system later needs stronger privacy, consider rotating the salt periodically.

---

## 13. Privacy Requirements

Local sanitization is mandatory before any remote storage.

### 13.1 Core rule

No raw unsanitized transcript should be stored remotely by default.

### 13.2 Required local redactions

The local sanitizer must attempt to redact at least:

- email addresses
- phone numbers
- absolute filesystem paths
- usernames / home-directory references
- bearer tokens
- JWT-like tokens
- API keys / secret-looking values
- auth callback params
- URLs with secrets or tokens
- environment-variable-like secret values
- large base64 payloads
- stack traces containing local paths

### 13.3 Context-aware redactions

If available, the sanitizer should also redact or replace:

- known Clerk user name
- known Clerk email
- project folder name if considered sensitive
- machine-local path prefixes

### 13.4 Structural stripping

The sanitizer should also normalize or remove:

- embedded image/base64 blobs
- oversized tool results
- oversized terminal dumps if present inside tool results

### 13.5 Redaction output

The sanitizer should produce:

- sanitized content
- a redaction summary

Example:

- number of emails redacted
- number of paths redacted
- number of secrets redacted

---

## 14. Recommended Sanitization Strategy

There are stronger ML/NER-based privacy tools in the ecosystem, but they are not the best v1 fit for this Electron app.

### 14.1 V1 recommendation

Use a lightweight local Node-based sanitizer first.

That sanitizer should be:

- deterministic
- fast
- dependency-light
- rule-based
- easy to inspect

### 14.2 Why not heavy on-device ML now

Do not ship a heavy Python PII stack inside the Electron app in v1.

Reason:

- larger app footprint
- more packaging complexity
- slower iteration
- harder cross-platform maintenance

### 14.3 Recommended privacy model

Use:

- primary local sanitization
- optional server-side second-pass sanitization later

That gives defense in depth without requiring raw upload.

### 14.4 Server-side second pass

If implemented later, the server-side pass should operate only on already-sanitized content.

It should be treated as:

- miss detection
- audit reinforcement

It should not be the primary privacy boundary.

---

## 15. Export Schema

This section defines the recommended shape of the exported record.

### 15.1 Top-level record

Suggested schema:

```json
{
  "export_id": "uuid",
  "conversation_id": "uuid",
  "session_id": "uuid",
  "mode": "companion|edit",
  "source": "overlay_comment|companion_prompt",
  "completion_reason": "accepted|rejected",
  "started_at": 0,
  "ended_at": 0,
  "duration_ms": 0,
  "thread_id_hash": "string",
  "project_id_hash": "string",
  "intent_category": "ui_customization|workflow_change|new_feature|integration|automation|performance_improvement|bug_fix|unknown",
  "model_id": "string",
  "model_provider": "string",
  "message_count": 0,
  "files_changed_count": 0,
  "tool_names_used": ["string"],
  "redaction_summary": {
    "emails": 0,
    "phones": 0,
    "paths": 0,
    "secrets": 0,
    "names": 0,
    "urls": 0,
    "base64_blobs": 0
  },
  "messages": []
}
```

### 15.2 Message schema

Suggested shape:

```json
{
  "role": "user|assistant|system|tool",
  "kind": "text|tool_call|tool_result|ui_request|ui_response",
  "timestamp": 0,
  "tool_name": "string|null",
  "tool_success": true,
  "content_sanitized": "string",
  "contains_code": true,
  "contains_tool_call": false,
  "contains_file_reference": true,
  "contains_secret_pattern": false
}
```

### 15.3 Allowed omissions

If some fields are unavailable, the system may omit them or set them to `null`.

But the coding agent should keep the schema stable once chosen.

---

## 16. Required Enums

The coding agent should centralize these to prevent drift.

### 16.1 `mode`

Allowed values:

- `companion`
- `edit`

### 16.2 `source`

Allowed values:

- `overlay_comment`
- `companion_prompt`

### 16.3 `completion_reason`

Allowed values:

- `accepted`
- `rejected`

### 16.4 `kind`

Allowed values:

- `text`
- `tool_call`
- `tool_result`
- `ui_request`
- `ui_response`

### 16.5 `intent_category`

Allowed values:

- `ui_customization`
- `workflow_change`
- `new_feature`
- `integration`
- `automation`
- `performance_improvement`
- `bug_fix`
- `unknown`

---

## 17. Storage Recommendation

This export pipeline should not use PostHog for storage.

### 17.1 Recommended long-term storage design

Use two layers:

- object/blob storage for full sanitized conversation payloads
- Postgres for metadata and indexing

### 17.2 Why this is recommended

Object storage is better for bulky JSON transcript payloads.

Postgres is better for:

- indexing
- filtering
- joins
- retention bookkeeping
- analysis job scheduling

### 17.3 Suggested storage pattern

#### Blob/object storage

Store:

- one sanitized conversation JSON per export

Possible backends:

- S3
- Cloudflare R2
- GCS

#### Postgres metadata row

Store:

- `export_id`
- `conversation_id`
- `session_id`
- `mode`
- `source`
- `completion_reason`
- `started_at`
- `ended_at`
- `duration_ms`
- `thread_id_hash`
- `project_id_hash`
- `intent_category`
- `model_id`
- `model_provider`
- `message_count`
- `files_changed_count`
- `storage_key`
- `redaction_summary`
- `created_at`

### 17.4 Acceptable v1 simplification

If the team wants a lower-ops starting point, it is acceptable to start with:

- Postgres metadata columns
- `payload jsonb`

This is acceptable only if current volume is modest.

The schema should be designed so the payload can move to blob storage later.

### 17.5 Recommended decision

For this product stage:

- if speed of implementation matters most, start with Postgres `jsonb`
- if transcript size is expected to be large, go directly to blob storage + Postgres metadata

---

## 18. Queueing and Reliability

The system should queue exports locally and send them in the background.

### 18.1 Required behavior

The export pipeline must:

- not block the accept/reject interaction
- persist queued exports locally
- retry failed uploads
- tolerate app restarts

### 18.2 Queue states

Suggested queue states:

- `pending`
- `sending`
- `sent`
- `failed`
- `dead_letter`

### 18.3 Retry behavior

Use:

- exponential backoff
- capped retry attempts
- durable local queue persistence

### 18.4 Local queue location

Store queue state under app user data, similar to how launch and companion state are already stored.

### 18.5 Failure handling

If upload repeatedly fails:

- keep the sanitized payload locally
- mark it as `failed`
- optionally escalate to `dead_letter` after max attempts

Do not lose completed sanitized exports silently.

---

## 19. Workflow Tracking Strategy

The system needs a reliable way to decide which messages belong to one exportable workflow.

### 19.1 Recommended strategy

Track workflow state at runtime.

This is preferred over reconstructing everything from thread history later.

Runtime tracking should:

- open a workflow record when a valid edit workflow starts
- collect messages as they occur
- attach tool calls and results
- close the workflow on accept/reject

### 19.2 Why runtime tracking is preferred

It provides:

- cleaner boundaries
- lower ambiguity
- easier inclusion of tool calls/results
- simpler outcome association

### 19.3 Persistence fallback

If runtime capture is incomplete or difficult, thread persistence may be used as a fallback to reconstruct message slices.

But runtime capture should remain the primary strategy.

---

## 20. Event-to-Code Mapping

This section tells the coding agent where to integrate.

### 20.1 Companion-mode start

Primary file:

- `src/components/companion-view.tsx`

Expected role:

- identify companion-originated workflows
- provide a clear start boundary when a prompt is sent in companion mode

### 20.2 Edit-mode start

Primary file:

- `src/components/pipper-overlay.tsx`

Expected role:

- identify overlay-originated workflows
- provide source and targeted component context

### 20.3 Runtime message collection

Primary file:

- `electron/agent.ts`

Expected role:

- observe assistant/user/tool message flow
- collect messages belonging to the active workflow
- measure duration
- associate model metadata

### 20.4 Completion boundary

Primary file:

- `electron/main.ts`

Expected role:

- hook into accept/reject actions
- mark workflow terminal state
- trigger assembly + sanitization + enqueue

### 20.5 Thread metadata access

Primary file:

- `electron/threads.ts`

Expected role:

- optional fallback access to persisted messages
- thread identifier access if needed

---

## 21. Implementation Phases

The coding agent should implement this in phases.

### Phase 1: schema and local assembly

Deliver:

- export types
- workflow record model
- top-level export schema
- message schema
- enum definitions

No networking yet.

### Phase 2: local workflow tracking

Deliver:

- companion/edit workflow detection
- runtime capture of user/assistant/tool messages
- completion on accept/reject

At this point, records can be assembled locally.

### Phase 3: local sanitization

Deliver:

- deterministic local sanitizer
- redaction summary
- payload inspection logging in development

No remote storage yet.

### Phase 4: local durable queue

Deliver:

- file-backed queue
- queue statuses
- retry strategy

Still acceptable to test with a mock sender.

### Phase 5: remote storage integration

Deliver:

- storage adapter
- metadata write
- payload upload
- success/failure handling

### Phase 6: hardening

Deliver:

- failure audit
- dead-letter handling
- queue replay on app restart
- privacy validation pass

---

## 22. Verification Checklist

The coding agent should consider the task incomplete until these checks pass.

### 22.1 Scope checks

- only `companion` and `edit` workflows are exported
- generic agent panel threads are not exported

### 22.2 Completion checks

- export occurs only after `accepted` or `rejected`
- in-progress workflows are not exported
- records are not duplicated for the same completion event

### 22.3 Content checks

- user messages are included
- assistant messages are included
- tool calls are included
- tool results are included in sanitized form

### 22.4 Privacy checks

- no Clerk user id in exported payload
- no email/name/avatar in payload
- no raw absolute paths
- no raw secrets
- no raw unsanitized transcript leaves the device by default

### 22.5 Reliability checks

- upload failure does not block UI
- queued records survive app restart
- sent records are marked correctly
- failed records are retained for retry

---

## 23. Explicit Instructions to the Coding Agent

When implementing this plan:

1. Keep conversation export independent from PostHog analytics.
2. Treat local sanitization as mandatory before remote storage.
3. Export only on explicit accept/reject completion.
4. Include tool calls and tool results, but sanitize them aggressively.
5. Prefer runtime workflow tracking over broad thread-history export.
6. Use a durable queue and asynchronous sending.
7. Keep the v1 scope narrow and testable.
8. Do not add user identity to the exported payload.
9. Make payload inspection possible in development before enabling real uploads.

---

## 24. Final Recommendation

The correct v1 design is:

- one export record per completed edit workflow
- only for companion/edit modes
- assembled in Electron
- sanitized locally
- queued durably
- uploaded asynchronously
- stored outside PostHog

This is the smallest implementation that still preserves the data you actually care about: the completed self-improvement loop, including messages, tool calls, tool results, and final human judgment.
