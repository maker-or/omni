import {
  BRIEF_SOURCE_LABELS,
  type BriefAction,
  type BriefAgendaEntry,
  type BriefConnection,
  type BriefDocument,
  type BriefItem,
  type BriefSource,
  type BriefStatus,
} from "../../contracts/brief.ts";

/**
 * Pure HTML renderers for everything the embedded browser shows under the
 * `pipper-brief://` scheme: the brief itself, the connect-your-tools setup
 * page, and the progress / error surfaces. Pages are fully self-contained
 * (inline CSS + a tiny script) and talk back to main only through
 * same-origin `fetch` calls to `/api/*`, authenticated by a per-session token.
 */

export interface RenderContext {
  /** Per-app-session secret echoed by page scripts on every API call. */
  token: string;
  theme: "light" | "dark" | "system";
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links are ever rendered as hrefs. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const CONNECTOR_SVGS: Record<BriefSource, string> = {
  gmail: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>`,
  googlecalendar: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z"/></svg>`,
  github: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
  linear: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"/></svg>`,
  slack: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M8.782 0C7.458 0.001 6.386 1.075 6.387 2.4C6.386 3.724 7.459 4.798 8.783 4.799H11.178V2.4C11.179 1.076 10.107 0.002 8.782 0ZM8.782 6.4H2.396C1.072 6.401 -0.001 7.475 0 8.799C-0.002 10.124 1.071 11.198 2.395 11.2H8.782C10.106 11.199 11.178 10.125 11.178 8.801C11.178 7.475 10.106 6.401 8.782 6.4ZM23.952 8.799C23.953 7.475 22.88 6.401 21.556 6.4C20.232 6.401 19.16 7.475 19.161 8.799V11.2H21.556C22.88 11.199 23.953 10.125 23.952 8.799ZM17.565 8.799V2.4C17.566 1.076 16.494 0.002 15.17 0C13.846 0.001 12.774 1.075 12.775 2.4V8.799C12.773 10.124 13.845 11.198 15.169 11.2C16.493 11.199 17.566 10.125 17.565 8.799ZM15.169 24C16.493 23.999 17.566 22.924 17.565 21.6C17.566 20.276 16.493 19.202 15.169 19.201H12.774V21.6C12.773 22.923 13.845 23.998 15.169 24ZM15.169 17.599H21.556C22.881 17.598 23.953 16.523 23.952 15.199C23.954 13.875 22.881 12.801 21.557 12.799H15.17C13.846 12.8 12.774 13.874 12.775 15.198C12.774 16.523 13.845 17.598 15.169 17.599ZM0 15.2C-0.001 16.524 1.072 17.598 2.396 17.599C3.72 17.598 4.792 16.524 4.791 15.2V12.8H2.396C1.072 12.801 -0.001 13.876 0 15.2ZM6.387 15.2V21.6C6.385 22.924 7.458 23.998 8.782 24C10.106 23.999 11.178 22.925 11.177 21.601V15.202C11.179 13.878 10.107 12.803 8.783 12.801C7.458 12.801 6.386 13.876 6.387 15.2Z"/></svg>`,
};

export function connectorSvg(source: BriefSource | string): string {
  const norm = (
    source === "calendar" || source === "calender" ? "googlecalendar" : source
  ) as BriefSource;
  return CONNECTOR_SVGS[norm] ?? "";
}

const SOURCE_GLYPH: Record<BriefSource, string> = {
  gmail: "M",
  googlecalendar: "31",
  github: "GH",
  linear: "L",
  slack: "#",
};

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #111111;
  --surface: #111111;
  --surface-card: #1D1D1D;
  --surface-hover: #262626;
  --border: #2A2A2E;
  --border-light: #3A3A40;
  --text: #FFFFFF;
  --muted: #9CA3AF;
  --faint: #6B7280;
  --accent: #FFE500;
  --accent-text: #000000;
  --accent-soft: rgba(255, 229, 0, 0.12);
  --accent-border: rgba(255, 229, 0, 0.35);
  --warn: #F97316;
  --ok: #22C55E;
  --font-serif: Didot, "Bodoni MT", "Cinzel", "Playfair Display", Baskerville, Georgia, serif;
  --font-sans: -apple-system, BlinkMacSystemFont, "Inter Variable", "Inter", "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --gmail: #EA4335;
  --googlecalendar: #1A73E8;
  --github: #24292F;
  --linear: #5E6AD2;
  --slack: #4A154B;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111111;
  --surface: #111111;
  --surface-card: #1D1D1D;
  --surface-hover: #262626;
  --border: #2A2A2E;
  --border-light: #3A3A40;
  --text: #FFFFFF;
  --muted: #9CA3AF;
  --faint: #6B7280;
  --accent: #FFE500;
  --accent-text: #000000;
}

