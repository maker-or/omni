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
  color-scheme: light;
  --bg: #2f2f2f;
  --card-border: #8b7f0d;
  --surface-top: #fde301;
  --surface-mid: #deca17;
  --surface-bottom: #d5bf0d;
  --surface: #fde301;
  --surface-2: #ffea38;
  --border: rgba(1, 39, 69, .20);
  --text: #012745;
  --muted: #1e4566;
  --faint: #3a5d7c;
  --accent: #2483d2;
  --accent-soft: rgba(36, 131, 210, .14);
  --warn: #b23c0a;
  --ok: #15752f;
  --frame: #012745;
  --shadow: 0 20px 50px rgba(0, 0, 0, .45);
  --font-display: "Chalkboard SE", "Comic Neue", "Chalkboard", "Comic Sans MS", "Patrick Hand", "Gaegu", cursive, sans-serif;
  --font-hand: "Chalkboard SE", "Comic Neue", "Chalkboard", "Comic Sans MS", "Patrick Hand", "Gaegu", cursive, sans-serif;
  --gmail: #d93025;
  --googlecalendar: #1a73e8;
  --github: #161b22;
  --linear: #5e6ad2;
  --slack: #611f69;
}
html[data-theme="dark"] {
  --bg: #242424;
}
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; }
body {
  margin: 0;
  padding: 28px 16px;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.65 var(--font-hand);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
}
a { color: inherit; }
.page {
  width: 100%;
  max-width: 680px;
  margin: 0 auto;
  padding: 48px clamp(20px, 5vw, 44px) 56px;
  background: linear-gradient(180deg, var(--surface-top) 0%, #ebd50e 35%, var(--surface-mid) 70%, var(--surface-bottom) 100%);
  border: 10px solid var(--card-border);
  border-radius: 28px;
  box-shadow: var(--shadow);
  text-align: center;
  position: relative;
}
.masthead { margin: 0 0 12px; }
.brand {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--accent);
  font-size: clamp(52px, 12vw, 82px);
  line-height: .90;
  letter-spacing: .5px;
  text-align: center;
}
.brand span.line { display: block; }
.brand span.line + span.line { margin-top: 2px; }
.flower-i {
  position: relative;
  display: inline-block;
  vertical-align: baseline;
}
.flower-i .stem {
  display: inline-block;
  line-height: inherit;
}
.flower-i .flower {
  position: absolute;
  top: -0.16em;
  left: 50%;
  transform: translateX(-50%);
  width: 0.35em;
  height: 0.35em;
  pointer-events: none;
}
.date {
  margin: 18px 0 32px;
  font-family: var(--font-hand);
  font-weight: 700;
  color: var(--accent);
  font-size: 23px;
  letter-spacing: .5px;
}
.eyebrow {
  font-family: var(--font-hand);
  font-size: 13px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 800;
}
.greeting {
  margin: 0 auto;
  font-size: 18px;
  font-weight: 700;
  color: var(--muted);
  max-width: 44ch;
}
.headline {
  margin: 12px auto 0;
  max-width: 40ch;
  font-family: var(--font-hand);
  font-weight: 700;
  font-size: 21px;
  line-height: 1.5;
  color: var(--text);
  text-wrap: balance;
}
.summary {
  margin: 14px auto 0;
  font-size: 16.5px;
  line-height: 1.65;
  max-width: 44ch;
  color: var(--text);
  text-wrap: pretty;
}
section { margin-top: 42px; }
.section-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 0 auto 18px;
  max-width: 44ch;
}
.section-title::before, .section-title::after {
  content: "";
  height: 2px;
  width: 36px;
  border-radius: 2px;
  background: var(--border);
}
.section-title h2 {
  margin: 0;
  font-family: var(--font-hand);
  font-size: 14px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 700;
}
.section-title .count {
  font-size: 13px;
  color: var(--accent);
  font-weight: 800;
}
.push {
  position: relative;
  background: rgba(255, 255, 255, 0.42);
  border: 2.5px solid var(--frame);
  border-radius: 24px;
  padding: 22px 26px;
  box-shadow: 4px 5px 0 var(--frame);
  max-width: 48ch;
  margin: 32px auto 0;
  text-align: center;
}
.push .label {
  font-size: 12px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 800;
}
.push .title {
  margin-top: 10px;
  font-family: var(--font-hand);
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.4;
}
.push .why {
  margin-top: 8px;
  font-family: var(--font-hand);
  font-size: 16px;
  line-height: 1.65;
  color: var(--text);
}
.list { list-style: none; margin: 0 auto; padding: 0; max-width: 48ch; }
.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 0;
  border-bottom: 2px dashed var(--border);
  text-align: center;
}
.item:first-child { border-top: 2px dashed var(--border); }
.rank {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 22px;
  line-height: 1;
  color: var(--accent);
  text-align: center;
}
.src {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -.02em;
  border: 2px solid var(--frame);
  font-family: var(--font-display);
}
.src svg {
  width: 15px;
  height: 15px;
  display: block;
}
.src svg path {
  fill: #fff;
}
.src.gmail { background: var(--gmail); }
.src.googlecalendar { background: var(--googlecalendar); }
.src.github { background: var(--github); }
.src.linear { background: var(--linear); }
.src.slack { background: var(--slack); }
.item-title {
  font-family: var(--font-hand);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: .1px;
  text-decoration: none;
  color: var(--text);
  line-height: 1.4;
}
a.item-title:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
  text-underline-offset: 3px;
}
.item-why {
  margin-top: 6px;
  font-family: var(--font-hand);
  font-size: 16px;
  line-height: 1.62;
  color: var(--text);
  max-width: 44ch;
}
.meta {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--faint);
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}
.meta .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--faint); }
.actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.btn {
  appearance: none;
  border: 2.5px solid var(--frame);
  background: var(--surface-2);
  color: var(--text);
  border-radius: 999px;
  padding: 8px 18px;
  font-family: var(--font-hand);
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-shadow: 2px 3px 0 var(--frame);
  transition: transform .08s, box-shadow .08s, background .12s;
}
.btn:hover { background: #fff58f; }
.btn:active { transform: translate(2px, 3px); box-shadow: none; }
.btn.primary { background: var(--accent); color: #fff; }
.btn.primary:hover { background: #1a6cb2; }
.btn[disabled] { opacity: .55; cursor: default; box-shadow: none; }
.btn.done { background: var(--ok); color: #fff; }
.draft {
  margin-top: 14px;
  border: 2.5px solid var(--frame);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.7);
  padding: 14px;
  display: none;
  text-align: left;
  box-shadow: 3px 4px 0 var(--frame);
}
.draft.open { display: block; }
.draft textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-hand);
  font-size: 14.5px;
  line-height: 1.6;
  outline: none;
}
.draft .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
.draft .hint { font-size: 12px; color: var(--muted); font-family: var(--font-hand); }
.agenda { list-style: none; margin: 0 auto; padding: 0; max-width: 48ch; }
.slot { padding: 16px 0; border-bottom: 2px dashed var(--border); text-align: center; }
.slot:first-child { border-top: 2px dashed var(--border); }
.slot.past { opacity: .45; }
.slot.now .time { color: var(--accent); }
.time { font-family: var(--font-hand); font-size: 16px; font-weight: 700; color: var(--accent); }
.time small { margin-left: 4px; font-weight: 400; color: var(--muted); font-size: 13px; }
.slot-title { margin-top: 4px; font-family: var(--font-hand); font-weight: 700; font-size: 16.5px; color: var(--text); }
.slot-note {
  margin: 8px auto 0;
  max-width: 42ch;
  font-size: 14px;
  line-height: 1.55;
  background: var(--accent-soft);
  border-radius: 12px;
  padding: 8px 12px;
  color: var(--text);
}
.empty { color: var(--muted); font-size: 15px; padding: 18px 0; border-top: 2px dashed var(--border); }
footer {
  margin-top: 48px;
  padding-top: 22px;
  border-top: 2px dashed var(--border);
  font-size: 12.5px;
  color: var(--muted);
}
.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-bottom: 14px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 2px solid var(--frame);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  font-family: var(--font-hand);
  font-weight: 700;
  color: var(--text);
  background: var(--surface-2);
  box-shadow: 1.5px 2px 0 var(--frame);
}
.chip .state { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
.chip.off .state { background: var(--faint); }
.chip.err .state { background: var(--warn); }
.chip button { all: unset; cursor: pointer; color: var(--accent); font-weight: 800; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%) translateY(20px);
  opacity: 0;
  z-index: 20;
  background: var(--frame);
  color: var(--surface);
  padding: 10px 18px;
  border-radius: 999px;
  font-family: var(--font-hand);
  font-size: 13.5px;
  font-weight: 700;
  transition: opacity .18s, transform .18s;
  pointer-events: none;
  max-width: 90vw;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.center {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 28px 16px;
  background: var(--bg);
  box-sizing: border-box;
}
.panel {
  max-width: 580px;
  width: 100%;
  padding: 44px clamp(20px, 5vw, 40px) 48px;
  background: linear-gradient(180deg, var(--surface-top) 0%, #ebd50e 35%, var(--surface-mid) 70%, var(--surface-bottom) 100%);
  border: 10px solid var(--card-border);
  border-radius: 28px;
  box-shadow: var(--shadow);
  text-align: center;
  box-sizing: border-box;
}
.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid rgba(1, 39, 69, .22);
  border-top-color: var(--accent);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 22px;
  font-family: var(--font-hand);
  font-weight: 700;
  color: var(--text);
  font-size: 16px;
}
.steps { margin-top: 20px; display: grid; gap: 10px; }
.step {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13.5px;
  font-family: var(--font-hand);
}
.step.active { color: var(--accent); font-weight: 700; }
.step.done { color: var(--text); }
.step i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .7; }
.connect-grid { margin-top: 26px; display: grid; gap: 12px; }
.connect {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 2.5px solid var(--frame);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 3px 4px 0 var(--frame);
}
.connect .name {
  flex: 1;
  font-family: var(--font-hand);
  font-weight: 700;
  font-size: 15px;
  text-align: left;
  color: var(--text);
}
.connect .ok {
  color: var(--ok);
  font-size: 13px;
  font-weight: 800;
  font-family: var(--font-hand);
}
@media (max-width: 600px) {
  body { padding: 12px 8px; }
  .page { padding: 36px 18px 44px; border-width: 6px; border-radius: 20px; }
  .brand { font-size: clamp(44px, 15vw, 64px); }
  .panel { padding: 36px 20px 40px; border-width: 6px; border-radius: 20px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
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

function renderItem(item: BriefItem, index: number, ranked: boolean, slot: string): string {
  const href = safeUrl(item.url);
  const title = href
    ? `<a class="item-title" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`
    : `<span class="item-title">${escapeHtml(item.title)}</span>`;
  return `<li class="item">
  <div class="rank">${ranked ? index + 1 : sourceBadge(item.source)}</div>
  <div>
    ${title}
    <div class="item-why">${escapeHtml(item.why)}</div>
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
  <div class="time">${escapeHtml(clock.time)}<small>${escapeHtml(clock.suffix)}</small></div>
  <div>
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
  const month = day.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  const date = `${weekday} ${dayNum}'${month}`;
  const generated = new Date(doc.generatedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const push = doc.push
    ? `<section aria-label="Pipper can move this forward">
  <div class="push">
    <div class="label">Pipper can move this forward</div>
    <div class="title">${escapeHtml(doc.push.title)}</div>
    <div class="why">${escapeHtml(doc.push.why)}</div>
    ${renderMeta(doc.push)}
    ${renderActions(doc.push, "push")}
  </div>
</section>`
    : "";
  const todos = doc.todos.filter((t) => t.id !== doc.push?.id);
  const todosHtml =
    todos.length > 0
      ? `<ol class="list">${todos.map((t, i) => renderItem(t, i + (doc.push ? 1 : 0), true, `todo-${i}`)).join("")}</ol>`
      : `<div class="empty">${doc.push ? "Nothing else is waiting on you." : "Nothing is waiting on you. Enjoy the focus time."}</div>`;
  const contextHtml =
    doc.context.length > 0
      ? `<section><div class="section-title"><h2>Worth knowing</h2><span class="count">${doc.context.length}</span></div>
<ol class="list">${doc.context.map((c, i) => renderItem(c, i, false, `ctx-${i}`)).join("")}</ol></section>`
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
  const body = `<main class="page">
  <header class="masthead">
    <h1 class="brand" aria-label="morning club">
      <span class="line" aria-hidden="true">morn<span class="flower-i"><svg class="flower" viewBox="0 0 25 25" fill="currentColor" aria-hidden="true"><circle cx="12.5" cy="5.5" r="4.6"/><circle cx="19.2" cy="10.4" r="4.6"/><circle cx="16.6" cy="18.2" r="4.6"/><circle cx="8.4" cy="18.2" r="4.6"/><circle cx="5.8" cy="10.4" r="4.6"/><circle cx="12.5" cy="12.5" r="4.8"/></svg><span class="stem">ı</span></span>ng</span>
      <span class="line" aria-hidden="true">club</span>
    </h1>
    <p class="date">${escapeHtml(date)}</p>
  </header>
  <p class="greeting">${escapeHtml(doc.greeting)}.</p>
  <p class="headline">${escapeHtml(doc.headline)}</p>
  <p class="summary">${escapeHtml(doc.summary)}</p>
  ${push}
  <section>
    <div class="section-title"><h2>Needs you</h2><span class="count">${doc.todos.length}</span></div>
    ${todosHtml}
  </section>
  <section>
    <div class="section-title"><h2>Today</h2><span class="count">${doc.agenda.length}</span></div>
    ${renderAgenda(doc.agenda, now)}
  </section>
  ${contextHtml}
  <footer>
    ${renderSourceChips(doc)}
    <div>Generated at ${escapeHtml(generated)} · ${doc.analysis.signalsAnalyzed} items triaged${
      doc.analysis.model ? ` by ${escapeHtml(doc.analysis.model)}` : ""
    } · ${writer}</div>
  </footer>
</main>`;
  return shell(ctx, `Morning Brief — ${date}`, body, CONNECT_SCRIPT).replace(
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
