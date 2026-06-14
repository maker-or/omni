# Pipper Design System: Fluid Functionalism

This document describes the design system implementation in Pipper. The system is built around the principles of **Fluid Functionalism**, emphasizing dynamic visual layering, scrolling indicators, spring-based motion, and hot-swappable visual shapes/icons.

---

## 1. Surfaces & Substrates

### The Concept

To prevent floating containers (popovers, dropdowns, dialogs, tooltips) from blending into their parent layouts (the "collapsing surface problem"), the design system implements a 3D elevation model called **Surfaces and Substrates**.

There are **8 surface levels** (lowest: `1`, highest: `8`). A nested component does not hardcode its color; instead, it queries the parent's surface level from React Context (the **substrate**) and dynamically self-elevates.

### Tokens

Defined in [src/index.css](file:///Users/harshithpasupuleti/code/omni/src/index.css):

- **Light Mode**: Uses flat `#ffffff` backgrounds from level 3 upwards. Elevation is represented entirely through layered, soft shadow recipes (`--shadow-1` to `--shadow-8`).
- **Dark Mode**: Scales backgrounds progressively from charcoal (`--surface-1: #171717`) to light gray (`--surface-8: #484848`). Shadows combine inset highlights (for crisp borders) with deep translucent drop shadows (`--dm-drop`).

### Implementation Files

- [src/lib/surface-context.tsx](file:///Users/harshithpasupuleti/code/omni/src/lib/surface-context.tsx): Implements `SurfaceContext`, `SurfaceProvider`, and `useSurface()`.
- [src/lib/surface-classes.ts](file:///Users/harshithpasupuleti/code/omni/src/lib/surface-classes.ts): Maps surface numbers to static Tailwind utility strings. This is critical for Tailwind v4's scanner to discover and compile surface utilities (dynamic interpolations like `bg-surface-${level}` would be omitted).
- [src/lib/elevated.tsx](file:///Users/harshithpasupuleti/code/omni/src/lib/elevated.tsx): Exposes the `<Elevated offset={N}>` wrapper. It automatically increments the parent substrate level by `N`, applies the correct shadow/background classes, and re-injects the new substrate level into the context for nested children.

#### Recommended Offsets:

- `offset={2}`: Popovers, dropdown menus, hovercards.
- `offset={4}`: Dialogs, modals, slide-out sheets.

---

## 2. Scrolling Affordances (Edges & Cues)

### The Concept

To hint to users that extra content is hidden behind a scrollable viewport, lists and scrolling panes implement **edge cues**. As the user scrolls, a directional chevron and a smooth color-mix gradient overlay fade in at the active edge.

### Implementation Files

- [/@/lib/scroll-fade.tsx](file:///Users/harshithpasupuleti/code/omni/@/lib/scroll-fade.tsx): Contains the logic for detection and rendering:
  - `useScrollEdges(ref, options)`: Uses `ResizeObserver`, `MutationObserver`, and scroll event listeners to monitor overflow and scroll position on the `top`, `bottom`, `left`, or `right` edges.
  - `<ScrollEdgeCue />`: Renders absolute or sticky indicators. The cue background uses CSS `color-mix` against the active `var(--surface-N)` context token to dynamically blend the fade color to the parent container's substrate.

---

## 3. Motion & Springs

### The Concept

UI movement uses physics-based spring simulations rather than linear or cubic easings. Snappy entry animations combined with slightly faster exit durations create a highly responsive experience.

### Physics Presets

Defined in [/@/lib/springs.ts](file:///Users/harshithpasupuleti/code/omni/@/lib/springs.ts) for Framer Motion:

- **`fast`**: `0.08s` (80ms) duration, `0` bounce, `0.06s` (60ms) exit. Optimized for subtle micro-interactions like buttons or checkbox transitions.
- **`moderate`**: `0.16s` (160ms) duration, `0.08` bounce, `0.12s` (120ms) exit. Used for dropdowns, popovers, and accordions.
- **`slow`**: `0.24s` (240ms) duration, `0.12` bounce, `0.16s` (160ms) exit. Reserved for large layout changes like modals or sheet transitions.

---

## 4. Visual Shape Customization

### The Concept

The codebase features a system to switch the border-radius rounding of all buttons, inputs, and containers globally.

### Implementation Files

- [src/lib/shape-context.tsx](file:///Users/harshithpasupuleti/code/omni/src/lib/shape-context.tsx): Configures two global modes:
  - `"pill"`: High rounding (e.g., `rounded-[20px]` buttons, `rounded-3xl` containers).
  - `"rounded"`: Desktop standard rounding (e.g., `rounded-lg` buttons, `rounded-xl` containers).
- **Keybind Shortcut**: Toggles the active shape state globally when pressing the **`R`** key on non-input nodes.

---

## 5. Swappable Icon System

### The Concept

To allow UI personalization and development testing, the design system maps a standardized list of icon names to multiple external libraries.

### Implementation Files

- [/@/lib/icon-map.tsx](file:///Users/harshithpasupuleti/code/omni/@/lib/icon-map.tsx): Standardizes generic icon names (e.g., `plus`, `search`, `settings`) and resolves them across **Lucide**, **Tabler**, **Phosphor**, and **Hugeicons**.
- [/@/lib/icon-context.tsx](file:///Users/harshithpasupuleti/code/omni/@/lib/icon-context.tsx): Holds `IconProvider` and the hooks `useIcon` or `useIcons`.
- **Keybind Shortcut**: Pressing the **`I`** key cycles the entire application UI between the loaded icon packs on the fly.
- _Note_: As specified in [AGENT.md](file:///Users/harshithpasupuleti/code/omni/AGENT.md), icons from `@phosphor-icons/react` are the primary priority for new code components.

---

## 6. Code Guidelines

When writing or modifying UI components in Pipper, follow these structural rules:

1.  **Do not use hardcoded surface background/shadow classes** (e.g. `bg-surface-3`). Always wrap floating containers in `<Elevated offset={N}>`.
2.  **Ensure compound hover coordinates are clean**: In structures like menus or select items, supply consecutive `index` props so that mouse proximity-hover cursor tracking and morphing background animations calculate correctly.
3.  **Preserve import aliasing**: Use `@/` imports resolving to `src/` first, falling back to `/@/` for shared design system structures.
