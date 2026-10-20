// Opt-in diagnostic reproductions of current scheduling behavior, not production latency benchmarks.
import { expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
vi.mock("electron", () => ({ app: { getPath: () => "/nonexistent-userdata" } }));
import { SubagentManager } from "./subagents/subagent-manager.ts";
/** Reports are regenerated on demand; the output directory is not tracked. */
async function writeReport(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
async function spawn(url: string, task: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "spawn_subagent", arguments: { agent_id: "scripted", task } },
    }),
  });
  return (await response.json()).result;
}
test.skipIf(process.env.PIPPER_ARCHITECTURE_SCHEDULING !== "1")(
  "nested subagent runs while its waiting parent lends it the only slot",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pipper-nested-scheduling-"));
    const urls = new Map<string, string>();
    const started: string[] = [];
    const cancels: string[] = [];
    let manager!: SubagentManager;
    let counter = 0;
    let childFinished = false;
    try {
      manager = new SubagentManager({
        baseDir: root,
        listAgents: () => [
          {
            id: "scripted",
            name: "scripted",
            displayName: "Scripted",
            command: "scripted",
            args: [],
            available: true,
            installKind: "binary",
          },
        ],
        host: {
          baseMcpServers: () => [],
          emitEvent: () => {},
          acquireConnection: async () => ({
            agentId: "scripted",
            agentCapabilities: { mcpCapabilities: { http: true } },
            agent: {
              request: async (method: unknown, params: any) => {
                if (method === acp.methods.agent.session.new) {
                  const id = `scripted-${++counter}`;
                  urls.set(
                    id,
                    params.mcpServers.find((s: any) => s.name === "pipper-subagents")?.url ?? "",
                  );
                  return { sessionId: id };
                }
                if (method === acp.methods.agent.session.prompt) {
                  const id = params.sessionId;
                  started.push(id);
                  if (id === "scripted-1") await spawn(urls.get(id)!, "nested child");
                  else childFinished = true;
                  return { stopReason: "end_turn" };
                }
                return {};
              },
              notify: async (_method: unknown, params: any) => {
                cancels.push(params.sessionId);
              },
            },
          }),
        },
      });
      await manager.init();
      await manager.setConfig({ maxConcurrent: 1, maxDepth: 2, runTimeoutMs: 30000 });
      const attached = await manager.attachMcpServers(
        [],
        { mcpCapabilities: { http: true } },
        { cwd: root, depth: 0 },
      );
      manager.bindSession(attached.token!, "root-orchestrator");
      // Fake only the scheduler deadline. Requests use the actual local MCP HTTP path.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const parent = spawn(
        attached.servers.find((s) => s.name === "pipper-subagents")!.url as string,
        "parent waits for child",
      );
      // No clock advance: the child must start and finish within the parent's deadline.
      const result = await parent;
      const before = { started: [...started] };
      expect(childFinished).toBe(true);
      expect(result.isError).toBeUndefined();
      expect(started).toEqual(["scripted-1", "scripted-2"]);
      expect(cancels).toEqual([]);
      expect((manager as any).activeRuns).toBe(0);
      expect(manager.getRunSnapshots().every((r) => r.status === "finished")).toBe(true);
      const report = {
        capturedAt: new Date().toISOString(),
        scope:
          "Production SubagentManager and real loopback MCP HTTP with a scripted ACP provider. One slot and depth two exercise the all-slots-occupied nested dependency; the waiting parent lends its slot to the child. The fake clock is never advanced, so completion happens within the configured 30000ms deadline. Correctness/scheduling check, not measured wall latency.",
        startedBeforeSettle: before,
        afterCompletion: {
          started,
          childFinished,
          parentToolResult: result,
          cancels,
          runs: manager.getRunSnapshots().map((r) => ({ depth: r.depth, status: r.status })),
        },
      };
      await writeReport(
        "docs/architecture/opencode/nested-scheduling-verification.json",
        JSON.stringify(report, null, 2),
      );
    } finally {
      vi.useRealTimers();
      manager?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);

