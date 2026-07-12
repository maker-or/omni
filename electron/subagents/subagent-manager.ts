import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentCapabilities, ContentBlock } from "@agentclientprotocol/sdk";
import type {
  AcpAgentDescriptor,
  AcpBridgeEvent,
  SubagentConfig,
  SubagentRunSnapshot,
  SubagentRunStatus,
} from "../../contracts/acp.ts";
import {
  applySessionUpdate,
  applyTurnStop,
  createEmptySessionSlice,
  type AcpSessionSlice,
} from "../../src/lib/acp-session-reducer.ts";
import { listRegisteredAgents } from "../agents/registry.ts";
import {
  readSubagentConfig,
  writeSubagentConfig,
  DEFAULT_SUBAGENT_CONFIG,
} from "./subagent-config.ts";
import {
  McpHttpServer,
  type McpEndpoint,
  type McpToolDefinition,
  type McpToolResult,
} from "./mcp-http-server.ts";
import { ensureStdioProxyScript } from "./stdio-proxy.ts";

/** The slice of a live ACP connection a subagent run needs. */
export interface SubagentConnection {
  agentId: string;
  agentCapabilities: AgentCapabilities;
  agent: {
    request: (method: any, params?: any) => Promise<any>;
    notify: (method: any, params?: any) => Promise<void>;
  };
}

/**
 * What the connection manager provides to subagent runs. Kept as a small
 * delegate so this module never imports the (much larger) connection manager
 * and tests can drive runs with a fake agent.
 */
export interface SubagentHost {
  /** Get or spawn a live connection for an agent without switching the UI's active agent. */
  acquireConnection(agentId: string): Promise<SubagentConnection>;
  /** The user's regular MCP servers, so subagents get the same tools as top-level sessions. */
  baseMcpServers(caps: AgentCapabilities): Array<Record<string, unknown>>;
  emitEvent(event: AcpBridgeEvent): void;
}

export interface SubagentManagerOptions {
  host: SubagentHost;
  /** Override the agent catalog in tests. */
  listAgents?: () => AcpAgentDescriptor[];
  /** Override the userData directory in tests. */
  baseDir?: string;
}

interface TokenContext {
  sessionId: string | null;
  cwd: string;
  depth: number;
}

interface RunState {
  runId: string;
  parentToken: string;
  agentId: string;
  task: string;
  status: SubagentRunStatus;
  depth: number;
  sessionId: string | null;
  slice: AcpSessionSlice;
  startedAt: number;
  finishedAt: number | null;
  resultPreview: string | null;
  timedOut: boolean;
  cancelled: boolean;
  connection: SubagentConnection | null;
}

const SUBAGENT_PREAMBLE =
  "You are running as a subagent spawned by an orchestrator agent. Work autonomously: " +
  "do not ask clarifying questions — make reasonable assumptions and state them. " +
  "Your final message is the only thing returned to the orchestrator, so end with a " +
  "self-contained report of what you did, found, or changed (including file paths).";

