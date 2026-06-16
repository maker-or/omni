# Pipper Agent Guide

## What this repo is

Pipper is a self-improving agent harness. The codebase is early-stage, so prefer changes that improve long-term structure, reliability, and maintainability.

## Task completion checklist

Before marking any task complete, run and fix issues from:
- `bun run doctor`
- `bun run lint`
- `bun run build`
- `bun run fmt`

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

## Implementation expectations

- Preserve predictable behavior during reconnects, session restarts, and partial streams.
- Prefer small, composable components.
- Reuse existing patterns before introducing new ones.
