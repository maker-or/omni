import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentCapabilities, AuthMethod } from "@agentclientprotocol/sdk";
import type {
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorSessionCacheEvent,
  MonitorSwitchRecord,
} from "../contracts/monitor.ts";
import type { AcpAgentDescriptor } from "../contracts/acp.ts";
import { resolveAgentSpawn } from "./agents/registry.ts";
import type { TerminalManager } from "./terminal-manager.ts";

const configuredSwitchTimeout = Number(process.env.PIPPER_ACP_SWITCH_TIMEOUT_MS);
export const ACP_SWITCH_PHASE_TIMEOUT_MS =
  Number.isFinite(configuredSwitchTimeout) && configuredSwitchTimeout >= 1_000
    ? configuredSwitchTimeout
    : 10_000;

/** npx agents may need to download on first launch — allow up to 2 minutes for initialize. */
const ACP_NPX_INIT_TIMEOUT_MS = 120_000;

export interface AgentMonitorObserver {
  onConnectionSpawned: (input: {
    connectionId: string;
    agentId: string;
    pid: number;
    spawnedAt: number;
    previousConnectionId: string | null;
  }) => void;
  onConnectionReady?: (input: { connectionId: string; initializedAt: number }) => void;
  onConnectionClosed?: (input: {
    connectionId: string;
    agentId: string;
    pid: number | null;
    activeThreadId: string | null;
    runningThreadIds: string[];
    spawnedAt: number;
    intentional: boolean;
    stderrTail: string;
    sessionCountAtTermination?: number;
    invalidatedThreadIds?: string[];
  }) => void;
  onConnectionExit: (input: {
    connectionId: string;
    agentId: string;
    pid: number | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    activeThreadId: string | null;
    runningThreadIds: string[];
    spawnedAt: number;
    intentional: boolean;
    stderrTail: string;
    sessionCountAtTermination?: number;
    invalidatedThreadIds?: string[];
  }) => void;
  /** Fired once per thread activation with the resolved cache phase. */
  onSwitchRecord?: (record: MonitorSwitchRecord) => void;
  onSessionCacheEvent?: (event: MonitorSessionCacheEvent) => void;
  onAcpUpdate?: (update: MonitorAcpUpdate) => void;
  onBridgeEvent?: (event: MonitorBridgeEvent) => void;
}

export function requestWithTimeout<T>(
  request: Promise<T>,
  timeoutMs: number,
  phase: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${phase} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function terminateChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    timeout.unref?.();
  });
  await Promise.race([exited, timer]);
  if (child.exitCode == null && child.signalCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // best effort
    }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        timeout.unref?.();
      }),
    ]);
  }
}

export interface LiveConnection {
  connectionId: string;
  agentId: string;
  agentInfoName: string;
  process: ChildProcessWithoutNullStreams;
  connection: acp.ClientConnection;
  agent: acp.ClientContext;
  agentCapabilities: AgentCapabilities;
  authMethods: AuthMethod[];
  /**
   * Set only when the agent actually rejects `session/new` with an
   * `auth_required` error — i.e. the user is genuinely not signed in. This is
   * distinct from `authMethods`, which merely advertises the auth flows the
   * agent *supports* and is present even for signed-in users, so it must never
   * be used to decide whether authentication is required.
   */
  authRequiredMessage: string | null;
  /**
   * Non-standard model catalog some agents (e.g. Grok) advertise in the
   * initialize result's `_meta.modelState` instead of via session config
   * options. When present we synthesize a "model" config option from it and
   * route model switches through the custom `session/set_model` method.
   */
  modelState?: {
    currentModelId?: string | null;
    availableModels?: Array<{ modelId: string; name: string }>;
  } | null;
  closed: Promise<void>;
}

