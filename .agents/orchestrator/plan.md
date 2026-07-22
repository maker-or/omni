# Orchestrator Execution Plan

## Mission

Generate a comprehensive architecture and codebase map for `omni` and output to `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`.

## Milestones & Strategy

1. **Phase 1: Exploration**
   - Milestone 1: Dispatch Explorer 1 to investigate main process, preload scripts, IPC bridges, backend services, config, and build system. Output report to `.agents/explorer_1/analysis.md`.
   - Milestone 2: Dispatch Explorer 2 to investigate renderer process, React components, state management (Zustand/Redux/Context), routes, hooks, utilities. Output report to `.agents/explorer_2/analysis.md`.
2. **Phase 2: Synthesis & Drafting**
   - Milestone 3: Dispatch Worker to synthesize findings from Explorer 1 & 2 into `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` covering all requirements R1, R2, R3, including Mermaid data flow and architecture diagrams.
3. **Phase 3: Verification & Review**
   - Milestone 4: Dispatch Reviewer and Forensic Auditor to verify `ARCHITECTURE_MAP.md` for accuracy, completeness, diagram validity, and integrity.

## Subagent Dispatch Plan

- Explorer 1 (`teamwork_preview_explorer`): Main process, Preload, IPC, Config, Backend
- Explorer 2 (`teamwork_preview_explorer`): Renderer process, UI Component Catalog, State, Router, Utilities
- Worker 1 (`teamwork_preview_worker`): Generate `ARCHITECTURE_MAP.md`
- Reviewer 1 (`teamwork_preview_reviewer`): Verify architecture documentation against codebase
