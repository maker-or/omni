import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  BRIEF_HOST,
  BRIEF_LATEST_URL,
  BRIEF_SOURCE_LABELS,
  BRIEF_SOURCES,
  type BriefAction,
  type BriefConnection,
  type BriefDocument,
  type BriefSettings,
  type BriefSettingsPatch,
  type BriefSettingsView,
  type BriefSignal,
  type BriefSource,
  type BriefSourceReport,
  type BriefStatus,
  type BriefTrigger,
} from "../../contracts/brief.ts";
import { buildReplyActions, REPLY_TOOLS, type ReplyRouter } from "./actions.ts";
import { collectAll, resolveIdentity } from "./collectors.ts";
import {
  buildFocusDigest,
  buildWriterInput,
  builtinFocus,
  composeDocument,
  localDateKey,
} from "./compose.ts";
import { ComposioGateway } from "./composio.ts";
import { triageSignals, type JevClient } from "./jev.ts";
import {
  connectorSvg,
  renderBriefPage,
  renderErrorPage,
  renderProgressPage,
  renderSetupPage,
  type RenderContext,
} from "./render.ts";
import { decideOnLaunch, nextScheduledRun, shouldRunScheduled } from "./schedule.ts";
import { rankSignals, selectForBrief } from "./scoring.ts";
import type { BriefStore } from "./store.ts";
import {
  buildCandidateWriters,
  firstSuccessful,
  type AcpPromptRunner,
  type WriterBackend,
  type WrittenBrief,
} from "./writer.ts";

/**
 * Orchestrates the Morning Brief end to end:
 *
 *   triggers (launch / schedule / wake / new connection)
 *     → Composio collectors → LLM focus profile → Jev triage → code ranking
 *     → LLM writing → Jev-routed reply actions → HTML → embedded browser
 *
 * Invariants:
 * - At most one generation runs at a time (`running` is the single-flight
 *   promise); every trigger while running just waits on it.
 * - Status is the single source of truth for what `pipper-brief://brief/today`
 *   renders; each change bumps `updatedAt`, which the progress/setup pages poll.
 * - Tools that write on the user's behalf only run from `/api/action`, i.e.
 *   an explicit click in the brief page carrying this session's token.
 */

export interface BriefKeys {
  composio: string | null;
  typesafe: string | null;
  anthropic: string | null;
}

export interface BriefServiceDeps {
  store: BriefStore;
  /** Keys from process env / build-time defines (settings overrides win). */
  envKeys: BriefKeys;
  getTheme: () => "light" | "dark" | "system";
  getUser: () => { id: string | null; name: string | null } | null;
  /** Absolute path to a usable `claude` CLI, or null. */
  resolveClaudeBinary: () => string | null;
  /** Agent IDs selected during onboarding. */
  getSelectedAgentIds?: () => string[];
  /** Headless prompt runner for ACP agents. */
  runAcpPrompt?: AcpPromptRunner;
  openExternal: (url: string) => void;
  /**
   * Ask the main window to show the brief in the embedded browser. `activate`
   * switches the workspace to it; otherwise the tab is added quietly.
   */
  openInApp: (url: string, activate: boolean) => boolean;
  /** Ask the main window to start a thread draft with this prompt. */
  startAgentDraft: (prompt: string) => boolean;
  notify: (title: string, body: string, onClick: () => void) => void;
  broadcastStatus: (status: BriefStatus) => void;
  now?: () => Date;
}

const CONNECT_POLL_MS = 4000;
const CONNECT_POLL_LIMIT_MS = 5 * 60 * 1000;
const MAX_TRIAGED_SIGNALS = 60;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Most relevant signals first (recent activity, upcoming starts), bounded for cost. */
export function pickSignalsForTriage(
  signals: BriefSignal[],
  limit = MAX_TRIAGED_SIGNALS,
): BriefSignal[] {
  const events = signals.filter((s) => s.kind === "event");
  const rest = signals
    .filter((s) => s.kind !== "event")
    .sort((a, b) => Date.parse(b.timestamp ?? "0") - Date.parse(a.timestamp ?? "0"));
  return [...events.slice(0, 20), ...rest].slice(0, limit);
}

export class BriefService {
  private status: BriefStatus;
  private running: Promise<BriefDocument | null> | null = null;
  private readonly token = randomBytes(24).toString("hex");
  private gateway: ComposioGateway | null = null;
  private gatewayKey = "";
  private lastConnections: Record<BriefSource, boolean> | null = null;
  private readonly pending = new Set<BriefSource>();
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private replyToolSet: Promise<unknown> | null = null;
  private disposed = false;
  private readonly deps: BriefServiceDeps;

