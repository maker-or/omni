# Assistant Traces Redesign & Optimization Plan

## 1. Overview & Problem Statement

### Current State
During active agent response streaming, `AssistantTraceDeck` mounts and updates a complete, growing hierarchy of React components:
- `ThinkingSteps` (Radix Accordion wrapper)
- `ThinkingStepsContent` containing $N$ `ThinkingStep` items
- Multiple `framer-motion` spring animations (`height: 0 -> auto`, opacity transitions, blur filters)
- Sub-components such as `ThinkingStepDetails`, `ThinkingStepSources`, `ThinkingStepImage`, `AgentTerminalOutput`, and `MarkdownRenderer`
- Heavy regex operations (`extractSources`, base64 screenshot matching) and string manipulation computed inline on every streaming render

This causes severe DOM churn, layout thrashing, and frame drops during high-frequency token/event streams.

### Target State: Two-State Architecture

```
                   ┌───────────────────────────────┐
                   │  Assistant Message Received   │
                   └──────────────┬────────────────┘
                                  │
                    isStreaming?  │
                   ┌──────────────┴──────────────┐
                   │                             │
               [ YES ]                        [ NO ]
                   │                             │
                   ▼                             ▼
       ┌───────────────────────┐     ┌───────────────────────┐
       │   ACTIVE STATE        │     │   PASSIVE STATE       │
       │  (Compact Row View)   │     │  (Lazy Accordion)     │
       ├───────────────────────┤     ├───────────────────────┤
       │ • Animated Indicator  │     │ • Default CLOSED      │
       │ • Latest tool/command │     │ • Header: "Thought    │
       │   action label        │     │   process (N steps)"  │
       │ • ZERO historical DOM │     │ • NO children mounted │
       │   list or sub-nodes   │     │   until user clicks   │
       └───────────────────────┘     └───────────┬───────────┘
                                                 │
                                           User Clicks?
                                                 │
                                                 ▼
                                     ┌───────────────────────┐
                                     │  EXPANDED TRACE VIEW  │
                                     ├───────────────────────┤
                                     │ • Full step timeline  │
                                     │ • Terminal logs       │
                                     │ • Diffs, images, etc. │
                                     └───────────────────────┘
```

1. **Active State (`isStreaming === true`)**:
   - Renders a **single, compact row**.
   - Displays the animated thinking indicator + current tool action label / command summary.
   - **Zero historical step DOM nodes** are rendered while streaming, eliminating stream churn.
2. **Passive State (`isStreaming === false`)**:
   - Defaults to **closed** (accordion collapsed).
   - Shows a clean summary trigger (e.g., *"Thought process"* or *"Thought process · N steps"*).
   - **Lazy rendering**: The heavy list of step details, terminal logs, diff cards, and markdown blocks are **only mounted when the user clicks to expand**.
   - When opened, it reveals the full rich historical view as currently supported.

---

## 2. Component & File Changes

### A. `src/components/agent-panel.tsx`
1. **Remove Auto-Open Streaming Effect**:
   - Remove or adapt the `streamingTraceKey` effect (lines 1015–1030) that automatically forced `traceDeckOpenByKey` to `true` during streaming.
2. **Default State**:
   - Ensure `traceDeckOpenByKey` defaults strictly to `false` (closed) for settled messages.
3. **MessageBody Integration**:
   - Pass `isStreaming`, `traceDeckOpen`, and `onTraceDeckOpenChange` cleanly to `AssistantTraceDeck`.

### B. `@/components/ui/assistant-trace-deck.tsx`
1. **Active vs. Passive Separation**:
   - When `isStreaming === true`:
     - Render `ActiveTraceRow`.
     - Extract only the latest active trace part (`traceParts[traceParts.length - 1]`).
     - Render `ThinkingIndicator` with live action copy (`getToolActionCopy`).
     - Omit `ThinkingStepsContent` and historical step mapping entirely.
   - When `isStreaming === false`:
     - Render `PassiveTraceDeck` wrapping `ThinkingSteps`.
     - Support controlled / uncontrolled open state (defaulting to closed `false`).
     - Render `ThinkingStepsHeader` with settled thought process title (e.g. `Thought process` or `Thought process · N steps`).
     - **Lazy-mount** `ThinkingStepsContent`: Only evaluate and render `ThinkingStep` items when `open === true`.
2. **Deferred Heavy Parsing**:
   - Move `extractSources`, base64 image regexes, and multiline splits inside the lazily rendered step components so they execute only upon user expansion.
3. **Memoization**:
   - Memoize `toolResultByCallId` and step items to prevent recalculations when unrelated state in `AgentPanel` changes.

### C. `@/components/ui/thinking-steps.tsx`
1. **Lazy Content Rendering**:
   - Ensure `ThinkingStepsContent` does not mount child DOM nodes when the accordion is collapsed.
2. **Animation Stability**:
   - Keep spring transitions smooth and contained within expanded mode.

---

## 3. Implementation Steps

1. **Step 1: Clean Up AgentPanel State & Effects**
   - Update `AgentPanel` to ensure settled trace decks remain closed by default and do not auto-expand during streaming.
2. **Step 2: Implement Active State Component (`ActiveTraceRow`)**
   - Build a lightweight single-row container displaying `ThinkingIndicator` and the current action copy from the latest trace part.
3. **Step 3: Implement Passive State Component (`PassiveTraceDeck`) with Lazy Mounting**
   - Implement accordion-based passive deck defaulting to closed.
   - Ensure child trace items (`ThinkingStep`, `ThinkingStepDetails`, `AgentTerminalOutput`, images, sources) are conditionally mounted only when `open === true`.
4. **Step 4: Optimize Parsing and Data Transformation**
   - Guard regexes and expensive string operations behind the open state.
5. **Step 5: Test & Verify**
   - Update and add unit tests in `src/components/assistant-trace-deck.repro.test.tsx`.
   - Verify active state single-row rendering during streaming.
   - Verify passive state default closed state and lazy rendering on user click.
   - Run existing test suite to ensure no regressions.
