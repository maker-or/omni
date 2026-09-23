/**
 * Git-state tone tokens.
 *
 * The workspace surfaces (the control panel header, its action buttons, and
 * the sidebar's active workspace card) all derive their colour from one tone
 * vocabulary, so the same git state reads the same colour everywhere. This
 * module is the single source for that mapping; components import from here
 * rather than re-declaring colours.
 *
 * Header tone is git truth:
 * - neutral: no PR yet (fresh worktree or work in progress)
 * - action:  PR open but something blocks merging (dirty tree, draft,
 *            checks running or failing)
 * - ready:   PR open, tree clean, checks green — merge is the next step
 * - merged:  the branch's PR landed — delete the workspace or continue on
 *            a fresh branch
 * - stale:   no PR and nothing of the user's own to save or share, but the
 *            base branch has moved on — catching up is the next step
 */
export type HeaderTone = "neutral" | "action" | "ready" | "merged" | "stale";

/** Shared tone gradients: the panel header and the sidebar's active workspace
 *  card both paint from this map so the two stay in lockstep. */
export const HEADER_TONE_GRADIENT: Record<HeaderTone, string> = {
  neutral: "from-zinc-300/50 via-zinc-600/20 to-zinc-600/0",
  action: "from-[#FFAA4F] via-[#6F5121] to-[#6F5121]/0",
  ready: "from-[#088139] via-[#114526] to-[#114526]/0",
  merged: "from-violet-500/80 via-violet-900/25 to-violet-900/0",
  stale: "from-[#5CA8FF] via-[#1F3F66] to-[#1F3F66]/0",
};

/** Solid tone colours, used where the state has to read as a colour rather
 *  than a fill (the sidebar active workspace card's inset shadow). Based on
 *  each gradient's `from` colour. */
export const HEADER_TONE_COLOR: Record<HeaderTone, string> = {
  neutral: "#a1a1aa",
  action: "#FFAA4F",
  ready: "#088139",
  merged: "#8b5cf6",
  stale: "#5CA8FF",
};

/**
 * Inset glow for a state surface: the tone colour cast inward from all four
 * edges, on top of whatever background the surface already has. Shared by the
 * control panel header and the sidebar's active workspace card so the two
 * read as the same state in the same colour.
 *
 * Two stacked shadows shape the falloff the way a single blur cannot: a
 * near-edge band, then a deep glow that reaches toward the centre over the
 * parent colour. No border ring — the state reads purely as a soft inward
 * bleed from all four edges.
 */
export function toneInsetShadow(tone: HeaderTone): string {
  const color = HEADER_TONE_COLOR[tone];
  return [`inset 0 0 22px 2px ${color}8c`, `inset 0 0 48px 8px ${color}4d`].join(", ");
}

/**
 * Smooth tone wash for the state header's own background: the state colour at
 * low alpha near the top, easing out to fully transparent so the panel
 * background carries through the lower edge. Pairs with `toneInsetShadow`
 * (the glow brings the look) so the header reads as a coloured surface rather
 * than a flat black block, while still flowing into the body below.
 */
export function toneWash(tone: HeaderTone): string {
  const color = HEADER_TONE_COLOR[tone];
  return `linear-gradient(to bottom, ${color}47 0%, ${color}1f 45%, ${color}00 100%)`;
}

/**
 * Flat fill for solid action buttons. A single saturated shade per state,
 * light enough to carry dark label text.
 */
export const HEADER_TONE_FILL: Record<HeaderTone, string> = {
  neutral: "#f4f4f5",
  action: "#FFAA4F",
  ready: "#6ee7b7",
  merged: "#ddd6fe",
  stale: "#5CA8FF",
};

/**
 * Dark-disc / light-ink pair for an identity badge — the opposite polarity of
 * the flat action buttons (which are light fill + dark ink). The tone is
 * deepened for the disc and lightened for the glyph, so a filled badge reads
 * as a bright mark on a dark field.
 */
export function toneIdentity(tone: HeaderTone): { bg: string; ink: string; ring: string } {
  const color = HEADER_TONE_COLOR[tone];
  return {
    bg: `color-mix(in srgb, ${color} 68%, black)`,
    // Mostly the tone, only a touch of white — a lighter shade of the same
    // hue, not a white glyph.
    ink: `color-mix(in srgb, ${color} 62%, white)`,
    ring: `color-mix(in srgb, ${color} 85%, transparent)`,
  };
}