html[data-theme="light"] {
  color-scheme: light;
  --bg: #F7F7F8;
  --surface: #FFFFFF;
  --surface-card: #EFEFEF;
  --surface-hover: #E4E4E6;
  --border: #E0E0E4;
  --border-light: #CCCCCC;
  --text: #111111;
  --muted: #555558;
  --faint: #8E8E93;
  --accent: #E5C300;
  --accent-text: #000000;
}

* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; }
body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.6 var(--font-sans);
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
}
a { color: inherit; text-decoration: none; }

.top-notch {
  width: 28px;
  height: 14px;
  background: #FFFFFF;
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
  margin: 0 auto;
  opacity: 0.95;
}

.gutter-left {
  position: fixed;
  left: 36px;
  top: 140px;
  z-index: 5;
  pointer-events: none;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}
.vertical-date {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 32px;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: #FFFFFF;
  text-transform: uppercase;
  user-select: none;
}

.gutter-right {
  position: fixed;
  right: 36px;
  top: 140px;
  z-index: 5;
  pointer-events: none;
  writing-mode: vertical-rl;
}
.vertical-time {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 32px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: #FFFFFF;
  text-transform: uppercase;
  user-select: none;
}

.page {
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 32px 80px;
  position: relative;
  text-align: left;
}

.hero-section {
  margin-bottom: 36px;
}
.artwork-frame {
  position: relative;
  width: 100%;
  height: 380px;
  border-radius: 6px;
  overflow: hidden;
  background: #1a1a1a;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.artwork-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 30%;
  display: block;
}
.artwork-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.38) 100%);
  text-align: center;
  pointer-events: none;
}
.hero-the {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 500;
  font-size: 46px;
  line-height: 1;
  color: #FFE500;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.75);
}
.hero-title {
  margin: 4px 0 0;
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 78px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: #FFE500;
  text-shadow: 0 4px 22px rgba(0, 0, 0, 0.85);
}
.hero-caption-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 32px;
  margin-top: 14px;
}
.hero-summary {
  margin: 0;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 14.5px;
  line-height: 1.55;
  color: #A0A0A0;
  max-width: 58%;
  text-wrap: pretty;
}
.hero-citation {
  font-size: 11px;
  line-height: 1.45;
  color: #666666;
  text-align: right;
  max-width: 38%;
  font-family: var(--font-sans);
}

.push-card {
  background: var(--surface-card);
  border-radius: 16px;
  padding: 36px 40px;
  margin: 36px 0 48px;
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 36px;
  align-items: start;
}
.push-col-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.push-sticker-wrap {
  margin-top: 4px;
}
.starburst-btn {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
  width: 104px;
  height: 104px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: rotate(-6deg);
  transition: transform 0.16s ease;
}
.starburst-btn:hover {
  transform: rotate(-3deg) scale(1.06);
}
.starburst-btn:active {
  transform: rotate(-6deg) scale(0.96);
}
.starburst-svg {
  width: 100%;
  height: 100%;
  display: block;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
}
.starburst-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-family: var(--font-sans);
  font-weight: 800;
  font-size: 13.5px;
  line-height: 1.15;
  color: #000000;
  user-select: none;
}

