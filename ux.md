# UX Improvement Report for Pipper

Pipper already has a strong base: layered surfaces, fast agent interaction, terminal views, project switching, update flows, and an interesting “agent harness” identity. The biggest opportunity is making the app feel less like a functional shell and more like a calm, responsive workspace where every interaction confirms the user is in control.

## 4. Make the agent feel more alive and understandable

### Current feeling

Agent state exists: streaming, working messages, status, hidden thinking label, queue. The UX opportunity is to expose this state more elegantly.

### Improvement

Create a clearer agent activity model:

- “Thinking…” should have stages:
  - Reading files
  - Running command
  - Editing
  - Waiting for approval
  - Summarizing
- Show active tool/action in a compact status pill.
- Queue visibility:
  - “Current”
  - “Next”
  - “Queued”
- When user sends during streaming, clearly label:
  - “Steer current response”
  - “Send as follow-up”
- Let users collapse/expand tool traces smoothly.

### Why it matters

Agent apps feel magical but can also feel unpredictable. Clear agent state makes users feel safe.

---

## 5. Improve perceived performance

### Current feeling

Project/thread/agent loading likely depends on IPC and runtime initialization, which can produce waiting moments.

### Improvement

Use progressive loading:

- Keep previous content visible while loading new context.
- Use skeletons only where content is unknown.
- Avoid full-panel loading unless absolutely necessary.
- Prefetch likely next threads/projects.
- Show cached agent snapshot instantly, then refresh in background.
- Optimistically create tabs/terminals before backend confirmation.

### Why it matters

Users judge speed by continuity, not only raw latency.

---

## 6. Polish the split-pane workspace

### Current feeling

The app uses resizable panels. These can feel mechanical unless handles and layout persistence are polished.

### Improvement

- Make resize handles easier to discover with subtle hover glow.
- Save panel sizes per project.
- Add double-click reset on separator.
- Add keyboard shortcuts for focusing:
  - Agent
  - Terminal
  - Project selector
  - Thread list
- Add focus ring clarity for keyboard users.

### Why it matters

Pipper is a workspace. Layout memory and smooth focus movement make it feel professional.

---

## 7. Improve project switching

### Current feeling

Project switching exists in the header dropdown, but could become a richer control center.

### Improvement

- Add search/filter inside project dropdown.
- Show project path as secondary text.
- Show recent projects first.
- Add visual active indicator.
- Support keyboard navigation.
- Add “Open folder” / “Reveal in Finder” actions.
- Show project health:
  - Git clean/dirty
  - Last active thread
  - Dependency status maybe later

### Why it matters

Projects are the app’s top-level context. Switching should feel fast and confident.

---

## 8. Make terminal views more integrated

### Current feeling

Terminal is available under “Others” as tabs. It works, but may feel separate from agent work.

### Improvement

- Allow “Send terminal output to agent.”
- Let agent-created terminal commands appear as rich command cards.
- Add terminal session status:
  - running
  - exited
  - error
- Rename terminal tabs inline.
- Persist terminal tabs per project/session if appropriate.
- Add “New terminal in repo root” as one-click empty state action.

### Why it matters

The agent + terminal loop is central for coding workflows.

---

## 9. Strengthen visual hierarchy

### Current feeling

The app has good surface tokens, but some UI may look flat because many areas use similar surface levels.

### Improvement

- Give floating menus stronger elevation via existing `<Elevated />`.
- Use softer shadow separation instead of frequent borders.
- Make primary workspace areas visually distinct:
  - header
  - agent panel
  - other views
  - overlays
- Use typography hierarchy:
  - section labels smaller/lighter
  - active thread/project clearer
  - timestamps/status in muted tabular text

### Why it matters

Visual hierarchy reduces cognitive load.

---

## 10. Add delight without distraction

### Good candidates

- Ambient pixel field reacts subtly when agent is working.
- Send button morphs into stop button while streaming.
- Completion has a tiny success pulse.
- New message appears with subtle fade/translate.
- Dragging files into input highlights the drop zone.
- Image attachments appear as polished thumbnails with remove affordance.
- Slash command menu can animate command filtering.

### Avoid

- Big bouncy animations.
- Long staged sequences.
- Animating entire panels too often.
- Anything that delays user action.

---

# Priority Roadmap

## Highest impact

1. Smooth project/thread/terminal transitions.
2. Clearer agent working state and queue visibility.
3. Better empty states with starter actions.
4. Tactile button/tab/dropdown feedback.
5. Project dropdown search and richer metadata.

## Medium impact

6. Persistent panel sizes.
7. Better terminal-agent handoff.
8. More refined loading/skeleton behavior.
9. Keyboard navigation polish.

## Delight layer

10. Ambient working animations.
11. Rich command cards.
12. Subtle completion/success feedback.

# Summary

The best UX direction is: **make Pipper feel calm, continuous, and responsive.**

Not flashy. Not over-animated. The app should feel like a serious coding cockpit with tiny moments of delight: smooth context switches, clear agent state, tactile controls, beautiful empty states, and polished feedback for every user action.
