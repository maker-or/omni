# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.

## Project Snapshot

pipper is a self improving agent harness
This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Design first.
3. Reliability first.
4. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

- Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

- Always use the the built in UI components that we have in the repo. Imports starting with `@/` resolve to `src/` first and fallback to the root `/@/` directory to reuse shared components without duplication.

- Use <Elevated offset={N}> as the outermost wrapper of any floating container (card, popover, dropdown, dialog, tooltip, sheet) — never hardcode bg-surface-N on these, because the offset adapts to nesting context automatically (a popover inside a dialog self-elevates correctly).

- Compound items (e.g., `InputField` in `InputGroup`, `SelectItem` in `Select`) must receive consecutive `index` props so that mouse proximity-hover cursor tracking and morphing background animations calculate correctly.

- Make sure that we don't have more that 1000 lines of code in a single tsx file.

- Use only Icons from @phosphor-icons/react.
