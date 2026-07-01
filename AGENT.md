# Pipper Agent Guide

## What this repo is

Pipper is a self-improving agent harness. The codebase is early-stage, so prefer changes that improve long-term structure, reliability, and maintainability.

## Task completion checklist

Before marking any task complete, run and fix issues from:

- `bun run doctor`
- `bun run lint`
- `bun run build`
- `bun run fmt`
- `bun run test`

## Core priorities

1. Performance first
2. Design first
3. Reliability first
4. Predictable behavior under load and during failures

When there is a tradeoff, choose correctness and robustness over short-term convenience.

## Maintainability rules

- Prefer shared logic over duplicated logic.
- If new behavior can be extracted into a reusable module, do that.
- Don’t solve a problem with ad hoc local code if a shared abstraction makes sense.
- Large refactors are acceptable when they improve the codebase long term.

## UI / design rules

- Always follow `DESIGN.md`.
- Always use the built-in UI components in the repo.
- Use `@/` imports first; they resolve to `src/` first, then shared `/@/` components.
- Use `<Elevated offset={N}>` as the outer wrapper for floating surfaces like cards, popovers, dropdowns, dialogs, tooltips, and sheets.
- Do not hardcode surface background classes for floating UI.
- Compound items must receive consecutive `index` props for correct hover/proximity behavior.
- Keep TSX files under 1000 lines when possible.
- Use only icons from `@phosphor-icons/react`.
- for any custom components that you are creating never hardcode the values and use elevated as mentioned because we have both dark and light modes

## Implementation expectations

- Preserve predictable behavior during reconnects, session restarts, and partial streams.
- Prefer small, composable components.
- Reuse existing patterns before introducing new ones.
- During co-editing, only change files in the repository root scope; do not mirror edits into subdirectories such as `app-template` and ignore this exception if `app-template` is not present.
- When reviewing or changing complex flows, proactively audit the invariants before relying on symptoms or happy paths: list the trusted state, every reader, every writer, every transition, and every crash/restart or async boundary. Check whether stale state, partial failure, retries, or out-of-band changes can break the invariant, and ensure errors only claim what the code proves.

## core architecture

the base application the agentic core is build on top of pi-sdk[https://pi.dev/docs/latest/sdk] , so before making any chages to agentic core , first understand how the pi-sdk actaully work , and how its implemented in your application

Do not rewrite working code unless there is a measurable architectural benefit.

## Things to know

- If a user want to adding a new view , first check whether the view can i be added to the other-views , if yes , then you need to decide by yourself. whether that view is going to be like thread-specific , project-specific, or global-specific
- the example of the thread-specific view can be like a diff view
- the example of the project-specific view can be like a plan view
- the global view can be like a existing terminal view or something like a browser view
- When you have added any new UI element then make sure you add `data-pipper-id` this is becuase based on this id , users can easily edit the UI element visually, You don't need to add this for every `<div>` block that you have created.
  -When writing tests, focus on behavior and the end result, not test coverage or UI details. Since we're building self-improving software, the UI and implementation may change, but the functionality must remain correct. Test what the system achieves, not how it gets there.
- Always spend time understanding the existing implementation before making changes.
