# Pipper Design System

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

### Git-state colors in the advanced shell

The states are `neutral`, `action`, `ready`, `merged`, and `stale`. Their roles
live in `src/index.css`; components consume them through `src/lib/workspace-tone.ts`.

| Role                  | Token source                                                          | Light/dark behavior                                 |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| Surface / on-surface  | `--surface-1` / `--foreground`                                        | Existing theme surface/text pair                    |
| Accent                | `--workspace-tone-{state}`                                            | Readable state ink in light; original accent in dark |
| Glow / glow base      | `--workspace-glow-{state}` / `--workspace-glow-background-{state}`   | Lighter edge glow over a saturated base in light; dark falls back to its original accent/substrate |
| Header base / wash    | `--workspace-header-background` / `--workspace-header-wash-{state}` | Flat state base with no gradient in light; original dark wash |
| Action / on-action    | `--workspace-fill-{state}` / `--workspace-ink-{state}`                | Coordinated fill/text pair for each theme            |
| Badge surface / glyph | `--workspace-badge-surface-{state}` / `--workspace-badge-ink-{state}` | Coordinated badge/text pair for each theme           |

The light palette uses graphite (`neutral`), amber (`action`), jade (`ready`),
iris (`merged`), and sky blue (`stale`). Selected cards have a saturated center
with a lighter edge glow. Light headers use the same flat state base with
an inset glow; do not add a gradient fill or a fade into the canvas.
Primary actions use deep solid fills with
light state ink. Secondary actions and PR tags use the matching badge shade
and ink. Labels on colored surfaces stay dark and crisp. Action labels,
badge glyphs, and text on selected bases meet
4.5:1 contrast.

Edit the light/default block in `src/index.css` to tune these colors. Dark
mode explicitly clears the light-only glow, base, and wash overrides, preserving
its established palette. Keep both explicit gallery scopes correct when
adding a new override.

#### Reusable components

`src/components/workspace-state.tsx` owns the component role mapping. Use these
components instead of styling a Git state inside a feature component:

- `WorkspaceStateSurface`: selected cards, headers, and status notices. Uses
  `Elevated` and the current surface context; `variant="header"` fades the
  existing glow at the bottom, while `active={false}` removes it.
- `WorkspaceStateAction`: primary, secondary, tag, and split-segment actions.
  Wraps the shared `Button`, including native disabled state, loading, shape,
  refs, and keyboard focus. Secondary/tag fills use the state's coordinated shade;
  dark mode retains its established fill strengths.
- `WorkspaceStateActionGroup`: a single fill behind a split action, avoiding
  a seam between its segments. `SplitButton` uses it for the actual shell menu.
- `WorkspaceStateBadge`: the state-aware disc/glyph pair used by conversation
  identities and the gallery.

```tsx
<WorkspaceStateSurface tone="merged" variant="header" offset={0}>
  <WorkspaceStateBadge tone="merged">@</WorkspaceStateBadge>
  <WorkspaceStateAction tone="merged">Delete</WorkspaceStateAction>
</WorkspaceStateSurface>
```

`WORKSPACE_STATES` and `WORKSPACE_STATE_META` in `workspace-tone.ts` define the
five state names, meanings, and sample actions. Git-derived state selection
remains in the workflow logic; the visual components never perform Git work.

#### Visual reference

Open **Settings → Design system**. `WorkspaceStateGallery` renders the real
components for all five states in both themes. It includes selection previews,
primary/secondary/disabled buttons, split menus, header tabs, badges, and labeled
role swatches. Theme and shape controls affect only the preview.

`data-workspace-theme="light"` and `data-workspace-theme="dark"` establish explicit
token scopes, so either preview remains correct inside an app using the opposite
theme. Add future states to the shared state list and token palette; the gallery
then includes them automatically.

Keep state effects at their established strength. Do not fade the shell or add
a global overlay to adapt these colors. Keep ordinary surfaces and nested
floating containers in the existing elevation system.

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
