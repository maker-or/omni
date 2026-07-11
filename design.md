# Pipper Design System

this is a self improving software
hope

Pipper uses a design system built around **Fluid Functionalism**: layered surfaces, clear scrolling cues, spring-based motion, and swappable visual tokens.

## 1. Surfaces and substrates

### Purpose

Floating UI should not visually collapse into the page behind it. To avoid that, Pipper uses a surface elevation model with context-aware nesting.

### Surface levels

- There are **8 surface levels**.
- Level `1` is the lowest; level `8` is the highest.
- Nested floating UI should read the current surface level from context and elevate relative to it.

### Tokens

Defined in `src/index.css`.

#### Light mode

- Uses flat white backgrounds from level 3 upward.
- Elevation is shown with shadow layers only.
- Shadow tokens: `--shadow-1` through `--shadow-8`.

#### Dark mode

- Uses stepped charcoal-to-gray surface colors.
- Surface tokens range from `--surface-1: #171717` to `--surface-8: #484848`.
- Shadows combine inset highlights and translucent drop shadows.

### Implementation files

- `src/lib/surface-context.tsx` — surface context and hooks
- `src/lib/surface-classes.ts` — static Tailwind surface class mapping
- `src/lib/elevated.tsx` — `<Elevated offset={N}>` wrapper

### Recommended offsets

- `offset={2}`: popovers, dropdowns, hovercards
- `offset={4}`: dialogs, modals, sheets

### Rule

Use `<Elevated offset={N}>` for any floating container. Do not hardcode `bg-surface-*` on floating UI.

---

## 2. Scrolling affordances

### Purpose

Scrollable content should signal when more content exists outside the viewport.

### Behavior

- Lists and scroll panes use edge cues.
- Cues appear on the active edge as the user scrolls.
- Each cue combines a chevron with a fade overlay.

### Implementation

- `@/lib/scroll-fade.tsx`
  - `useScrollEdges(ref, options)` detects overflow and scroll position using:
    - `ResizeObserver`
    - `MutationObserver`
    - scroll listeners
  - `<ScrollEdgeCue />` renders the edge indicator.
  - Cue backgrounds use CSS `color-mix` against the current surface token.

---

## 3. Motion and springs

### Purpose

Use responsive motion instead of linear-feeling transitions.

### Presets

Defined in `@/lib/springs.ts` for Framer Motion.

- `fast`
  - `0.08s` duration
  - `0` bounce
  - `0.06s` exit
  - For subtle micro-interactions

- `moderate`
  - `0.16s` duration
  - `0.08` bounce
  - `0.12s` exit
  - For dropdowns, popovers, accordions

- `slow`
  - `0.24s` duration
  - `0.12` bounce
  - `0.16s` exit
  - For modals and larger layout transitions

---

## 4. Shape system

### Purpose

The app can switch global rounding styles for buttons, inputs, and containers.

### Modes

- `pill` — high rounding
- `rounded` — standard desktop rounding

### Implementation

- `src/lib/shape-context.tsx`
- Keybind: press **R** on non-input nodes to toggle shape mode

---

## 5. Swappable icons

### Purpose

Pipper can map generic icon names to different icon libraries.

### Implementation

- `@/lib/icon-map.tsx` — standardized icon name mapping
- `@/lib/icon-context.tsx` — icon provider and hooks

### Behavior

- Generic names like `plus`, `search`, and `settings` resolve across supported icon sets.
- Press **I** to cycle icon packs in the UI.
- For new UI, prefer `@phosphor-icons/react`.

---

## 6. Code guidelines

When adding or changing UI:

1. Use built-in UI components first.
2. Keep import aliasing consistent:
   - prefer `@/` for `src/`
   - fall back to `/@/` for shared design-system code
3. Do not duplicate shared logic across components.
4. Keep compound hover/index-driven items in sequence.
5. Preserve surface, shape, and icon system behavior across nested UI.