.push-col-right {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.push-item-title {
  font-family: var(--font-sans);
  font-size: 17.5px;
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1.4;
  margin-bottom: 10px;
}
.push-item-why {
  font-family: var(--font-sans);
  font-size: 14.5px;
  font-weight: 400;
  color: var(--muted);
  line-height: 1.6;
}

.editorial-section {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 36px;
  align-items: start;
  margin-bottom: 48px;
}
.editorial-col-left {
  position: sticky;
  top: 32px;
}
.section-serif-heading {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 22px;
  font-weight: 400;
  color: #FFFFFF;
  line-height: 1.3;
  margin: 0;
}
.editorial-col-right {
  min-width: 0;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 18px;
}
.todo-bullet {
  width: 14px;
  height: 14px;
  border: 1.5px solid #4B5563;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}
.todo-content {
  flex: 1;
  min-width: 0;
}
.todo-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.todo-title {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1.4;
}
a.todo-title {
  color: #FFFFFF;
  transition: color 0.12s;
}
a.todo-title:hover {
  color: var(--accent);
}
.item-src-badge {
  display: inline-flex;
  align-items: center;
}
.item-src-badge .src {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: transparent;
  vertical-align: middle;
}
.item-src-badge .src svg {
  width: 17px;
  height: 17px;
  display: block;
}
.item-src-badge .src svg path {
  fill: #FFFFFF;
}
.src {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #FFFFFF;
  flex-shrink: 0;
}
.src svg {
  width: 16px;
  height: 16px;
  display: block;
}
.src svg path {
  fill: currentColor;
}
.src.gmail { background: var(--gmail); }
.src.googlecalendar { background: var(--googlecalendar); }
.src.github { background: var(--github); }
.src.linear { background: var(--linear); }
.src.slack { background: var(--slack); }

.todo-why {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 400;
  color: var(--muted);
  line-height: 1.6;
  margin-top: 8px;
}

.meta {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--faint);
}
.meta .dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--faint);
}

.actions {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.btn {
  appearance: none;
  border: 1px solid var(--border);
  background: #222225;
  color: #FFFFFF;
  border-radius: 8px;
  padding: 6px 14px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s, border-color 0.12s;
}
.btn:hover {
  background: #2E2E33;
  border-color: var(--border-light);
}
.btn:active {
  transform: translateY(1px);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #000000;
  font-weight: 700;
}
.btn.primary:hover {
  background: #FFD700;
  border-color: #FFD700;
}
.btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.done {
  background: var(--ok);
  border-color: var(--ok);
  color: #FFFFFF;
}

.draft {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #18181B;
  padding: 14px;
  display: none;
  text-align: left;
}
.draft.open {
  display: block;
}
.draft textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #0E0E10;
  color: #FFFFFF;
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.5;
  padding: 10px 12px;
  outline: none;
  box-sizing: border-box;
}
.draft textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.draft .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.draft .hint {
  font-size: 12px;
  color: var(--muted);
}

.agenda {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.slot {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-card);
  text-align: left;
}
.slot.past { opacity: 0.45; }
.slot.now {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.slot .time-col {
  width: 76px;
  flex-shrink: 0;
}
.time {
  font-family: var(--font-mono);
  font-size: 13.5px;
  font-weight: 700;
  color: #FFFFFF;
}
.time small {
  margin-left: 2px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
.slot-content {
  flex: 1;
  min-width: 0;
}
.slot-title {
  font-size: 15px;
  font-weight: 600;
  color: #FFFFFF;
}
.slot-note {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  background: rgba(255, 229, 0, 0.08);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  padding: 8px 12px;
  color: #FFFFFF;
}
.empty {
  color: var(--muted);
  font-size: 14px;
  padding: 24px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  text-align: center;
}

.brief-footer {
  margin-top: 60px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--faint);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--muted);
  background: #18181A;
}
.chip .state {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
}
.chip.off .state { background: var(--faint); }
.chip.err .state { background: var(--warn); }
.chip button {
  all: unset;
  cursor: pointer;
  color: var(--accent);
  font-weight: 600;
  margin-left: 2px;
}
.chip button:hover { text-decoration: underline; }
.footer-meta {
  font-size: 12px;
  color: var(--faint);
}