  constructor(deps: BriefServiceDeps) {
    this.deps = deps;
    this.status = {
      phase: "idle",
      message: null,
      latestDate: null,
      url: BRIEF_LATEST_URL,
      error: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  getStatus(): BriefStatus {
    return this.status;
  }

  private setStatus(patch: Partial<BriefStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: new Date().toISOString() };
    this.deps.broadcastStatus(this.status);
  }

  // ── Keys & clients ─────────────────────────────────────────────────────

  private resolveKeys(settings: BriefSettings): BriefKeys {
    return {
      composio: settings.composioApiKey || this.deps.envKeys.composio || null,
      typesafe: settings.typesafeApiKey || this.deps.envKeys.typesafe || null,
      anthropic: settings.anthropicApiKey || this.deps.envKeys.anthropic || null,
    };
  }

  private async getGateway(keys: BriefKeys): Promise<ComposioGateway | null> {
    if (!keys.composio) return null;
    const fingerprint = `${keys.composio}|${keys.typesafe ?? ""}`;
    if (this.gateway && this.gatewayKey === fingerprint) return this.gateway;
    const state = await this.deps.store.readState();
    const userId = await this.deps.store.ensureComposioUserId(this.deps.getUser()?.id ?? null);
    this.gateway = new ComposioGateway({
      apiKey: keys.composio,
      typesafeApiKey: keys.typesafe,
      userId,
      // A session belongs to one project key; drop it when the key changes.
      sessionId:
        this.gatewayKey && this.gatewayKey !== fingerprint ? null : state.composioSessionId,
      onSessionId: (sessionId) => {
        void this.deps.store.updateState({ composioSessionId: sessionId });
      },
    });
    this.gatewayKey = fingerprint;
    this.replyToolSet = null;
    return this.gateway;
  }

  private writers(keys: BriefKeys): WriterBackend[] {
    return buildCandidateWriters({
      selectedAgentIds: this.deps.getSelectedAgentIds?.() ?? [],
      runAcpPrompt: this.deps.runAcpPrompt,
      anthropicApiKey: keys.anthropic,
      claudeBinary: this.deps.resolveClaudeBinary(),
      env: process.env,
    });
  }

  async getSettingsView(): Promise<BriefSettingsView> {
    const settings = await this.deps.store.readSettings();
    const keys = this.resolveKeys(settings);
    return {
      enabled: settings.enabled,
      scheduleTime: settings.scheduleTime,
      openOnLaunch: settings.openOnLaunch,
      hasComposioKey: Boolean(keys.composio),
      hasTypesafeKey: Boolean(keys.typesafe),
      hasWriterKey:
        Boolean(this.deps.runAcpPrompt) ||
        Boolean(keys.anthropic) ||
        Boolean(this.deps.resolveClaudeBinary()),
      composioKeySource: settings.composioApiKey ? "settings" : keys.composio ? "env" : "none",
      typesafeKeySource: settings.typesafeApiKey ? "settings" : keys.typesafe ? "env" : "none",
    };
  }

  async updateSettings(patch: BriefSettingsPatch): Promise<BriefSettingsView> {
    await this.deps.store.updateSettings(patch);
    if (patch.composioApiKey !== undefined || patch.typesafeApiKey !== undefined) {
      this.lastConnections = null;
    }
    this.armSchedule(await this.deps.store.readSettings());
    return this.getSettingsView();
  }

  async getConnections(refresh = true): Promise<BriefConnection[]> {
    const settings = await this.deps.store.readSettings();
    const gateway = await this.getGateway(this.resolveKeys(settings));
    if (gateway && (refresh || !this.lastConnections)) {
      try {
        this.lastConnections = await gateway.connections();
      } catch (error) {
        console.warn("[Brief] Could not read Composio connections:", error);
      }
    }
    return BRIEF_SOURCES.map((source) => ({
      source,
      label: BRIEF_SOURCE_LABELS[source],
      connected: this.lastConnections?.[source] ?? false,
      pending: this.pending.has(source),
    }));
  }

  // ── Triggers ───────────────────────────────────────────────────────────

  /** Called once the main window has painted. */
  async onLaunch(): Promise<void> {
    const settings = await this.deps.store.readSettings();
    this.armSchedule(settings);
    const state = await this.deps.store.readState();
    this.status = { ...this.status, latestDate: state.latestDate };
    const decision = decideOnLaunch(state, this.now(), settings);
    if (decision.open) this.openWhenReady();
    if (decision.generate) void this.generate("launch");
  }

  /** Called on system resume: catch a schedule missed while asleep. */
  async onResume(): Promise<void> {
    const settings = await this.deps.store.readSettings();
    this.armSchedule(settings);
    const state = await this.deps.store.readState();
    if (shouldRunScheduled(state, this.now(), settings)) {
      void this.generate("resume").then((doc) => {
        if (doc) this.announce(doc);
      });
    }
  }

  private armSchedule(settings: BriefSettings): void {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    if (!settings.enabled || this.disposed) return;
    const next = nextScheduledRun(this.now(), settings.scheduleTime);
    // Cap the delay so clock changes / DST shifts are re-evaluated hourly.
    const delay = Math.min(next.getTime() - this.now().getTime(), 60 * 60 * 1000);
    this.scheduleTimer = setTimeout(() => void this.onScheduleTick(), Math.max(1000, delay));
    this.scheduleTimer.unref?.();
  }

  private async onScheduleTick(): Promise<void> {
    const settings = await this.deps.store.readSettings();
    const state = await this.deps.store.readState();
    this.armSchedule(settings);
    if (!shouldRunScheduled(state, this.now(), settings)) return;
    const doc = await this.generate("schedule");
    if (doc) this.announce(doc);
  }

  /**
   * Scheduled/wake runs must not yank the user out of what they're doing:
   * the tab appears quietly and the notification brings it forward.
   */
  private announce(doc: BriefDocument): void {
    this.deps.openInApp(BRIEF_LATEST_URL, false);
    this.deps.notify("Your Morning Brief is ready", doc.headline, () => this.openWhenReady());
  }

  /** Show the brief tab now (it renders progress until the brief is ready). */
  private openWhenReady(): void {
    const shown = this.deps.openInApp(BRIEF_LATEST_URL, true);
    if (shown) void this.deps.store.updateState({ lastShownDate: localDateKey(this.now()) });
  }

  dispose(): void {
    this.disposed = true;
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
  }

  // ── Generation ─────────────────────────────────────────────────────────

  generate(trigger: BriefTrigger): Promise<BriefDocument | null> {
    if (this.running) return this.running;
    // Flip status synchronously so any page polling right now sees progress.
    this.setStatus({ phase: "collecting", message: "Starting…", error: null });
    this.running = this.runGeneration(trigger)
      .catch((error) => {
        console.error("[Brief] Generation failed:", error);
        this.setStatus({ phase: "error", message: null, error: message(error) });
        return null;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async runGeneration(trigger: BriefTrigger): Promise<BriefDocument | null> {
    const settings = await this.deps.store.readSettings();
    const keys = this.resolveKeys(settings);
    const gateway = await this.getGateway(keys);
    if (!gateway) {
      this.setStatus({ phase: "needs-setup", message: null, error: "Missing Composio API key." });
      return null;
    }
    this.setStatus({ phase: "collecting", message: "Checking your connected tools…", error: null });
    const connected = await gateway.connections();
    this.lastConnections = connected;
    if (!BRIEF_SOURCES.some((s) => connected[s])) {
      this.setStatus({ phase: "needs-setup", message: null, error: null });
      return null;
    }

    const now = this.now();
    this.setStatus({ message: "Reading your inbox, calendar, reviews, tickets and Slack…" });
    const identity = await resolveIdentity(gateway, connected);
    const results = await collectAll({ now, runner: gateway, identity }, connected);
    const signals = results.flatMap((r) => r.signals);
    const sources: BriefSourceReport[] = BRIEF_SOURCES.map((source) => {
      const result = results.find((r) => r.source === source);
      return {
        source,
        connected: connected[source],
        itemCount: result?.signals.length ?? 0,
        error: result?.error ?? null,
      };
    });
    const failed = sources.filter((s) => s.connected && s.error);
    if (failed.length > 0 && failed.length === sources.filter((s) => s.connected).length) {
      throw new Error(
        `Could not read from ${failed.map((s) => BRIEF_SOURCE_LABELS[s.source]).join(", ")}: ${failed[0]!.error}`,
      );
    }

    // LLM reasons about the person first; that profile guides Jev.
    this.setStatus({ phase: "analyzing", message: "Working out what matters to you…" });
    const writers = this.writers(keys);
    const user = this.deps.getUser();
    const focusResult = writers.length
      ? await firstSuccessful(writers, (w) => w.focus(buildFocusDigest(signals, identity)))
      : null;
    const focus = focusResult?.value.focus ?? builtinFocus(signals);

    const toTriage = pickSignalsForTriage(signals);
    let analysisModel: string | null = null;
    let triages = new Map();
    if (keys.typesafe && toTriage.length > 0) {
      const client = new TypeSafeClient({ apiKey: keys.typesafe, timeout: 20_000 });
      const output = await triageSignals(client as unknown as JevClient, {
        signals: toTriage,
        identity,
        focus,
        now,
        onProgress: (done, total) => {
          if (done === total || done % 5 === 0) {
            this.setStatus({ message: `Jev triaged ${done} of ${total} items…` });
          }
        },
      });
      triages = output.triages;
      analysisModel = output.model;
    }
    const ranked = rankSignals(toTriage, triages, now);
    const selection = selectForBrief(ranked);

    this.setStatus({ phase: "writing", message: "Writing your brief…" });
    let written: WrittenBrief | null = null;
    let writerName = "builtin";
    if (
      writers.length &&
      (selection.todos.length || selection.context.length || selection.events.length)
    ) {
      const writerInput = buildWriterInput({
        selection,
        identity,
        userName: user?.name ?? identity.linearName,
        focus,
        now,
      });
      const result = await firstSuccessful(writers, (w) => w.write(writerInput));
      if (result) {
        written = result.value;
        writerName = result.backend;
      }
    }

    const drafts = new Map<string, string>();
    for (const item of written?.items ?? []) {
      if (item.reply_draft) drafts.set(item.id, item.reply_draft);
    }
    const replyActions = await buildReplyActions(
      [...selection.todos, ...selection.context],
      drafts,
      keys.typesafe ? this.replyRouter(gateway) : null,
    );

    this.setStatus({ phase: "rendering", message: "Laying it out…" });
    const doc = composeDocument({
      now,
      trigger,
      userName: user?.name ?? identity.linearName ?? identity.email,
      selection,
      written,
      writerName,
      analysisModel,
      signalsAnalyzed: toTriage.length,
      sources,
      replyActions,
    });
    await this.deps.store.saveBrief(doc);
    this.setStatus({ phase: "ready", message: null, error: null, latestDate: doc.date });
    return doc;
  }

  /** Jev routing over the reply toolset via `@composio/typesafe`. */
  private replyRouter(gateway: ComposioGateway): ReplyRouter {
    return {
      route: async (request) => {
        this.replyToolSet ??= gateway.client.tools
          .get(gateway.userId, { tools: Object.values(REPLY_TOOLS) as string[] })
          .catch((error) => {
            this.replyToolSet = null;
            throw error;
          });
        const toolSet = (await this.replyToolSet) as Parameters<typeof gateway.provider.decide>[0];
        const decision = await gateway.provider.decide(toolSet, request);
        if (decision.kind === "abstain") return null;
        return { tool: decision.tool, risk: decision.risk };
      },
    };
  }

  // ── Actions from the brief page ────────────────────────────────────────

  /** Actions resolve against the brief the page was rendered from (not only the latest). */
  private async findAction(id: string, date?: unknown): Promise<BriefAction | null> {
    const doc =
      (typeof date === "string" ? await this.deps.store.loadBrief(date) : null) ??
      (await this.deps.store.loadLatest());
    if (!doc) return null;
    const items = [...doc.todos, ...doc.context, ...(doc.push ? [doc.push] : [])];
    for (const item of items) {
      const action = item.actions.find((a) => a.id === id);
      if (action) return action;
    }
    return null;
  }

  async runAction(
    id: string,
    text: unknown,
    date?: unknown,
  ): Promise<{ label: string; message: string }> {
    const action = await this.findAction(id, date);
    if (!action) throw new Error("This action is no longer available. Refresh the brief.");
    if (action.kind === "link") {
      this.deps.openExternal(action.url);
      return { label: "Opened", message: "Opened in your browser." };
    }
    if (action.kind === "agent") {
      if (!this.deps.startAgentDraft(action.prompt)) {
        throw new Error("Pipper's main window isn't available.");
      }
      return {
        label: "Opened in Pipper",
        message: "Draft ready in a new thread — review and send.",
      };
    }
    const settings = await this.deps.store.readSettings();
    const gateway = await this.getGateway(this.resolveKeys(settings));
    if (!gateway) throw new Error("Composio isn't configured.");
    const body = typeof text === "string" && text.trim() ? text.trim() : action.preview;
    const args = { ...action.arguments };
    if ("markdown_text" in args) args.markdown_text = body;
    else args.body = body;
    await gateway.execute(action.tool, args);
    const drafted = action.tool.includes("DRAFT");
    return {
      label: drafted ? "Draft saved" : "Sent",
      message: drafted ? "Saved to your Gmail drafts." : "Posted.",
    };
  }

  async connect(source: unknown): Promise<void> {
    if (typeof source !== "string" || !(BRIEF_SOURCES as readonly string[]).includes(source)) {
      throw new Error("Unknown source.");
    }
    const brief = source as BriefSource;
    const settings = await this.deps.store.readSettings();
    const gateway = await this.getGateway(this.resolveKeys(settings));
    if (!gateway) throw new Error("Add a Composio API key in Settings first.");
    const url = await gateway.authorize(brief);
    this.deps.openExternal(url);
    this.pending.add(brief);
    this.setStatus({});
    const started = Date.now();
    const poll = async () => {
      if (this.disposed) return;
      try {
        const connected = await gateway.connections();
        this.lastConnections = connected;
        if (connected[brief]) {
          this.pending.delete(brief);
          this.setStatus({});
          void this.generate("connection");
          return;
        }
      } catch (error) {
        console.warn("[Brief] Connection poll failed:", error);
      }
      if (Date.now() - started < CONNECT_POLL_LIMIT_MS) setTimeout(poll, CONNECT_POLL_MS);
      else {
        this.pending.delete(brief);
        this.setStatus({});
      }
    };
    setTimeout(poll, CONNECT_POLL_MS);
  }

  // ── pipper-brief:// protocol ───────────────────────────────────────────

  private renderContext(): RenderContext {
    return { token: this.token, theme: this.deps.getTheme() };
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.host !== BRIEF_HOST) return new Response("Not found", { status: 404 });
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path.startsWith("/api/")) return this.handleApi(path.slice(5), request);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (path.startsWith("/svg/")) {
      const rawName = path
        .slice(5)
        .replace(/\.svg$/, "")
        .toLowerCase();
      const candidates = [
        rawName,
        rawName === "googlecalendar" ? "calendar" : "",
        rawName === "calendar" ? "calender" : "",
        rawName === "calender" ? "calendar" : "",
      ].filter(Boolean);

      for (const candidate of candidates) {
        try {
          const filePath = fileURLToPath(new URL(`./svg/${candidate}.svg`, import.meta.url));
          if (existsSync(filePath)) {
            const content = readFileSync(filePath, "utf8");
            return new Response(content, {
              status: 200,
              headers: {
                "Content-Type": "image/svg+xml; charset=utf-8",
                "Cache-Control": "public, max-age=86400",
              },
            });
          }
        } catch {
          // Fall through to in-memory connectorSvg
        }
      }
      const svg = connectorSvg(rawName);
      if (svg) {
        return new Response(svg.replace(/currentColor/g, "#1B1F23"), {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    }
    if (path === "/" || path === "/today") return html(await this.renderToday());
    const dated = /^\/(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (dated) {
      const doc = await this.deps.store.loadBrief(dated[1]!);
      if (doc) return html(renderBriefPage(doc, this.renderContext(), this.now()));
    }
    return new Response("Not found", { status: 404 });
  }

  private async renderToday(): Promise<string> {
    const ctx = this.renderContext();
    const status = this.status;
    if (this.running) return renderProgressPage(status, ctx);
    const settings = await this.deps.store.readSettings();
    const keys = this.resolveKeys(settings);
    const setup = async () =>
      renderSetupPage(
        await this.getConnections(true),
        status,
        ctx,
        keys.composio ? [] : ["a Composio API key"],
      );
    if (status.phase === "needs-setup" || !keys.composio) return setup();
    // A failed refresh keeps showing the last good brief rather than an error.
    const latest = await this.deps.store.loadLatest();
    if (latest) return renderBriefPage(latest, ctx, this.now());
    if (status.phase === "error") return renderErrorPage(status, ctx);
    return setup();
  }

  private async handleApi(route: string, request: Request): Promise<Response> {
    if (request.headers.get("x-brief-token") !== this.token) {
      return json({ ok: false, message: "Forbidden" }, 403);
    }
    try {
      if (route === "status" && request.method === "GET") {
        return json({ ok: true, ...this.status, running: Boolean(this.running) });
      }
      if (request.method !== "POST") return json({ ok: false, message: "Method not allowed" }, 405);
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      switch (route) {
        case "action": {
          const result = await this.runAction(String(body.id ?? ""), body.text, body.date);
          return json({ ok: true, ...result });
        }
        case "connect":
          await this.connect(body.source);
          return json({ ok: true });
        case "refresh":
          void this.generate("refresh");
          return json({ ok: true });
        default:
          return json({ ok: false, message: "Not found" }, 404);
      }
    } catch (error) {
      return json({ ok: false, message: message(error) }, 400);
    }
  }
}