/** Client capabilities the manager hosts for every spawned agent process. */
export interface ConnectionClientHooks {
  onSessionUpdate(sessionId: string, update: acp.SessionUpdate): Promise<void>;
  onRequestPermission(
    params: acp.RequestPermissionRequest,
    requestId: string | number | null,
  ): Promise<acp.RequestPermissionResponse>;
  onReadTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse>;
  onWriteTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse>;
  /** Containment check for a terminal's starting cwd (see docs/worktree.md). */
  assertWithinWorkspace(sessionId: string | undefined, targetPath: string): void;
}

/** Diagnostics + teardown callbacks the spawn/exit reporters need. */
export interface ConnectionLifecycleDeps {
  terminal: TerminalManager;
  /**
   * App version advertised to agents in the initialize `clientInfo`. Sourced
   * from package.json (via `app.getVersion()`) so it can never drift from the
   * release version.
   */
  clientVersion: string;
  hooks: ConnectionClientHooks;
  getMonitorObserver(): AgentMonitorObserver | null;
  getActiveThreadId(): string | null;
  getRunningThreadIds(): string[];
  getSessionsByAgent(agentId: string): Array<{ threadId: string; agentSessionId: string }>;
  /** Drop cached sessions whose agent process died or transport closed. */
  invalidateAgentSessions(agentId: string): void;
  /** Analytics fire for first-time spawns only (deduped callers stay silent). */
  onConnected?(agentId: string, connectDurationMs: number, installKind?: string): void;
  onConnectFailed?(agentId: string, errorName?: string): void;
}

/**
 * Owns ACP transports: one live agent process per agent id, spawn dedup, the
 * active UI pointer, and the incident reporting around process exits and
 * transport closes. Session/thread concerns stay in AgentConnectionManager.
 */
export class ConnectionLifecycle {
  private readonly deps: ConnectionLifecycleDeps;
  /** The connection backing the composer/UI agent. */
  private activeConnection: LiveConnection | null = null;
  /**
   * Keep one live ACP transport per agent. ACP sessions belong to the agent
   * process that created them, so tearing this down on every cross-agent
   * thread switch made switching require a new process plus session restore.
   */
  private readonly connections = new Map<string, LiveConnection>();
  /** In-flight spawn per agentId, so concurrent callers share one spawn instead of racing. */
  private readonly spawning = new Map<string, Promise<LiveConnection>>();
  private readonly intentionalConnectionIds = new Set<string>();
  private readonly lastConnectionIds = new Map<string, string>();
  private readonly connectionSpawnedAt = new Map<string, number>();

  constructor(deps: ConnectionLifecycleDeps) {
    this.deps = deps;
  }

  get active(): LiveConnection | null {
    return this.activeConnection;
  }

  setActive(live: LiveConnection | null): void {
    this.activeConnection = live;
  }

  getCached(agentId: string): LiveConnection | undefined {
    return this.connections.get(agentId);
  }

  /** All live connections, e.g. for model catalogs or process listings. */
  all(): LiveConnection[] {
    return [...this.connections.values()];
  }

  /** The session's owning connection: the active one, else the cached one. */
  connectionFor(agentId: string): LiveConnection | null {
    if (this.activeConnection?.agentId === agentId) return this.activeConnection;
    return this.connections.get(agentId) ?? null;
  }

  async acquire(descriptor: AcpAgentDescriptor): Promise<LiveConnection> {
    const cached = this.connections.get(descriptor.id);
    if (cached) return cached;
    let pending = this.spawning.get(descriptor.id);
    const isNewSpawn = !pending;
    const spawnStartedAt = Date.now();
    if (!pending) {
      pending = this.spawnAndInitialize(descriptor).finally(() =>
        this.spawning.delete(descriptor.id),
      );
      this.spawning.set(descriptor.id, pending);
    }
    try {
      const live = await pending;
      this.connections.set(descriptor.id, live);
      if (isNewSpawn) {
        this.deps.onConnected?.(descriptor.id, Date.now() - spawnStartedAt, descriptor.installKind);
      }
      return live;
    } catch (err) {
      if (isNewSpawn) {
        this.deps.onConnectFailed?.(descriptor.id, err instanceof Error ? err.name : undefined);
      }
      throw err;
    }
  }