const FINISHED_RUNS_KEPT = 50;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export class SubagentManager {
  private readonly host: SubagentHost;
  private readonly listAgents: () => AcpAgentDescriptor[];
  private readonly baseDir: string | undefined;
  private config: SubagentConfig = { ...DEFAULT_SUBAGENT_CONFIG };
  private readonly server = new McpHttpServer();
  private started: Promise<string> | null = null;
  private readonly tokens = new Map<string, TokenContext>();
  private readonly runs = new Map<string, RunState>();
  private readonly runsBySession = new Map<string, RunState>();
  private activeRuns = 0;
  private readonly slotWaiters: Array<() => void> = [];
  private disposed = false;

  constructor(options: SubagentManagerOptions) {
    this.host = options.host;
    this.listAgents = options.listAgents ?? listRegisteredAgents;
    this.baseDir = options.baseDir;
  }

  async init(): Promise<void> {
    this.config = await readSubagentConfig(this.baseDir);
  }

  getConfig(): SubagentConfig {
    return { ...this.config };
  }

  async setConfig(partial: Partial<SubagentConfig>): Promise<SubagentConfig> {
    this.config = await writeSubagentConfig(partial, this.baseDir);
    return this.getConfig();
  }

  getRunSnapshots(): SubagentRunSnapshot[] {
    return [...this.runs.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((run) => ({
        runId: run.runId,
        parentSessionId: this.tokens.get(run.parentToken)?.sessionId ?? null,
        sessionId: run.sessionId,
        agentId: run.agentId,
        task: truncate(run.task, 200),
        status: run.status,
        depth: run.depth,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        resultPreview: run.resultPreview,
      }));
  }

  /** Agents the user allows as subagents (installed, non-mock unless opted in). */
  availableSubagents(): AcpAgentDescriptor[] {
    const allowed = this.config.allowedAgents;
    return this.listAgents().filter((agent) => {
      if (agent.available === false) return false;
      if (allowed === "all") return agent.installKind !== "mock";
      return allowed.includes(agent.id);
    });
  }

  /**
   * Append the subagent MCP server to a session's server list, minting a
   * per-session endpoint token. Callers must bindSession() the token to the
   * ACP session id once session/new (or load/resume) returns, so tool calls
   * from that session are attributable.
   */
  async attachMcpServers(
    baseServers: Array<Record<string, unknown>>,
    caps: AgentCapabilities,
    context: { cwd: string; depth: number },
  ): Promise<{ servers: Array<Record<string, unknown>>; token: string | null }> {
    if (
      this.disposed ||
      !this.config.enabled ||
      context.depth >= this.config.maxDepth ||
      this.availableSubagents().length === 0
    ) {
      return { servers: baseServers, token: null };
    }

    const shimPath = await this.ensureStarted();
    const token = randomUUID();
    this.tokens.set(token, { sessionId: null, cwd: context.cwd, depth: context.depth });
    this.server.register(token, this.endpointFor(token));

    const url = this.server.urlFor(token);
    const entry: Record<string, unknown> = caps.mcpCapabilities?.http
      ? // `headers` is a required array in the ACP HttpMcpServer schema
        // (opencode rejects the session with -32602 if it's absent).
        { type: "http", name: "pipper-subagents", url, headers: [] }
      : {
          type: "stdio",
          name: "pipper-subagents",
          command: process.execPath,
          args: [shimPath, url],
          env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
        };
    return { servers: [...baseServers, entry], token };
  }

  bindSession(token: string, sessionId: string): void {
    const context = this.tokens.get(token);
    if (context) context.sessionId = sessionId;
  }

  /** True when the session belongs to a subagent run (vs a user-facing thread). */
  ownsSession(sessionId: string): boolean {
    return this.runsBySession.has(sessionId);
  }

  /** Route a session/update into the owning run's slice. False if not ours. */
  handleSessionUpdate(sessionId: string, update: acp.SessionUpdate): boolean {
    const run = this.runsBySession.get(sessionId);
    if (!run) return false;
    run.slice = applySessionUpdate(run.slice, update);
    return true;
  }

  /**
   * Auto-approve permission requests from headless subagent sessions (they
   * have no UI surface to answer on). Null means "not ours — ask the user".
   */
  autoPermissionResponse(
    params: acp.RequestPermissionRequest,
  ): acp.RequestPermissionResponse | null {
    if (!this.ownsSession(params.sessionId)) return null;
    if (!this.config.autoApprovePermissions) return null;
    const options = params.options ?? [];
    const allow = options.find((o) => o.kind === "allow_once") ?? options[0];
    if (!allow) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: allow.optionId } };
  }

  /** Cancel every queued/running run spawned by the given orchestrator session. */
  cancelRunsForParent(parentSessionId: string): void {
    for (const run of this.runs.values()) {
      if (run.status !== "queued" && run.status !== "running") continue;
      if (this.tokens.get(run.parentToken)?.sessionId !== parentSessionId) continue;
      void this.cancelRun(run);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const run of this.runs.values()) {
      if (run.status === "queued" || run.status === "running") void this.cancelRun(run);
    }
    this.server.close();
    this.started = null;
  }

  private async cancelRun(run: RunState): Promise<void> {
    run.cancelled = true;
    if (run.connection && run.sessionId) {
      try {
        await run.connection.agent.notify(acp.methods.agent.session.cancel, {
          sessionId: run.sessionId,
        });
      } catch {
        // connection may already be gone
      }
    }
  }

  /** Start the HTTP server and materialize the stdio shim once, lazily. */
  private ensureStarted(): Promise<string> {
    if (!this.started) {
      this.started = (async () => {
        await this.server.start();
        const shimPath = join(this.baseDir ?? app.getPath("userData"), "subagent-stdio-proxy.mjs");
        return ensureStdioProxyScript(shimPath);
      })();
      this.started.catch(() => {
        this.started = null;
      });
    }
    return this.started;
  }

  private endpointFor(token: string): McpEndpoint {
    return {
      listTools: () => this.toolDefinitions(),
      callTool: (name, args) => this.callTool(token, name, args),
    };
  }

  private toolDefinitions(): McpToolDefinition[] {
    const agents = this.availableSubagents();
    const catalog = agents
      .map((a) => `- ${a.id} (${a.displayName})${a.description ? `: ${a.description}` : ""}`)
      .join("\n");
    return [
      {
        name: "list_subagents",
        description:
          "List the coding agents available to spawn as subagents, with their ids and descriptions.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "spawn_subagent",
        description:
          "Delegate a task to another coding agent running in its own isolated session, and get its " +
          "final report back. The subagent shares NO context with you — include every needed detail " +
          "(background, file paths, constraints, expected output) in the task. Call this tool multiple " +
          "times, including in parallel, to fan work out across agents.\n\nAvailable agents:\n" +
          catalog,
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "Which agent to spawn.",
              enum: agents.map((a) => a.id),
            },
            task: {
              type: "string",
              description:
                "Complete, self-contained task description. The subagent sees nothing else.",
            },
            context: {
              type: "string",
              description: "Optional extra background (findings so far, relevant snippets).",
            },
            cwd: {
              type: "string",
              description: "Optional working directory override; defaults to your own.",
            },
          },
          required: ["agent_id", "task"],
          additionalProperties: false,
        },
      },
    ];
  }

  private async callTool(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    if (name === "list_subagents") {
      const agents = this.availableSubagents().map((a) => ({
        id: a.id,
        name: a.displayName,
        description: a.description ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    }
    if (name === "spawn_subagent") {
      const text = await this.runSubagent(token, args);
      return { content: [{ type: "text", text }] };
    }
    throw new Error(`unknown tool: ${name}`);
  }

  private async runSubagent(token: string, args: Record<string, unknown>): Promise<string> {
    const parent = this.tokens.get(token);
    if (!parent) throw new Error("unknown orchestrator session");
    if (parent.depth + 1 > this.config.maxDepth) {
      throw new Error(`subagent depth limit reached (maxDepth=${this.config.maxDepth})`);
    }
    const agentId = typeof args.agent_id === "string" ? args.agent_id : "";
    const task = typeof args.task === "string" ? args.task.trim() : "";
    if (!task) throw new Error("spawn_subagent requires a non-empty task");
    const descriptor = this.availableSubagents().find((a) => a.id === agentId);
    if (!descriptor) {
      const ids = this.availableSubagents()
        .map((a) => a.id)
        .join(", ");
      throw new Error(`unknown or disallowed agent_id "${agentId}". Available: ${ids}`);
    }

    const run: RunState = {
      runId: randomUUID(),
      parentToken: token,
      agentId: descriptor.id,
      task,
      status: "queued",
      depth: parent.depth + 1,
      sessionId: null,
      slice: createEmptySessionSlice(),
      startedAt: Date.now(),
      finishedAt: null,
      resultPreview: null,
      timedOut: false,
      cancelled: false,
      connection: null,
    };
    this.runs.set(run.runId, run);
    this.emitRuns();

    await this.acquireSlot();
    try {
      if (run.cancelled || this.disposed) throw new Error("subagent run was cancelled");
      run.status = "running";
      this.emitRuns();

      const connection = await this.host.acquireConnection(descriptor.id);
      run.connection = connection;

      const cwd = typeof args.cwd === "string" && args.cwd ? args.cwd : parent.cwd;
      const attached = await this.attachMcpServers(
        this.host.baseMcpServers(connection.agentCapabilities),
        connection.agentCapabilities,
        { cwd, depth: run.depth },
      );
      const created = (await connection.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: attached.servers as never,
      })) as { sessionId: string };
      run.sessionId = created.sessionId;
      this.runsBySession.set(created.sessionId, run);
      if (attached.token) this.bindSession(attached.token, created.sessionId);

      const context = typeof args.context === "string" && args.context ? args.context : null;
      const promptText =
        `${SUBAGENT_PREAMBLE}\n\n<task>\n${task}\n</task>` +
        (context ? `\n\n<context>\n${context}\n</context>` : "");
      const prompt: ContentBlock[] = [{ type: "text", text: promptText }];

      const timeout = setTimeout(() => {
        run.timedOut = true;
        void this.cancelRun(run);
      }, this.config.runTimeoutMs);
      try {
        await connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt,
        });
      } finally {
        clearTimeout(timeout);
      }

      run.slice = applyTurnStop(run.slice);
      const text = run.slice.entries
        .filter((entry) => entry.type === "agent_text")
        .map((entry) => entry.text)
        .join("\n\n")
        .trim();

      if (run.cancelled && !run.timedOut) throw new Error("subagent run was cancelled");

      run.status = run.timedOut ? "cancelled" : "finished";
      run.resultPreview = text ? truncate(text, 300) : null;
      const timeoutNote = run.timedOut
        ? `\n\n[NOTE: the run hit the ${Math.round(this.config.runTimeoutMs / 60_000)}-minute timeout and was cancelled; output may be incomplete.]`
        : "";
      return (text || "(the subagent finished without a final text message)") + timeoutNote;
    } catch (err) {
      run.status = run.cancelled && !run.timedOut ? "cancelled" : "failed";
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      run.finishedAt = Date.now();
      if (run.connection && run.sessionId) {
        run.connection.agent
          .request(acp.methods.agent.session.close, { sessionId: run.sessionId })
          .catch(() => {});
        this.runsBySession.delete(run.sessionId);
      }
      this.releaseSlot();
      this.pruneFinishedRuns();
      this.emitRuns();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.activeRuns < this.config.maxConcurrent) {
      this.activeRuns++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.slotWaiters.push(() => {
        this.activeRuns++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeRuns--;
    this.slotWaiters.shift()?.();
  }

  private pruneFinishedRuns(): void {
    const finished = [...this.runs.values()]
      .filter((r) => r.status !== "queued" && r.status !== "running")
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    while (finished.length > FINISHED_RUNS_KEPT) {
      const oldest = finished.shift()!;
      this.runs.delete(oldest.runId);
    }
  }

  private emitRuns(): void {
    this.host.emitEvent({ type: "subagent-runs", runs: this.getRunSnapshots() });
  }
}
