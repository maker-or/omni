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

const SOURCE_GLYPH: Record<BriefSource, string> = {
  gmail: "M",
  googlecalendar: "31",
  github: "GH",
  linear: "L",
  slack: "#",
};

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf8; --surface: #ffffff; --surface-2: #f4f2ee; --border: rgba(20,18,14,.09);
  --text: #1b1a17; --muted: #6d6a63; --faint: #9a968d; --accent: #3b5bdb; --accent-soft: rgba(59,91,219,.08);
  --warn: #c2410c; --ok: #15803d; --shadow: 0 1px 2px rgba(20,18,14,.04), 0 4px 16px rgba(20,18,14,.04);
  --gmail: #d93025; --googlecalendar: #1a73e8; --github: #24292f; --linear: #5e6ad2; --slack: #611f69;
}
:root[data-theme="dark"] {
  --bg: #141414; --surface: #1b1b1b; --surface-2: #232323; --border: rgba(255,255,255,.08);
  --text: #ececea; --muted: #a3a19b; --faint: #75736e; --accent: #8ea2ff; --accent-soft: rgba(142,162,255,.1);
  --warn: #fb923c; --ok: #4ade80; --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25);
  --github: #d0d7de;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141414; --surface: #1b1b1b; --surface-2: #232323; --border: rgba(255,255,255,.08);
    --text: #ececea; --muted: #a3a19b; --faint: #75736e; --accent: #8ea2ff; --accent-soft: rgba(142,162,255,.1);
    --warn: #fb923c; --ok: #4ade80; --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25);
    --github: #d0d7de;
  }
}
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
}
a { color: inherit; }
.page { max-width: 760px; margin: 0 auto; padding: 56px 32px 72px; }
.eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); font-weight: 600; }
.greeting { margin: 14px 0 0; font-size: 15px; color: var(--muted); }
h1.headline {
  margin: 6px 0 0; font: 600 34px/1.18 ui-serif, "New York", "Iowan Old Style", Georgia, serif;
  letter-spacing: -.015em; text-wrap: balance;
}
.summary { margin: 14px 0 0; font-size: 16px; line-height: 1.6; color: var(--muted); max-width: 62ch; text-wrap: pretty; }
section { margin-top: 44px; }
.section-title { display: flex; align-items: baseline; gap: 10px; margin: 0 0 14px; }
.section-title h2 { margin: 0; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 650; }
.section-title .count { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.push {
  position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 20px 22px; box-shadow: var(--shadow); overflow: hidden;
}
.push::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--accent); }
.push .label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 650; }
.push .title { margin-top: 8px; font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.push .why { margin-top: 6px; color: var(--muted); font-size: 14.5px; }
.list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
.item { display: grid; grid-template-columns: 28px 1fr; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--border); }
.rank { font: 600 13px/28px ui-serif, Georgia, serif; color: var(--faint); text-align: right; font-variant-numeric: tabular-nums; }
.src {
  display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; font-size: 10.5px; font-weight: 700;
  color: #fff; letter-spacing: -.02em; flex: none;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
}
:root[data-theme="dark"] .src.github { color: #111; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .src.github { color: #111; } }
.src.gmail { background: var(--gmail); } .src.googlecalendar { background: var(--googlecalendar); }
.src.github { background: var(--github); } .src.linear { background: var(--linear); } .src.slack { background: var(--slack); }
.item-title { font-size: 15px; font-weight: 600; letter-spacing: -.005em; text-decoration: none; }
a.item-title:hover { text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 3px; }
.item-why { margin-top: 3px; color: var(--muted); }
.meta { margin-top: 6px; font-size: 12px; color: var(--faint); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.meta .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
.actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
.btn {
  appearance: none; border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 9px; padding: 6px 11px; font-family: inherit; font-size: 12.5px; font-weight: 500; line-height: 1.2; cursor: pointer; text-decoration: none;
  display: inline-flex; align-items: center; gap: 6px; transition: background .12s, border-color .12s, transform .06s;
}
.btn:hover { background: var(--surface-2); }
.btn:active { transform: translateY(1px); }
.btn.primary { background: var(--accent); border-color: transparent; color: #fff; }
:root[data-theme="dark"] .btn.primary { color: #0d1020; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .btn.primary { color: #0d1020; } }
.btn.primary:hover { filter: brightness(1.06); background: var(--accent); }
.btn[disabled] { opacity: .55; cursor: default; }
.btn.done { border-color: color-mix(in srgb, var(--ok) 40%, transparent); color: var(--ok); background: transparent; }
.draft {
  margin-top: 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); padding: 10px; display: none;
}
.draft.open { display: block; }
.draft textarea {
  width: 100%; min-height: 96px; resize: vertical; border: 0; background: transparent; color: var(--text);
  font-family: inherit; font-size: 13.5px; line-height: 1.5; outline: none;
}
.draft .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
.draft .hint { font-size: 11.5px; color: var(--faint); }
.agenda { list-style: none; margin: 0; padding: 0; }
.slot { display: grid; grid-template-columns: 76px 1fr; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.slot:first-child { border-top: 1px solid var(--border); }
.slot.past { opacity: .5; }
.slot.now .time { color: var(--accent); }
.time { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--muted); padding-top: 1px; }
.time small { display: block; font-weight: 400; color: var(--faint); font-size: 11.5px; }
.slot-title { font-weight: 600; }
.slot-note { margin-top: 4px; font-size: 13px; color: var(--text); background: var(--accent-soft); border-radius: 8px; padding: 6px 9px; }
.empty { color: var(--faint); font-size: 13.5px; padding: 14px 0; border-top: 1px solid var(--border); }
footer { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--border); font-size: 12px; color: var(--faint); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; font-size: 11.5px; color: var(--muted); background: var(--surface); }
.chip .state { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }
.chip.off .state { background: var(--faint); } .chip.err .state { background: var(--warn); }
.chip button { all: unset; cursor: pointer; color: var(--accent); font-weight: 600; }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(20px); opacity: 0;
  background: var(--text); color: var(--bg); padding: 9px 14px; border-radius: 10px; font-size: 13px;
  transition: opacity .18s, transform .18s; pointer-events: none; max-width: 90vw;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.center { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
.panel { max-width: 520px; width: 100%; }
.spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.progress { display: flex; align-items: center; gap: 12px; margin-top: 22px; color: var(--muted); }
.steps { margin-top: 18px; display: grid; gap: 8px; }
.step { display: flex; gap: 10px; align-items: center; color: var(--faint); font-size: 13px; }
.step.active { color: var(--text); } .step.done { color: var(--muted); }
.step i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .6; }
.connect-grid { margin-top: 24px; display: grid; gap: 10px; }
.connect { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.connect .name { flex: 1; font-weight: 600; }
.connect .ok { color: var(--ok); font-size: 12.5px; font-weight: 600; }
@media (max-width: 560px) {
  .page { padding: 36px 18px 56px; }
  h1.headline { font-size: 27px; }
  .item { grid-template-columns: 1fr; }
  .rank { display: none; }
  .slot { grid-template-columns: 62px 1fr; gap: 10px; }
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

function sourceBadge(source: BriefSource): string {
  return `<span class="src ${source}" title="${escapeHtml(BRIEF_SOURCE_LABELS[source])}" aria-label="${escapeHtml(
    BRIEF_SOURCE_LABELS[source],
  )}">${escapeHtml(SOURCE_GLYPH[source])}</span>`;
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
  const date = new Date(`${doc.date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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
  const writer =
    doc.writer === "anthropic"
      ? "written with Claude"
      : doc.writer === "claude-cli"
        ? "written with Claude Code"
        : "composed by Pipper";
  const body = `<main class="page">
  <div class="eyebrow">Morning Brief · ${escapeHtml(date)}</div>
  <p class="greeting">${escapeHtml(doc.greeting)}.</p>
  <h1 class="headline">${escapeHtml(doc.headline)}</h1>
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