import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { SnapshotFreshness } from "./snapshot-freshness.ts";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
function snapshotManager(write: (input: any) => Promise<any>) {
  return Object.assign(Object.create(AgentConnectionManager.prototype), {
    snapshotStore: { enabled: true, write },
    snapshotWriteChains: new Map(),
    snapshotTimers: new Map(),
    loadingSessionThreads: new Set(),
    sessions: new Map(),
    pendingSnapshotWrites: new Map(),
    snapshotWriteFailures: 0,
    snapshotWritesBlockedUntil: 0,
    snapshotFreshness: new SnapshotFreshness(),
    disposing: false,
  });
}
function runtime(id: string) {
  return {
    threadId: id,
    agentSessionId: id,
    agentId: "scripted",
    slice: createEmptySessionSlice(),
    promptInFlight: false,
    agentReady: true,
    snapshotDirty: true,
    toolPayloads: new Map(),
    payloadRevision: 0,
  };
}
test.skipIf(process.env.PIPPER_ARCHITECTURE_SCHEDULING !== "1")(
  "verify snapshot failures recover and pending revisions coalesce",
  async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let attempts = 0;
      const failing = snapshotManager(async () => {
        attempts++;
        if (attempts === 1) throw new Error("Injected single storage write failure");
        return {};
      });
      failing.sessions.set("a", runtime("a"));
      failing.sessions.set("b", runtime("b"));
      const first = await failing.flushThreadSnapshot("a");
      const other = await failing.flushThreadSnapshot("b");
      expect(first).toBe(false);
      expect(other).toBe(true);
      expect(attempts).toBe(2);
      expect(failing.snapshotWriteFailures).toBe(0);
      for (const timer of failing.snapshotTimers.values()) clearTimeout(timer);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const revisions: string[] = [];
      const queued = snapshotManager(async (input: any) => {
        revisions.push(input.slice.title);
        if (revisions.length === 1) await gate;
        return null;
      });
      const r = runtime("queued");
      queued.sessions.set(r.threadId, r);
      const requests: Promise<boolean>[] = [];
      r.slice = { ...r.slice, title: "revision-0" };
      requests.push(queued.flushThreadSnapshot(r.threadId));
      await vi.waitFor(() => expect(revisions).toHaveLength(1));
      for (let i = 1; i < 6; i++) {
        r.slice = { ...r.slice, title: `revision-${i}` };
        requests.push(queued.flushThreadSnapshot(r.threadId));
      }
      const trackedChains = queued.snapshotWriteChains.size;
      const pendingInputs = queued.pendingSnapshotWrites.size;
      expect(pendingInputs).toBe(1);
      release();
      await Promise.all(requests);
      expect(revisions).toEqual(["revision-0", "revision-5"]);
      await writeReport(
        "docs/architecture/opencode/snapshot-queue-verification.json",
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            scope:
              "Actual public flushThreadSnapshot methods on AgentConnectionManager.prototype with minimum initialized queue state and controlled storage adapters. No real disk failure, retention-byte, production frequency, or app-latency measurement. Tests isolate queue/catch behavior from constructor/process startup.",
            failure: {
              injectedFailures: 1,
              actualWriteAttempts: attempts,
              firstFlushResult: first,
              otherThreadFlushResult: other,
              consecutiveFailuresAfterRecovery: failing.snapshotWriteFailures,
            },
            queuedRevisions: {
              concurrentRequests: 6,
              trackedTailMapEntries: trackedChains,
              pendingInputs,
              writtenRevisions: revisions,
              coalescedToLatest: true,
            },
          },
          null,
          2,
        ),
      );
    } finally {
      warn.mockRestore();
    }
  },
);