  /** Mark every live connection intentional and tear the processes down. */
  async terminateAll(): Promise<void> {
    const liveConnections = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(
      liveConnections.map(async (live) => {
        this.intentionalConnectionIds.add(live.connectionId);
        try {
          live.connection.close();
        } catch {
          // ignore
        }
        await terminateChildProcess(live.process);
      }),
    );
  }

  private async spawnAndInitialize(descriptor: AcpAgentDescriptor): Promise<LiveConnection> {
    const { command, args, env } = resolveAgentSpawn(descriptor);
    const useShell = process.platform === "win32" && /\.cmd$/i.test(command);
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      ...(useShell && { shell: true }),
    }) as ChildProcessWithoutNullStreams;

    const connectionId = randomUUID();
    const spawnedAt = Date.now();
    const previousConnectionId = this.lastConnectionIds.get(descriptor.id) ?? null;
    let stderrTail = "";
    const appendStderr = (buf: Buffer): void => {
      const text = buf.toString("utf8");
      stderrTail = `${stderrTail}${text}`.slice(-16_384);
    };

    child.stderr.on("data", (buf: Buffer) => {
      appendStderr(buf);
      const text = buf.toString("utf8").trim();
      if (text) console.error(`[acp-agent:${descriptor.id}]`, text);
    });

    // Register the lifecycle before the handshake. A process that dies or
    // times out during initialize is still a real connection episode and must
    // not disappear from diagnostics.
    this.connectionSpawnedAt.set(connectionId, spawnedAt);
    this.lastConnectionIds.set(descriptor.id, connectionId);
    this.deps.getMonitorObserver()?.onConnectionSpawned({
      connectionId,
      agentId: descriptor.id,
      pid: child.pid ?? 0,
      spawnedAt,
      previousConnectionId,
    });
    let exitReported = false;
    const reportExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (exitReported) return;
      exitReported = true;
      const targetSessions = this.deps.getSessionsByAgent(descriptor.id);
      const invalidatedThreadIds = targetSessions.map((session) => session.threadId);
      this.deps.getMonitorObserver()?.onConnectionExit({
        connectionId,
        agentId: descriptor.id,
        pid: child.pid ?? null,
        exitCode,
        signal,
        activeThreadId: this.deps.getActiveThreadId(),
        runningThreadIds: this.deps.getRunningThreadIds(),
        spawnedAt,
        intentional: this.intentionalConnectionIds.has(connectionId),
        stderrTail,
        sessionCountAtTermination: targetSessions.length,
        invalidatedThreadIds,
      });
      this.connectionSpawnedAt.delete(connectionId);
      this.intentionalConnectionIds.delete(connectionId);
      const current = this.connections.get(descriptor.id);
      if (this.activeConnection?.process === child) this.activeConnection = null;
      if (current?.process === child) {
        this.connections.delete(descriptor.id);
        this.deps.invalidateAgentSessions(descriptor.id);
      }
    };
    child.on("exit", reportExit);

    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    let agentCtx!: acp.ClientContext;
    let initResult!: acp.InitializeResponse;

    const hooks = this.deps.hooks;
    const app = acp
      .client({ name: "pipper" })
      .onNotification(acp.methods.client.session.update, async (ctx) => {
        await hooks.onSessionUpdate(ctx.params.sessionId, ctx.params.update);
      })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        return hooks.onRequestPermission(ctx.params, ctx.requestId);
      })
      .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
        return hooks.onReadTextFile(ctx.params);
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
        return hooks.onWriteTextFile(ctx.params);
      })
      .onRequest(acp.methods.client.terminal.create, async (ctx) => {
        // Option A path guard: bound the terminal's *starting* cwd to the
        // session's workspace. The spawned process can still `cd` out — an
        // honest agent won't; a hard boundary (OS sandbox) is deferred. See
        // docs/worktree.md "Threat model".
        if (ctx.params.cwd) {
          hooks.assertWithinWorkspace(ctx.params.sessionId, ctx.params.cwd);
        }
        const terminalId = this.deps.terminal.create({
          command: ctx.params.command,
          args: ctx.params.args ?? undefined,
          cwd: ctx.params.cwd ?? undefined,
          sessionId: ctx.params.sessionId,
          env: ctx.params.env as never,
          outputByteLimit: ctx.params.outputByteLimit ?? undefined,
        });
        return { terminalId };
      })
      .onRequest(acp.methods.client.terminal.output, async (ctx) => {
        const out = this.deps.terminal.getOutput(ctx.params.terminalId);
        return {
          output: out.output,
          truncated: out.truncated,
          exitStatus: out.exitStatus,
        };
      })
      .onRequest(acp.methods.client.terminal.waitForExit, async (ctx) => {
        const result = await this.deps.terminal.waitForExit(
          ctx.params.terminalId,
          ACP_SWITCH_PHASE_TIMEOUT_MS,
        );
        return { exitCode: result.exitCode, signal: result.signal };
      })
      .onRequest(acp.methods.client.terminal.kill, async (ctx) => {
        this.deps.terminal.kill(ctx.params.terminalId);
        return {};
      })
      .onRequest(acp.methods.client.terminal.release, async (ctx) => {
        this.deps.terminal.release(ctx.params.terminalId);
        return {};
      });

    const connection = app.connect(stream);
    agentCtx = connection.agent;

    try {
      initResult = await requestWithTimeout(
        agentCtx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
          clientInfo: {
            name: "pipper",
            title: "Pipper",
            version: this.deps.clientVersion,
          },
        }),
        /\bnpx(?:\.cmd)?$/i.test(command) ? ACP_NPX_INIT_TIMEOUT_MS : ACP_SWITCH_PHASE_TIMEOUT_MS,
        "agent/initialize",
      );
    } catch (err) {
      // A timed-out handshake has no usable owner. Close both sides so the
      // abandoned request cannot keep the child process and transport alive.
      try {
        connection.close();
      } catch {
        // best effort
      }
      await terminateChildProcess(child);
      throw err;
    }

    const agentInfoName = initResult.agentInfo?.name ?? descriptor.name ?? descriptor.id;
    const agentCapabilities = initResult.agentCapabilities ?? {};
    const authMethods = initResult.authMethods ?? [];
    const modelState =
      (initResult as { _meta?: { modelState?: LiveConnection["modelState"] } })._meta?.modelState ??
      null;

    const closed = connection.closed.then(() => {
      // A transport can close while its child is still alive. That is a
      // different failure mode from a process exit and must be visible in the
      // incident log. The exit handler owns the latter case.
      if (child.exitCode == null && child.signalCode == null) {
        const targetSessions = this.deps.getSessionsByAgent(descriptor.id);
        const invalidatedThreadIds = targetSessions.map((session) => session.threadId);
        this.deps.getMonitorObserver()?.onConnectionClosed?.({
          connectionId,
          agentId: descriptor.id,
          pid: child.pid ?? null,
          activeThreadId: this.deps.getActiveThreadId(),
          runningThreadIds: this.deps.getRunningThreadIds(),
          spawnedAt,
          intentional: this.intentionalConnectionIds.has(connectionId),
          stderrTail,
          sessionCountAtTermination: targetSessions.length,
          invalidatedThreadIds,
        });
      }
      const current = this.connections.get(descriptor.id);
      if (this.activeConnection?.process === child) this.activeConnection = null;
      if (current?.process === child) {
        this.connections.delete(descriptor.id);
        this.deps.invalidateAgentSessions(descriptor.id);
      }
    });

    this.deps.getMonitorObserver()?.onConnectionReady?.({
      connectionId,
      initializedAt: Date.now(),
    });

    return {
      connectionId,
      agentId: descriptor.id,
      agentInfoName,
      process: child,
      connection,
      agent: agentCtx,
      agentCapabilities,
      authMethods,
      authRequiredMessage: null,
      modelState,
      closed,
    };
  }
}