.center {
  width: 100%;
  max-width: 640px;
  margin: 60px auto;
  padding: 0 20px;
}
.panel {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  padding: 40px;
  text-align: left;
}
.panel .eyebrow {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 16px;
  color: var(--accent);
  margin-bottom: 8px;
}
.panel .headline {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
  color: #FFFFFF;
}
.panel .summary {
  margin-top: 10px;
  font-size: 14.5px;
  color: var(--muted);
  line-height: 1.6;
}
.connect-grid {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.connect {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #18181A;
}
.connect .name {
  flex: 1;
  font-size: 14.5px;
  font-weight: 600;
  color: #FFFFFF;
}
.connect .ok {
  color: var(--ok);
  font-size: 13px;
  font-weight: 600;
}
.progress {
  margin-top: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--muted);
  font-size: 14px;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.steps {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--faint);
}
.step i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
}
.step.active {
  color: #FFFFFF;
  font-weight: 600;
}
.step.active i {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.step.done {
  color: var(--muted);
}
.step.done i {
  background: var(--ok);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%) translateY(20px);
  opacity: 0;
  z-index: 20;
  background: #FFFFFF;
  color: #111111;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  transition: opacity 0.18s, transform 0.18s;
  pointer-events: none;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

@media (max-width: 1100px) {
  .gutter-left, .gutter-right {
    display: none;
  }
}
@media (max-width: 768px) {
  .page { padding: 18px 20px 60px; }
  .artwork-frame { height: 260px; }
  .hero-the { font-size: 34px; }
  .hero-title { font-size: 50px; }
  .hero-caption-row { flex-direction: column; gap: 12px; }
  .hero-summary, .hero-citation { max-width: 100%; text-align: left; }
  .push-card { grid-template-columns: 1fr; gap: 20px; padding: 24px 20px; }
  .push-col-left { flex-direction: row; justify-content: space-between; align-items: center; }
  .push-section-heading { margin-bottom: 0; }
  .editorial-section { grid-template-columns: 1fr; gap: 16px; }
  .editorial-col-left { position: static; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;

function script(ctx: RenderContext, extra = ""): string {
  // Kept small and dependency-free. All state changes go through /api/*.
  return `<script>
(() => {
  const TOKEN = ${JSON.stringify(ctx.token)};
  const toastEl = document.getElementById("toast");
  let toastTimer;
  window.briefToast = (text) => {
    if (!toastEl) return;
    toastEl.textContent = text; toastEl.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  };
  window.briefApi = async (path, body) => {
    const res = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-brief-token": TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || ("Request failed (" + res.status + ")"));
    return data;
  };
  document.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const kind = btn.dataset.kind;
    const id = btn.dataset.action;
    if (kind === "composio" && !btn.dataset.confirm) {
      const panel = document.getElementById("draft-" + btn.dataset.slot);
      if (panel) { panel.classList.toggle("open"); panel.querySelector("textarea")?.focus(); }
      return;
    }
    const payload = { id, date: document.body.dataset.briefDate };
    if (btn.dataset.confirm) {
      const area = document.getElementById("text-" + btn.dataset.slot);
      if (area) payload.text = area.value;
    }
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = "Working…";
    try {
      const result = await briefApi("action", payload);
      btn.textContent = result.label || "Done"; btn.classList.add("done");
      if (result.message) briefToast(result.message);
      if (btn.dataset.confirm) {
        const trigger = document.querySelector('[data-slot="' + btn.dataset.slot + '"][data-kind="composio"]:not([data-confirm])');
        if (trigger) { trigger.textContent = result.label || "Done"; trigger.classList.add("done"); trigger.disabled = true; }
        document.getElementById("draft-" + btn.dataset.slot)?.classList.remove("open");
      }
    } catch (error) {
      btn.disabled = false; btn.textContent = original;
      briefToast(error.message || "Something went wrong");
    }
  });
  ${extra}
})();
</script>`;
}

function shell(ctx: RenderContext, title: string, body: string, extraScript = ""): string {
  const theme = ctx.theme === "system" ? "" : ` data-theme="${ctx.theme}"`;
  return `<!doctype html>
<html lang="en"${theme}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;" />
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${script(ctx, extraScript)}
</body>
</html>`;
}

export function sourceBadge(source: BriefSource): string {
  const icon = CONNECTOR_SVGS[source] ?? escapeHtml(SOURCE_GLYPH[source] ?? "");
  return `<span class="src ${source}" title="${escapeHtml(BRIEF_SOURCE_LABELS[source])}" aria-label="${escapeHtml(
    BRIEF_SOURCE_LABELS[source],
  )}">${icon}</span>`;
}

function renderActions(item: BriefItem, slot: string, quiet = false): string {
  if (item.actions.length === 0) return "";
  const buttons: string[] = [];
  const drafts: string[] = [];
  item.actions.forEach((action: BriefAction, index) => {
    const primary = !quiet && index === 0 && action.kind !== "link" ? " primary" : "";
    if (action.kind === "link") {
      const href = safeUrl(action.url);
      if (!href) return;
      buttons.push(
        `<a class="btn" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(action.label)} ↗</a>`,
      );
      return;
    }
    const actionSlot = `${slot}-${index}`;
    buttons.push(
      `<button class="btn${primary}" data-action="${escapeHtml(action.id)}" data-kind="${action.kind}" data-slot="${actionSlot}">${escapeHtml(
        action.label,
      )}</button>`,
    );
    if (action.kind === "composio") {
      const verb = action.tool.includes("DRAFT") ? "Save draft" : "Confirm & send";
      drafts.push(`<div class="draft" id="draft-${actionSlot}">
  <textarea id="text-${actionSlot}" aria-label="Reply text">${escapeHtml(action.preview)}</textarea>
  <div class="row"><span class="hint">${
    action.tool.includes("DRAFT")
      ? "Saved to your Gmail drafts — nothing is sent."
      : "Posts as you once you confirm. Edit freely first."
  }</span><button class="btn primary" data-action="${escapeHtml(action.id)}" data-kind="composio" data-confirm="1" data-slot="${actionSlot}">${verb}</button></div>
</div>`);
    }
  });
  return `<div class="actions">${buttons.join("")}</div>${drafts.join("")}`;
}

function renderMeta(item: BriefItem): string {
  const parts = [BRIEF_SOURCE_LABELS[item.source], ...(item.meta?.split(" · ") ?? [])].filter(
    Boolean,
  );
  return `<div class="meta">${parts
    .map((p, i) => `${i > 0 ? '<span class="dot"></span>' : ""}<span>${escapeHtml(p)}</span>`)
    .join("")}</div>`;
}

const STARBURST_POINTS =
  "50.0,0.0 57.8,10.8 69.1,3.8 72.2,16.7 85.4,14.6 83.3,27.8 96.2,30.9 89.2,42.2 100.0,50.0 89.2,57.8 96.2,69.1 83.3,72.2 85.4,85.4 72.2,83.3 69.1,96.2 57.8,89.2 50.0,100.0 42.2,89.2 30.9,96.2 27.8,83.3 14.6,85.4 16.7,72.2 3.8,69.1 10.8,57.8 0.0,50.0 10.8,42.2 3.8,30.9 16.7,27.8 14.6,14.6 27.8,16.7 30.9,3.8 42.2,10.8";

function renderPushSticker(push: BriefItem): string {
  const primaryAction = push.actions[0];
  const actionAttrs = primaryAction
    ? ` data-action="${escapeHtml(primaryAction.id)}" data-kind="${escapeHtml(primaryAction.kind)}" data-slot="push-sticker"`
    : "";
  return `<button class="starburst-btn"${actionAttrs} aria-label="Let's do it">
  <svg class="starburst-svg" viewBox="0 0 100 100" aria-hidden="true">
    <polygon points="${STARBURST_POINTS}" fill="#FFE500" />
  </svg>
  <span class="starburst-label">Let's<br>do it →</span>
</button>`;
}

function renderItem(item: BriefItem, index: number, ranked: boolean, slot: string): string {
  const href = safeUrl(item.url);
  const title = href
    ? `<a class="todo-title item-title" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`
    : `<span class="todo-title item-title">${escapeHtml(item.title)}</span>`;
  const badge = sourceBadge(item.source);
  return `<li class="todo-item item">
  <div class="todo-bullet rank" aria-hidden="true"></div>
  <div class="todo-content item-content">
    <div class="todo-title-row">
      ${title}
      <span class="item-src-badge">${badge}</span>
    </div>
    <div class="todo-why item-why">${escapeHtml(item.why)}</div>
    ${renderMeta(item)}
    ${renderActions(item, slot, !ranked)}
  </div>
</li>`;
}

function formatClock(iso: string): { time: string; suffix: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(d);
  const suffix = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const time = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  return { time, suffix };
}

function renderAgenda(agenda: BriefAgendaEntry[], now: Date): string {
  if (agenda.length === 0) {
    return `<div class="empty">No meetings on your calendar for the rest of today.</div>`;
  }
  return `<ol class="agenda">${agenda
    .map((entry) => {
      const start = Date.parse(entry.startsAt);
      const end = Date.parse(entry.endsAt ?? entry.startsAt);
      const state = end < now.getTime() ? " past" : start <= now.getTime() ? " now" : "";
      const clock = entry.allDay ? { time: "All day", suffix: "" } : formatClock(entry.startsAt);
      const href = safeUrl(entry.url);
      const who = entry.attendees.length
        ? `${entry.attendees.slice(0, 4).join(", ")}${entry.attendees.length > 4 ? ` +${entry.attendees.length - 4}` : ""}`
        : null;
      const meta = [entry.location, who].filter(Boolean) as string[];
      return `<li class="slot${state}">
  <div class="time-col">
    <div class="time">${escapeHtml(clock.time)}<small>${escapeHtml(clock.suffix)}</small></div>
  </div>
  <div class="slot-content">
    <div class="slot-title">${escapeHtml(entry.title)}</div>
    ${meta.length ? `<div class="meta">${meta.map((m, i) => `${i ? '<span class="dot"></span>' : ""}<span>${escapeHtml(m)}</span>`).join("")}</div>` : ""}
    ${entry.note ? `<div class="slot-note">${escapeHtml(entry.note)}</div>` : ""}
    ${href && state !== " past" ? `<div class="actions"><a class="btn" href="${escapeHtml(href)}" target="_blank" rel="noopener">${/meet\.google|zoom\.us|teams\.microsoft/.test(href) ? "Join" : "Open event"} ↗</a></div>` : ""}
  </div>
</li>`;
    })
    .join("")}</ol>`;
}

function renderSourceChips(doc: BriefDocument): string {
  return `<div class="chips">${doc.sources
    .map((s) => {
      const cls = !s.connected ? " off" : s.error ? " err" : "";
      const state = !s.connected
        ? `<button data-connect="${s.source}">Connect</button>`
        : s.error
          ? "unavailable"
          : `${s.itemCount}`;
      return `<span class="chip${cls}"><span class="state"></span>${escapeHtml(BRIEF_SOURCE_LABELS[s.source])} · ${state}</span>`;
    })
    .join("")}</div>`;
}

const CONNECT_SCRIPT = `
document.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-connect]");
  if (!btn) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Opening…";
  try {
    await briefApi("connect", { source: btn.dataset.connect });
    btn.textContent = "Waiting for sign-in…";
    briefToast("Finish signing in from your browser — the brief updates on its own.");
  } catch (error) {
    btn.disabled = false; btn.textContent = original;
    briefToast(error.message || "Could not start the connection");
  }
});`;

export function renderBriefPage(doc: BriefDocument, ctx: RenderContext, now = new Date()): string {
  const day = new Date(`${doc.date}T12:00:00`);
  const weekday = day.toLocaleDateString("en-US", { weekday: "long" });
  const dayNum = day.getDate();
  const month = day.toLocaleDateString("en-US", { month: "short" });
  const year = day.getFullYear();
  const dateSidebar = `${dayNum} ${month.toUpperCase()} ${year}`;
  const dateTitle = `${weekday}, ${month} ${dayNum}`;
  const generatedDate = new Date(doc.generatedAt);
  const timeSidebar = generatedDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const generated = generatedDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const push = doc.push
    ? `<section class="push-card push" aria-label="Push your work forward">
  <div class="push-col-left">
    <h2 class="push-section-heading">Push your work forward <span class="sr-only">Needs you</span></h2>
    <div class="push-sticker-wrap">
      ${renderPushSticker(doc.push)}
    </div>
  </div>
  <div class="push-col-right">
    <div class="push-item-title title">${escapeHtml(doc.push.title)}</div>
    <div class="push-item-why why">${escapeHtml(doc.push.why)}</div>
    ${renderMeta(doc.push)}
    ${renderActions(doc.push, "push")}
  </div>
</section>`
    : "";
  const todos = doc.todos.filter((t) => t.id !== doc.push?.id);
  const todosSection =
    todos.length > 0
      ? `<section class="editorial-section" aria-label="Top to-dos">
    <div class="editorial-col-left">
      <h2 class="section-serif-heading">Top to-dos <span class="sr-only">Needs you</span></h2>
    </div>
    <div class="editorial-col-right">
      <ol class="todo-list list">${todos.map((t, i) => renderItem(t, i + (doc.push ? 1 : 0), true, `todo-${i}`)).join("")}</ol>
    </div>
  </section>`
      : "";
  const agendaSection =
    doc.agenda.length > 0
      ? `<section class="editorial-section" aria-label="Today">
    <div class="editorial-col-left">
      <h2 class="section-serif-heading">Today</h2>
    </div>
    <div class="editorial-col-right">
      ${renderAgenda(doc.agenda, now)}
    </div>
  </section>`
      : "";
  const contextSection =
    doc.context.length > 0
      ? `<section class="editorial-section" aria-label="Worth knowing">
  <div class="editorial-col-left">
    <h2 class="section-serif-heading">Worth knowing</h2>
  </div>
  <div class="editorial-col-right">
    <ol class="todo-list list">${doc.context.map((c, i) => renderItem(c, i, false, `ctx-${i}`)).join("")}</ol>
  </div>
</section>`
      : "";
  let writer = "composed by Pipper";
  if (doc.writer === "anthropic") {
    writer = "written with Claude";
  } else if (doc.writer === "claude-cli") {
    writer = "written with Claude Code";
  } else if (doc.writer.startsWith("acp:")) {
    writer = `written with ${escapeHtml(doc.writer.slice(4))}`;
  } else if (doc.writer !== "builtin") {
    writer = `written with ${escapeHtml(doc.writer)}`;
  }
  const body = `<div class="top-notch" aria-hidden="true"></div>
<div class="gutter-left" aria-hidden="true"><span class="vertical-date">${escapeHtml(dateSidebar)}</span></div>
<div class="gutter-right" aria-hidden="true"><span class="vertical-time">${escapeHtml(timeSidebar)}</span></div>
<main class="page">
  <header class="hero-section masthead">
    <div class="artwork-frame">
      <img class="artwork-img" src="/art.jpg" alt="The Island of Raguenez, Brittany by Henri Moret" />
      <div class="artwork-overlay">
        <div class="hero-the">The</div>
        <h1 class="hero-title">${escapeHtml(weekday)} Brief</h1>
      </div>
    </div>
    <div class="hero-caption-row">
      <p class="hero-summary summary">${
        doc.headline ? `<span class="hero-headline">${escapeHtml(doc.headline)} — </span>` : ""
      }${escapeHtml(doc.summary)}</p>
      <div class="hero-citation">The Island of Raguenez, Brittany, Henri Moret, 1890/1895. oil on canvas</div>
    </div>
  </header>
  ${push}
  ${todosSection}
  ${agendaSection}
  ${contextSection}
  <footer class="brief-footer">
    ${renderSourceChips(doc)}
    <div class="footer-meta">Generated at ${escapeHtml(generated)} · ${doc.analysis.signalsAnalyzed} items triaged${
      doc.analysis.model ? ` by ${escapeHtml(doc.analysis.model)}` : ""
    } · ${writer}</div>
  </footer>
</main>`;
  return shell(ctx, `Morning Brief — ${dateTitle}`, body, CONNECT_SCRIPT).replace(
    "<body>",
    `<body data-brief-date="${escapeHtml(doc.date)}">`,
  );
}

const STATUS_POLL_SCRIPT = `
const startedPhase = document.body.dataset.phase;
const tick = async () => {
  try {
    const status = await briefApi("status");
    if (status.phase !== startedPhase || status.updatedAt !== document.body.dataset.updated) {
      location.reload();
      return;
    }
  } catch {}
  setTimeout(tick, 2000);
};
setTimeout(tick, 2000);
document.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-refresh]");
  if (!btn) return;
  btn.disabled = true;
  try { await briefApi("refresh", {}); } catch (error) { btn.disabled = false; briefToast(error.message); }
});`;

const PHASES: Array<{ phase: BriefStatus["phase"]; label: string }> = [
  { phase: "collecting", label: "Reading Gmail, Calendar, GitHub, Linear and Slack" },
  { phase: "analyzing", label: "Triaging every item with Jev" },
  { phase: "writing", label: "Writing your brief" },
  { phase: "rendering", label: "Laying it out" },
];

export function renderProgressPage(status: BriefStatus, ctx: RenderContext): string {
  const activeIndex = PHASES.findIndex((p) => p.phase === status.phase);
  const steps = PHASES.map((p, i) => {
    const cls = i === activeIndex ? " active" : i < activeIndex ? " done" : "";
    return `<div class="step${cls}"><i></i>${escapeHtml(p.label)}</div>`;
  }).join("");
  const body = `<main class="center"><div class="panel">
  <div class="eyebrow">Morning Brief</div>
  <h1 class="headline">Putting your morning together</h1>
  <div class="progress"><div class="spinner"></div><span>${escapeHtml(status.message ?? "Working…")}</span></div>
  <div class="steps">${steps}</div>
</div></main>`;
  return shell(ctx, "Morning Brief", body, STATUS_POLL_SCRIPT).replace(
    "<body>",
    `<body data-phase="${escapeHtml(status.phase)}" data-updated="${escapeHtml(status.updatedAt)}">`,
  );
}

export function renderErrorPage(status: BriefStatus, ctx: RenderContext): string {
  const body = `<main class="center"><div class="panel">
  <div class="eyebrow">Morning Brief</div>
  <h1 class="headline">The brief didn't come together this time</h1>
  <p class="summary">${escapeHtml(status.error ?? "Something went wrong while building your brief.")}</p>
  <div class="actions" style="margin-top:20px"><button class="btn primary" data-refresh="1">Try again</button></div>
</div></main>`;
  return shell(ctx, "Morning Brief", body, STATUS_POLL_SCRIPT).replace(
    "<body>",
    `<body data-phase="${escapeHtml(status.phase)}" data-updated="${escapeHtml(status.updatedAt)}">`,
  );
}

export function renderSetupPage(
  connections: BriefConnection[],
  status: BriefStatus,
  ctx: RenderContext,
  missingKeys: string[] = [],
): string {
  const keysNote =
    missingKeys.length > 0
      ? `<p class="summary">Pipper is missing ${escapeHtml(missingKeys.join(" and "))}. Add ${
          missingKeys.length > 1 ? "them" : "it"
        } in Settings → Morning Brief.</p>`
      : "";
  const rows = connections
    .map(
      (c) =>
        `<div class="connect">${sourceBadge(c.source)}<span class="name">${escapeHtml(c.label)}</span>${
          c.connected
            ? `<span class="ok">Connected</span>`
            : `<button class="btn${c.pending ? "" : " primary"}" data-connect="${c.source}"${
                missingKeys.length ? " disabled" : ""
              }>${c.pending ? "Waiting for sign-in…" : "Connect"}</button>`
        }</div>`,
    )
    .join("");
  const connectedCount = connections.filter((c) => c.connected).length;
  const body = `<main class="center"><div class="panel">
  <div class="eyebrow">Morning Brief</div>
  <h1 class="headline">Connect your tools and Pipper will brief you every morning</h1>
  <p class="summary">Your brief pulls what matters from your inbox, calendar, code reviews, tickets and Slack — the to-dos you owe, context you'd otherwise miss, and one thing Pipper can move forward for you.</p>
  ${keysNote}
  <div class="connect-grid">${rows}</div>
  ${
    connectedCount > 0
      ? `<div class="actions" style="margin-top:18px"><button class="btn" data-refresh="1">Build my brief now</button></div>`
      : ""
  }
  <p class="greeting" style="font-size:12px;margin-top:18px">Connections are handled by Composio. Sign-in opens in your browser; Pipper never sees your passwords.</p>
</div></main>`;
  return shell(ctx, "Morning Brief — Connect", body, CONNECT_SCRIPT + STATUS_POLL_SCRIPT).replace(
    "<body>",
    `<body data-phase="${escapeHtml(status.phase)}" data-updated="${escapeHtml(status.updatedAt)}">`,
  );
}