vi.mock("../src/components/ui/toast", () => ({ toast: vi.fn() }));
test.skipIf(process.env.PIPPER_ARCHITECTURE_SCHEDULING !== "1")(
  "delivered events that leave the active session unchanged notify no subscribers",
  async () => {
    let bridge: (payload: any) => void = () => {};
    const initial = {
      ...createEmptySessionSlice(),
      projectId: "fixture",
      threadId: "active",
      agentId: "scripted",
      agentSessionId: "active-session",
      cwd: "/tmp",
      isCompacting: false,
      editorText: "",
      authRequiredMessage: null,
      switchingAgent: false,
    };
    vi.stubGlobal("window", {
      omni: {
        agent: {
          onEvent: (handler: any) => {
            bridge = handler;
            return () => {};
          },
          getState: async () => initial,
        },
      },
    });
    try {
      const { useAgentStore } = await import("../src/store/agent-store.ts");
      await useAgentStore.getState().connect();
      const initialState = useAgentStore.getState().state;
      const initialSnapshot = useAgentStore.getState().snapshot;
      let notifications = 0;
      const unsubscribe = useAgentStore.subscribe(() => {
        notifications++;
      });
      for (let i = 0; i < 100; i++)
        bridge({
          type: "terminal-output",
          terminalId: "probe-terminal",
          output: "fixture\n",
          append: true,
        });
      const terminalOutputNotifications = notifications;
      for (let i = 0; i < 100; i++)
        bridge({
          type: "session-update",
          sessionId: "other-session",
          threadId: "background",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "fixture" },
          },
        });
      const injectedBackgroundNotifications = notifications - terminalOutputNotifications;
      const activeStateUnchanged = useAgentStore.getState().state === initialState;
      const projectionUnchanged = useAgentStore.getState().snapshot === initialSnapshot;
      unsubscribe();
      expect(terminalOutputNotifications).toBe(0);
      expect(injectedBackgroundNotifications).toBe(0);
      expect(activeStateUnchanged).toBe(true);
      expect(projectionUnchanged).toBe(true);
      await writeReport(
        "docs/architecture/opencode/ignored-event-verification.json",
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            scope:
              "Actual renderer agent store connected to a scripted preload bridge. Counts Zustand listener notifications, not React renders/commits/paint or production IPC frequency. Terminal outputs are a real bridge event type. Background deltas are deliberately injected to exercise the defensive path; main normally suppresses those text deltas.",
            terminalOutputEvents: 100,
            terminalOutputNotifications,
            injectedBackgroundEvents: 100,
            injectedBackgroundNotifications,
            activeStateUnchanged,
            projectionUnchanged,
          },
          null,
          2,
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

test.skipIf(process.env.PIPPER_ARCHITECTURE_SCHEDULING !== "1")(
  "verify one deadline covers establishment and late sessions are closed without dispatch",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pipper-establish-deadline-"));
    let manager: SubagentManager | undefined;
    const pendingNew: Array<() => void> = [];
    const finishNew = () => pendingNew.splice(0).forEach((resolve) => resolve());
    let newRequests = 0;
    let promptRequests = 0;
    let closeRequests = 0;
    let cancelNotifications = 0;
    let settled = 0;
    try {
      manager = new SubagentManager({
        baseDir: root,
        listAgents: () => [
          {
            id: "scripted",
            name: "scripted",
            displayName: "Scripted",
            command: "scripted",
            args: [],
            available: true,
            installKind: "binary",
          },
        ],
        host: {
          baseMcpServers: () => [],
          emitEvent: () => {},
          acquireConnection: async () => ({
            agentId: "scripted",
            agentCapabilities: { mcpCapabilities: { http: true } },
            agent: {
              request: async (method: unknown) => {
                if (method === acp.methods.agent.session.new) {
                  newRequests++;
                  const id = `delayed-session-${newRequests}`;
                  await new Promise<void>((resolve) => {
                    pendingNew.push(resolve);
                  });
                  return { sessionId: id };
                }
                if (method === acp.methods.agent.session.prompt) {
                  promptRequests++;
                  return { stopReason: "end_turn" };
                }
                if (method === acp.methods.agent.session.close) closeRequests++;
                return {};
              },
              notify: async () => {
                cancelNotifications++;
              },
            },
          }),
        },
      });
      await manager.init();
      await manager.setConfig({ maxConcurrent: 1, runTimeoutMs: 30000 });
      const attached = await manager.attachMcpServers(
        [],
        { mcpCapabilities: { http: true } },
        { cwd: root, depth: 0 },
      );
      manager.bindSession(attached.token!, "deadline-root");
      const url = attached.servers.find((s) => s.name === "pipper-subagents")!.url as string;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const one = spawn(url, "delayed establishment").then((value) => {
        settled++;
        return value;
      });
      const two = spawn(url, "queued establishment").then((value) => {
        settled++;
        return value;
      });
      await vi.waitFor(() => {
        expect(newRequests).toBe(1);
        expect(manager!.getRunSnapshots().filter((r) => r.status === "queued")).toHaveLength(1);
      });
      await vi.advanceTimersByTimeAsync(30000);
      const results = await Promise.all([one, two]);
      const afterDeadline = {
        settled,
        newRequests,
        promptRequests,
        activeRuns: (manager as any).activeRuns,
        runs: manager.getRunSnapshots().map((r) => ({ status: r.status, depth: r.depth })),
      };
      expect(settled).toBe(2);
      expect(results.every((r) => r.isError && /timed out/.test(r.content[0].text))).toBe(true);
      // The queued run may be admitted just before its own deadline fires.
      expect(newRequests).toBeGreaterThanOrEqual(1);
      expect(afterDeadline.activeRuns).toBe(0);
      expect(afterDeadline.runs.every((r) => r.status === "cancelled")).toBe(true);
      const afterCancel = { cancelNotifications };
      finishNew();
      await vi.waitFor(() => expect(closeRequests).toBe(newRequests));
      expect(promptRequests).toBe(0);
      await writeReport(
        "docs/architecture/opencode/establishment-deadline-verification.json",
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            scope:
              "Actual SubagentManager and MCP loopback HTTP with a scripted delayed session/new. Fake timers advance the configured 30000ms whole-run deadline while one run is establishing and one is queued. session/new is released only after both settle; the late session must be closed and never prompted. Scheduling/cancellation behavior, not a real provider hang or measured wall-clock latency.",
            configuredRunTimeoutMs: 30000,
            advancedClockMs: 30000,
            afterDeadline,
            afterCancel,
            afterLateEstablishment: { newRequests, promptRequests, closeRequests, results },
          },
          null,
          2,
        ),
      );
    } finally {
      vi.useRealTimers();
      manager?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
