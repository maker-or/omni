# Project: omni Architecture & Codebase Mapping

## Architecture Overview

Electron + Vite + React/TS Application for Omni.
Target output: `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`

## Milestones

| #   | Name                      | Scope                                                                                                                | Dependencies | Status |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| 1   | Main & Native Exploration | Investigate Electron main process, preload scripts, IPC channels, native integration, configuration & build pipeline | none         | DONE   |
| 2   | Renderer & UI Exploration | Investigate Renderer process, React component tree, state management, routing, styling, assets, and hooks            | none         | DONE   |
| 3   | Documentation Drafting    | Synthesize exploration findings into comprehensive `ARCHITECTURE_MAP.md` with Mermaid diagrams                       | M1, M2       | DONE   |
| 4   | Verification & Audit      | Verify completeness, accuracy against codebase, diagram validity, and formatting                                     | M3           | DONE   |

## Interface Contracts & Requirements

- R1. Architecture & Data Flow Mapping: Detailed map of Electron main/preload/renderer architecture, IPC channels, state management, contracts. Must include mermaid diagrams.
- R2. Core Subsystems & Component Catalog: Breakdown of major subsystems, UI component structure, utility modules, routing/layout logic.
- R3. Comprehensive Technical Documentation Output: Output to `ARCHITECTURE_MAP.md` at workspace root.
