import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentPromptInput,
  AgentQueueState,
  AgentRuntimeSnapshot,
  AgentUiRequest,
  AgentUiResponse,
} from "../contracts/agent.ts";
import type { Project } from "../contracts/projects.ts";
import type { Thread } from "../contracts/threads.ts";
import { getProject } from "./projects.ts";
import { getActiveProjectId, setActiveProjectId } from "./session.ts";
import {
  getThread,
  listThreads,
  getMessages,
  createThread,
  updateThreadSessionFile,
  updateThreadTitle,
  touchThread,
  getMaxThreadSortOrder,
  getThreadSortOrder,
  deleteThread as removeThreadRow,
} from "./threads.ts";
import { updateLaunchSelection, readLaunchState } from "./launch-state.ts";
import {
  createAgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type ExtensionUIContext,
  type CreateAgentSessionRuntimeFactory,
  type SlashCommandInfo,
  type SessionStats,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getModel, getModels as getKnownModels, getProviders } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";

import { getActivePath } from "./workspace-manager.ts";
import { categorizeIntent, sanitizeErrorType, sanitizeIdentifier } from "./analytics-sanitize.ts";
import type { AnalyticsProperties, AnalyticsSource } from "./analytics-schema.ts";

type SendToRenderer = (channel: string, payload: unknown) => void;
type SetWindowTitle = (title: string) => void;
type SendToFlyout = (channel: string, payload: unknown) => void;

interface ProjectRuntimeRecord {
  project: Project;
  runtime: Awaited<ReturnType<typeof createProjectRuntime>>;
  unsubscribe?: (() => void) | null;
  queue: AgentQueueState;
  status: Record<string, string | undefined>;
  workingMessage: string | null;
  workingVisible: boolean;
  hiddenThinkingLabel: string | null;
  title: string | null;
  editorText: string;
  toolsExpanded: boolean;
}

interface PendingMutation {
  startedAt: number;
  properties: AnalyticsProperties;
}

function modelToSummary(model: Model<any> | undefined): AgentModelSummary | null {
  if (!model) return null;
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    baseUrl: model.baseUrl,
    cost: model.cost,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

function modelsToSummary(models: Model<any>[]): AgentModelSummary[] {
  return models
    .map((model) => modelToSummary(model))
    .filter((value): value is AgentModelSummary => value != null);
}

function getKnownModelSummaries(): AgentModelSummary[] {
  return getProviders().flatMap((provider) => modelsToSummary(getKnownModels(provider as any)));
}

function getKnownModel(provider: string, modelId: string): Model<any> | null {
  try {
    return getModel(provider as any, modelId as any) ?? null;
  } catch {
    return null;
  }
}

function stripThreadSuffix(title: string): string {
  const match = title.trim().match(/^(.*?)(?:\s+#\d+)?$/);
  return match?.[1]?.trim() || title.trim();
}

function buildNextThreadTitle(project: Project, baseTitle: string): string {
  const base = stripThreadSuffix(baseTitle) || project.name;
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+#(\\d+)$`, "i");
  const nextNumber = Math.max(
    0,
    ...listThreads()
      .filter((thread) => thread.project_id === project.id)
      .map((thread) => thread.title.match(pattern)?.[1])
      .filter((value): value is string => typeof value === "string")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
  );
  return `${base} #${nextNumber + 1}`;
}

async function createProjectRuntime(project: Project, sessionManager: SessionManager) {
  const servicesFactory: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    sessionManager: manager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir: getAgentDir(),
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager: manager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  return createAgentSessionRuntime(servicesFactory, {
    cwd: project.path,
    agentDir: getAgentDir(),
    sessionManager,
  });
}

export class AgentManager {
  private readonly sendToRenderer: SendToRenderer;
  private readonly setWindowTitle: SetWindowTitle;
  private readonly sendToFlyout: SendToFlyout;
  private readonly broadcastActiveProject?: (projectId: string) => void;
  private readonly reloadMainWindow?: () => void;
  private readonly captureAnalytics?: (
    name: "mutation_started" | "mutation_completed" | "thread_created",
    properties: AnalyticsProperties,
  ) => void;
  private readonly projectRuntimes = new Map<string, ProjectRuntimeRecord>();
  private readonly projectLocks = new Map<string, Promise<void>>();
  private readonly pendingMutations = new Map<string, PendingMutation>();
  private editorPendingMutation: PendingMutation | null = null;
  private readonly pendingUi = new Map<
    string,
    {
      projectId: string;
      resolve: (value: string | boolean | undefined) => void;
      request: AgentUiRequest;
      timeout?: ReturnType<typeof setTimeout>;
    }
  >();
  private currentEditorText = "";
  private activeProjectId: string | null = null;
  private activeThreadId: string | null = null;
  // Ephemeral editor record — no DB backing, lives only in memory
  private editorRecord: ProjectRuntimeRecord | null = null;

  constructor(options: {
    sendToRenderer: SendToRenderer;
    setWindowTitle: SetWindowTitle;
    sendToFlyout?: SendToFlyout;
    reloadMainWindow?: () => void;
    broadcastActiveProject?: (projectId: string) => void;
    captureAnalytics?: (
      name: "mutation_started" | "mutation_completed" | "thread_created",
      properties: AnalyticsProperties,
    ) => void;
  }) {
    this.sendToRenderer = options.sendToRenderer;
    this.setWindowTitle = options.setWindowTitle;
    this.sendToFlyout = options.sendToFlyout ?? (() => {});
    this.reloadMainWindow = options.reloadMainWindow;
    this.broadcastActiveProject = options.broadcastActiveProject;
    this.captureAnalytics = options.captureAnalytics;
  }

  private emit(payload: AgentBridgeEvent): void {
    this.sendToRenderer("agent:event", payload);
  }

  private getRecord(projectId: string): ProjectRuntimeRecord | undefined {
    return this.projectRuntimes.get(projectId);
  }

  private async lockProject(projectId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.projectLocks.get(projectId) ?? Promise.resolve();
    const next = previous.then(task).finally(() => {
      if (this.projectLocks.get(projectId) === next) {
        this.projectLocks.delete(projectId);
      }
    });
    this.projectLocks.set(projectId, next);
    await next;
  }

  private buildUiContext(projectId: string): ExtensionUIContext {
    const manager = this;
    return {
      async select(title: string, options: string[], opts) {
        return manager.requestUi(projectId, {
          id: randomUUID(),
          kind: "select",
          title,
          options,
          timeoutMs: opts?.timeout,
        });
      },
      async confirm(title: string, message: string, opts) {
        const value = await manager.requestUi(projectId, {
          id: randomUUID(),
          kind: "confirm",
          title,
          message,
          timeoutMs: opts?.timeout,
        });
        return value === true;
      },
      async input(title: string, placeholder?: string, opts?) {
        const value = await manager.requestUi(projectId, {
          id: randomUUID(),
          kind: "input",
          title,
          placeholder,
          timeoutMs: opts?.timeout,
        });
        return typeof value === "string" ? value : undefined;
      },
      notify(message: string, type: "info" | "warning" | "error" = "info") {
        manager.emit({ type: "notification", message, level: type });
      },
      onTerminalInput() {
        return () => {};
      },
      setStatus(key: string, text: string | undefined) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.status[key] = text;
        manager.emit({ type: "status", key, text });
      },
      setWorkingMessage(message?: string) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.workingMessage = message ?? null;
        manager.emit({ type: "working-message", message });
      },
      setWorkingVisible(visible: boolean) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.workingVisible = visible;
        manager.emit({ type: "working-visible", visible });
      },
      setWorkingIndicator() {},
      setHiddenThinkingLabel(label?: string) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.hiddenThinkingLabel = label ?? null;
      },
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setTitle(title: string) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.title = title;
        manager.setWindowTitle(title);
        manager.emit({ type: "title", title });
      },
      async custom<T>() {
        return undefined as T;
      },
      pasteToEditor(text: string) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.editorText = `${record.editorText}${text}`;
        manager.emit({ type: "editor-text", text: record.editorText });
      },
      setEditorText(text: string) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.editorText = text;
        manager.emit({ type: "editor-text", text });
      },
      getEditorText() {
        const record = manager.getRecord(projectId);
        return record?.editorText ?? "";
      },
      async editor(title: string, prefill?: string) {
        const value = await manager.requestUi(projectId, {
          id: randomUUID(),
          kind: "input",
          title,
          placeholder: title,
          prefill,
        });
        return typeof value === "string" ? value : undefined;
      },
      addAutocompleteProvider() {},
      setEditorComponent() {},
      getEditorComponent() {
        return undefined;
      },
      get theme(): Theme {
        throw new Error("Theme not supported in this environment");
      },
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return {
          success: false,
          error: "Theme switching is not available in the agent bridge.",
        };
      },
      getToolsExpanded() {
        return manager.getRecord(projectId)?.toolsExpanded ?? false;
      },
      setToolsExpanded(expanded: boolean) {
        const record = manager.getRecord(projectId);
        if (!record) return;
        record.toolsExpanded = expanded;
      },
    } as ExtensionUIContext;
  }

  private async bindSession(projectId: string, session: AgentSession): Promise<void> {
    const record = this.getRecord(projectId);
    if (!record) return;
    record.unsubscribe?.();
    record.unsubscribe = session.subscribe((event) => {
      if (event.type === "queue_update") {
        record.queue = {
          steering: [...event.steering],
          followUp: [...event.followUp],
        };
      }
      if (event.type === "session_info_changed") {
        record.title = event.name ?? null;
      }
      this.emit({ type: "event", event });
      this.pushSnapshot(projectId);
      if (event.type === "agent_end") {
        this.completeMutation(projectId, "success");
        this.pushSettledSnapshot(projectId);
      }
    });
    await session.bindExtensions({
      uiContext: this.buildUiContext(projectId),
      mode: "rpc",
      abortHandler: () => session.abort(),
      shutdownHandler: () => {},
      onError: (error) => {
        this.emit({
          type: "notification",
          message: error.error,
          level: "error",
        });
      },
    });
  }

  private async syncThreadsFromSessions(
    project: Project,
    excludeSessionFile: string | null = null,
  ): Promise<void> {
    const sessions = await SessionManager.list(project.path);
    const existing = new Set(
      listThreads()
        .filter((thread) => thread.project_id === project.id && thread.session_file != null)
        .map((thread) => thread.session_file as string),
    );
    for (const info of sessions) {
      if (excludeSessionFile && info.path === excludeSessionFile) continue;
      if (existing.has(info.path)) continue;
      const baseTitle = info.name?.trim() || project.name;
      const title = buildNextThreadTitle(project, baseTitle);
      createThread(project.id, title, info.path);
    }
  }

  private resolveProjectThread(projectId: string, sessionFile: string | null): Thread | null {
    const threads = listThreads().filter((thread) => thread.project_id === projectId);
    if (sessionFile) {
      const match = threads.find((thread) => thread.session_file === sessionFile);
      if (match) return match;
    }

    const emptyThreads = threads.filter((thread) => getMessages(thread.id).length === 0);
    if (emptyThreads.length > 0) {
      return emptyThreads[0] ?? null;
    }

    return threads[0] ?? null;
  }

  private resolveSnapshot(projectId: string): AgentRuntimeSnapshot {
    const record = this.getRecord(projectId);
    if (!record) {
      const project = getProject(projectId);
      return {
        projectId,
        threadId: this.activeProjectId === projectId ? this.activeThreadId : null,
        sessionFile: null,
        sessionId: null,
        sessionName: null,
        cwd: project?.path ?? null,
        model: null,
        thinkingLevel: null,
        isStreaming: false,
        isCompacting: false,
        isRetrying: false,
        autoCompactionEnabled: true,
        autoRetryEnabled: true,
        messages: [],
        streamingMessage: null,
        queue: { steering: [], followUp: [] },
        commands: [],
        models: [],
        stats: null,
        status: {},
        workingMessage: null,
        workingVisible: false,
        hiddenThinkingLabel: null,
        title: null,
        editorText: "",
      };
    }

    const session = record.runtime.session;
    return {
      projectId,
      threadId: this.activeProjectId === projectId ? this.activeThreadId : null,
      sessionFile: session.sessionFile ?? null,
      sessionId: session.sessionId ?? null,
      sessionName: session.sessionName ?? null,
      cwd: record.project.path,
      model: modelToSummary(session.model),
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isRetrying: session.isRetrying,
      autoCompactionEnabled: session.autoCompactionEnabled,
      autoRetryEnabled: session.autoRetryEnabled,
      messages: [...session.messages],
      streamingMessage: session.isStreaming ? (session.state.streamingMessage ?? null) : null,
      queue: record.queue,
      commands: session.extensionRunner.getRegisteredCommands().map((command) => ({
        name: command.name,
        description: command.description,
        source: "extension",
        sourceInfo: command.sourceInfo,
      })),
      models: modelsToSummary(session.modelRegistry.getAvailable()),
      stats: session.getSessionStats(),
      status: { ...record.status },
      workingMessage: record.workingMessage,
      workingVisible: record.workingVisible,
      hiddenThinkingLabel: record.hiddenThinkingLabel,
      title: record.title,
      editorText: record.editorText,
    };
  }

  private pushSnapshot(projectId: string): void {
    this.emit({ type: "snapshot", snapshot: this.resolveSnapshot(projectId) });
  }

  private pushSettledSnapshot(projectId: string): void {
    setTimeout(() => {
      this.pushSnapshot(projectId);
    }, 0);
  }

  private async requestUi(
    projectId: string,
    request: AgentUiRequest,
  ): Promise<string | boolean | undefined> {
    const record = this.getRecord(projectId);
    if (!record) return undefined;

    return await new Promise<string | boolean | undefined>((resolve) => {
      const timeout =
        "timeoutMs" in request && request.timeoutMs != null
          ? setTimeout(() => {
              this.pendingUi.delete(request.id);
              resolve(request.kind === "confirm" ? false : undefined);
            }, request.timeoutMs)
          : undefined;

      this.pendingUi.set(request.id, {
        projectId,
        resolve: (value) => {
          if (timeout) clearTimeout(timeout);
          resolve(value);
        },
        request,
        timeout,
      });

      this.emit({ type: "ui-request", request });
    });
  }

  async respondToUiRequest(response: AgentUiResponse): Promise<void> {
    const pending = this.pendingUi.get(response.requestId);
    if (!pending) return;
    this.pendingUi.delete(response.requestId);
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.resolve(response.value);
    this.emit({
      type: "ui-response",
      requestId: response.requestId,
      value: response.value,
    });
  }

  async activateProject(projectId: string, preferredThreadId?: string | null): Promise<void> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const effectiveProject = project;

    const existingRecord = this.getRecord(projectId);
    if (existingRecord) {
      this.activeProjectId = projectId;
      setActiveProjectId(projectId);
      if (preferredThreadId && preferredThreadId !== this.activeThreadId) {
        const thread = getThread(preferredThreadId);
        if (
          thread?.session_file &&
          thread.session_file !== existingRecord.runtime.session.sessionFile
        ) {
          await existingRecord.runtime.switchSession(thread.session_file, {
            cwdOverride: effectiveProject.path,
          });
        }
        this.activeThreadId = preferredThreadId;
        await updateLaunchSelection({ projectId, threadId: preferredThreadId });
      }
      this.broadcastActiveProject?.(projectId);
      this.pushSnapshot(projectId);
      return;
    }

    await this.lockProject(projectId, async () => {
      const launchState = await readLaunchState();
      const requestedThreadId =
        preferredThreadId ?? (launchState.projectId === projectId ? launchState.threadId : null);

      let sessionManager: SessionManager;

      if (requestedThreadId) {
        const thread = getThread(requestedThreadId);
        if (thread?.session_file) {
          try {
            sessionManager = SessionManager.open(
              thread.session_file,
              undefined,
              effectiveProject.path,
            );
          } catch (error: any) {
            const isMissingFile =
              error?.code === "ENOENT" ||
              (error?.message &&
                (error.message.includes("ENOENT") ||
                  error.message.toLowerCase().includes("not found") ||
                  error.message.toLowerCase().includes("no such file")));
            if (isMissingFile) {
              sessionManager = SessionManager.continueRecent(effectiveProject.path);
            } else {
              throw error;
            }
          }
        } else {
          sessionManager = SessionManager.continueRecent(effectiveProject.path);
        }
      } else {
        sessionManager = SessionManager.continueRecent(effectiveProject.path);
      }

      const runtime = await createProjectRuntime(effectiveProject, sessionManager);
      const record: ProjectRuntimeRecord = {
        project: effectiveProject,
        runtime,
        queue: { steering: [], followUp: [] },
        status: {},
        workingMessage: null,
        workingVisible: false,
        hiddenThinkingLabel: null,
        title: runtime.session.sessionName ?? effectiveProject.name,
        editorText: "",
        toolsExpanded: false,
      };

      this.projectRuntimes.set(projectId, record);
      runtime.setBeforeSessionInvalidate(() => {
        record.unsubscribe?.();
        record.unsubscribe = null;
      });
      runtime.setRebindSession(async (session) => {
        await this.bindSession(projectId, session);
      });

      await this.bindSession(projectId, runtime.session);
      await this.syncThreadsFromSessions(effectiveProject);

      const activeThread =
        requestedThreadId != null
          ? getThread(requestedThreadId)
          : this.resolveProjectThread(projectId, runtime.session.sessionFile ?? null);

      const resolvedThread =
        activeThread?.project_id === projectId
          ? activeThread
          : this.resolveProjectThread(projectId, runtime.session.sessionFile ?? null);

      if (resolvedThread) {
        this.activeThreadId = resolvedThread.id;
        touchThread(resolvedThread.id);
        await updateLaunchSelection({ projectId, threadId: resolvedThread.id });
      } else {
        this.activeThreadId = null;
        await updateLaunchSelection({ projectId, threadId: null });
      }

      this.activeProjectId = projectId;
      setActiveProjectId(projectId);
      this.broadcastActiveProject?.(projectId);
      this.pushSnapshot(projectId);
    });
  }

  async switchThread(threadId: string): Promise<void> {
    const thread = getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const project = getProject(thread.project_id);
    if (!project) throw new Error(`Project not found: ${thread.project_id}`);

    await this.activateProject(project.id, threadId);

    const record = this.getRecord(project.id);
    if (!record) return;

    if (thread.session_file && thread.session_file !== record.runtime.session.sessionFile) {
      await record.runtime.switchSession(thread.session_file, {
        cwdOverride: project.path,
      });
    } else if (!thread.session_file) {
      await record.runtime.newSession();
      const sessionFile = record.runtime.session.sessionFile ?? null;
      updateThreadSessionFile(threadId, sessionFile);
    }

    this.activeThreadId = threadId;
    this.activeProjectId = project.id;
    touchThread(threadId);
    setActiveProjectId(project.id);
    this.broadcastActiveProject?.(project.id);
    await updateLaunchSelection({ projectId: project.id, threadId });
    this.pushSnapshot(project.id);
  }

  async createThread(
    projectId: string,
    title: string,
    afterThreadId: string | null = null,
  ): Promise<Thread> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    await this.activateProject(projectId);
    const record = this.getRecord(projectId);
    if (!record) throw new Error("Agent runtime is unavailable.");

    const referenceThread = afterThreadId != null ? getThread(afterThreadId) : null;
    const effectiveReferenceThread =
      referenceThread?.project_id === projectId ? referenceThread : null;
    const nextTitle = buildNextThreadTitle(project, effectiveReferenceThread?.title ?? title);
    const insertAfterOrder =
      effectiveReferenceThread != null ? getThreadSortOrder(effectiveReferenceThread.id) : null;
    const sortOrder = insertAfterOrder != null ? insertAfterOrder + 1 : getMaxThreadSortOrder() + 1;

    await record.runtime.newSession();
    record.runtime.session.setSessionName(nextTitle);
    record.title = nextTitle;
    record.editorText = "";

    const sessionFile = record.runtime.session.sessionFile ?? null;
    await this.syncThreadsFromSessions(project, sessionFile);
    let thread = listThreads().find(
      (row) => row.project_id === projectId && row.session_file === sessionFile,
    );
    if (!thread) {
      thread = createThread(projectId, nextTitle, sessionFile, sortOrder);
    } else if (thread.title !== nextTitle) {
      updateThreadTitle(thread.id, nextTitle);
      thread = { ...thread, title: nextTitle };
    }

    if (thread.session_file !== sessionFile) {
      updateThreadSessionFile(thread.id, sessionFile);
    }

    this.activeThreadId = thread.id;
    this.activeProjectId = project.id;
    touchThread(thread.id);
    setActiveProjectId(project.id);
    await updateLaunchSelection({ projectId: project.id, threadId: thread.id });
    this.pushSnapshot(project.id);
    this.captureAnalytics?.("thread_created", {
      project_id: project.id,
      thread_id: thread.id,
      source: "agent_runtime",
    });
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    const thread = getThread(threadId);
    if (!thread) return;

    const projectId = thread.project_id;
    const record = this.getRecord(projectId);
    const nextThread = listThreads().find(
      (row) => row.project_id === projectId && row.id !== threadId,
    );

    if (thread.session_file && existsSync(thread.session_file)) {
      await rm(thread.session_file, { force: true });
    }

    removeThreadRow(threadId);

    if (nextThread) {
      await this.switchThread(nextThread.id);
      return;
    }

    if (record) {
      record.unsubscribe?.();
      await record.runtime.dispose();
      this.projectRuntimes.delete(projectId);
    }

    if (this.activeThreadId === threadId) {
      this.activeThreadId = null;
      await updateLaunchSelection({ projectId, threadId: null });
    }

    this.pushSnapshot(projectId);
  }

  async renameThread(threadId: string, title: string): Promise<Thread> {
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new Error("Thread title cannot be empty.");
    }

    const thread = getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    updateThreadTitle(threadId, nextTitle);
    const updatedThread = getThread(threadId);
    if (!updatedThread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const record = this.getRecord(thread.project_id);
    if (record && this.activeThreadId === threadId) {
      record.title = nextTitle;
      record.runtime.session.setSessionName(nextTitle);
      this.setWindowTitle(nextTitle);
      this.pushSnapshot(thread.project_id);
    }

    return updatedThread;
  }

  async sendPrompt(input: AgentPromptInput): Promise<void> {
    const projectId = input.threadId
      ? (getThread(input.threadId)?.project_id ?? null)
      : this.currentProjectId();
    if (!projectId) throw new Error("No active project is available.");

    if (input.threadId && input.threadId !== this.activeThreadId) {
      await this.switchThread(input.threadId);
    }

    let record = this.getRecord(projectId);
    if (!record) {
      await this.activateProject(projectId, input.threadId ?? null);
      record = this.getRecord(projectId);
    }
    if (!record) throw new Error("Agent runtime is unavailable.");

    if (!this.activeThreadId) {
      const thread = await this.createThread(projectId, record.project.name);
      this.activeThreadId = thread.id;
    }

    touchThread(this.activeThreadId);
    const mutationProperties = this.buildMutationProperties(input.message, {
      projectId,
      threadId: this.activeThreadId,
      source: "chat_prompt",
      model: modelToSummary(record.runtime.session.model),
    });
    this.startMutation(projectId, mutationProperties);

    void record.runtime.session
      .prompt(input.message, {
        images: input.images,
        streamingBehavior: input.streamingBehavior,
      })
      .catch(async (error: unknown) => {
        this.completeMutation(projectId, "error", error);
        console.error("[AgentManager] Agent prompt failed:", error);
        const message = error instanceof Error ? error.message : "Failed to send prompt.";
        this.emit({ type: "notification", message, level: "error" });
        try {
          const fallback = await record.runtime.session.cycleModel();
          if (fallback) {
            this.emit({
              type: "notification",
              message: `Automatically switched to fallback model: ${fallback.model.name}`,
              level: "warning",
            });
            this.pushSnapshot(record.project.id);
          }
        } catch (cycleErr) {
          console.error("Failed to cycle model on error:", cycleErr);
        }
      });

    this.pushSnapshot(projectId);
  }

  async abort(): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    await record.runtime.session.abort();
    const projectId = this.currentProjectId();
    if (projectId) this.completeMutation(projectId, "cancelled");
    this.pushSnapshot(record.project.id);
  }

  async compact(customInstructions?: string): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    void record.runtime.session.compact(customInstructions).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to compact session.";
      this.emit({ type: "notification", message, level: "error" });
    });
    this.pushSnapshot(record.project.id);
  }

  async cycleModel(
    direction: "forward" | "backward" = "forward",
  ): Promise<AgentModelSummary | null> {
    const record = this.getCurrentRecord();
    if (!record) return null;
    const result = await record.runtime.session.cycleModel(direction);
    this.pushSnapshot(record.project.id);
    return result ? modelToSummary(result.model) : modelToSummary(record.runtime.session.model);
  }

  async setModel(model: { provider: string; modelId: string }): Promise<boolean> {
    const record = this.getCurrentRecord();
    if (!record) return false;
    const resolved =
      getKnownModel(model.provider, model.modelId) ??
      record.runtime.session.modelRegistry.find(model.provider, model.modelId);
    if (!resolved) return false;
    try {
      await record.runtime.session.setModel(resolved);
      this.pushSnapshot(record.project.id);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to set model.";
      this.emit({ type: "notification", message, level: "error" });
      try {
        const fallback = await record.runtime.session.cycleModel();
        if (fallback) {
          this.emit({
            type: "notification",
            message: `Automatically switched to fallback model: ${fallback.model.name}`,
            level: "warning",
          });
          this.pushSnapshot(record.project.id);
        }
      } catch (cycleErr) {
        console.error("Failed to cycle model on error:", cycleErr);
      }
      return false;
    }
  }

  async setThinkingLevel(level: any): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    record.runtime.session.setThinkingLevel(level);
    this.pushSnapshot(record.project.id);
  }

  async cycleThinkingLevel(): Promise<string | null> {
    const record = this.getCurrentRecord();
    if (!record) return null;
    const nextLevel = record.runtime.session.cycleThinkingLevel();
    this.pushSnapshot(record.project.id);
    return nextLevel ?? null;
  }

  getCommands(): SlashCommandInfo[] {
    const record = this.getCurrentRecord();
    const commands = record?.runtime.session.extensionRunner.getRegisteredCommands() ?? [];
    return commands.map((command) => ({
      name: command.name,
      description: command.description,
      source: "extension",
      sourceInfo: command.sourceInfo,
    }));
  }

  getModels(): AgentModelSummary[] {
    const record = this.getCurrentRecord();
    if (!record) return getKnownModelSummaries();

    const knownModels = getKnownModelSummaries();
    const customModels = modelsToSummary(record.runtime.session.modelRegistry.getAvailable()).filter(
      (model) =>
        !knownModels.some(
          (known) => known.provider === model.provider && known.modelId === model.modelId,
        ),
    );
    return [...knownModels, ...customModels];
  }

  getStats(): SessionStats | null {
    const record = this.getCurrentRecord();
    return record?.runtime.session.getSessionStats() ?? null;
  }

  async setEditorText(text: string): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    record.editorText = text;
    this.currentEditorText = text;
    this.emit({ type: "editor-text", text });
  }

  async pasteToEditor(text: string): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    record.editorText = `${record.editorText}${text}`;
    this.currentEditorText = record.editorText;
    this.emit({ type: "editor-text", text: record.editorText });
  }

  getEditorText(): string {
    return this.getCurrentRecord()?.editorText ?? this.currentEditorText;
  }

  reportEditorText(text: string): void {
    const record = this.getCurrentRecord();
    if (!record) return;
    record.editorText = text;
    this.currentEditorText = text;
  }

  getState(): AgentRuntimeSnapshot {
    const projectId = this.currentProjectId();
    if (!projectId) {
      return {
        projectId: null,
        threadId: null,
        sessionFile: null,
        sessionId: null,
        sessionName: null,
        cwd: null,
        model: null,
        thinkingLevel: null,
        isStreaming: false,
        isCompacting: false,
        isRetrying: false,
        autoCompactionEnabled: true,
        autoRetryEnabled: true,
        messages: [],
        streamingMessage: null,
        queue: { steering: [], followUp: [] },
        commands: [],
        models: [],
        stats: null,
        status: {},
        workingMessage: null,
        workingVisible: false,
        hiddenThinkingLabel: null,
        title: null,
        editorText: "",
      };
    }
    return this.resolveSnapshot(projectId);
  }

  async activateFromLaunchState(): Promise<void> {
    const state = await readLaunchState();
    if (!state.projectId) return;
    await this.activateProject(state.projectId, state.threadId);
  }

  private currentProjectId(): string | null {
    return this.activeProjectId ?? getActiveProjectId();
  }

  private getCurrentRecord(): ProjectRuntimeRecord | undefined {
    const projectId = this.currentProjectId();
    if (!projectId) return undefined;
    return this.getRecord(projectId);
  }

  dispose(): Promise<void> {
    const disposals = [...this.projectRuntimes.values()].map(async (record) => {
      record.unsubscribe?.();
      await record.runtime.dispose();
    });
    this.projectRuntimes.clear();
    this.pendingUi.clear();
    return Promise.allSettled(disposals).then(() => undefined);
  }

  // ─── Editor (Ephemeral) ────────────────────────────────────────────────────

  private emitEditor(payload: AgentBridgeEvent): void {
    this.sendToFlyout("editor:event", payload);
  }

  private buildEditorUiContext(): import("@earendil-works/pi-coding-agent").ExtensionUIContext {
    const manager = this;
    return {
      async select() {
        return undefined;
      },
      async confirm() {
        return false;
      },
      async input() {
        return undefined;
      },
      notify(message: string, type: "info" | "warning" | "error" = "info") {
        manager.emitEditor({ type: "notification", message, level: type });
      },
      onTerminalInput() {
        return () => {};
      },
      setStatus(key: string, text: string | undefined) {
        if (!manager.editorRecord) return;
        manager.editorRecord.status[key] = text;
        manager.emitEditor({ type: "status", key, text });
      },
      setWorkingMessage(message?: string) {
        if (!manager.editorRecord) return;
        manager.editorRecord.workingMessage = message ?? null;
        manager.emitEditor({ type: "working-message", message });
      },
      setWorkingVisible(visible: boolean) {
        if (!manager.editorRecord) return;
        manager.editorRecord.workingVisible = visible;
        manager.emitEditor({ type: "working-visible", visible });
      },
      setWorkingIndicator() {},
      setHiddenThinkingLabel(label?: string) {
        if (!manager.editorRecord) return;
        manager.editorRecord.hiddenThinkingLabel = label ?? null;
      },
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setTitle(title: string) {
        if (!manager.editorRecord) return;
        manager.editorRecord.title = title;
        manager.emitEditor({ type: "title", title });
      },
      async custom<T>() {
        return undefined as T;
      },
      pasteToEditor(text: string) {
        if (!manager.editorRecord) return;
        manager.editorRecord.editorText = `${manager.editorRecord.editorText}${text}`;
        manager.emitEditor({ type: "editor-text", text: manager.editorRecord.editorText });
      },
      setEditorText(text: string) {
        if (!manager.editorRecord) return;
        manager.editorRecord.editorText = text;
        manager.emitEditor({ type: "editor-text", text });
      },
      getEditorText() {
        return manager.editorRecord?.editorText ?? "";
      },
      async editor(_title: string, prefill?: string) {
        return prefill;
      },
      addAutocompleteProvider() {},
      setEditorComponent() {},
      getEditorComponent() {
        return undefined;
      },
      get theme(): Theme {
        throw new Error("Theme not supported in this environment");
      },
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return { success: false, error: "Not available in editor." };
      },
      getToolsExpanded() {
        return manager.editorRecord?.toolsExpanded ?? false;
      },
      setToolsExpanded(expanded: boolean) {
        if (!manager.editorRecord) return;
        manager.editorRecord.toolsExpanded = expanded;
      },
    } as import("@earendil-works/pi-coding-agent").ExtensionUIContext;
  }

  async activateEditor(): Promise<void> {
    if (this.editorRecord) return; // already active

    // Create a synthetic project pointing at the active library workspace path
    const omniPath = getActivePath();
    const fakeProject: Project = {
      id: "__omni_editor__",
      name: "Omni Editor",
      path: omniPath,
      icon: "code",
    };

    const sessionManager = SessionManager.inMemory(omniPath);
    const runtime = await createProjectRuntime(fakeProject, sessionManager);

    const record: ProjectRuntimeRecord = {
      project: fakeProject,
      runtime,
      queue: { steering: [], followUp: [] },
      status: {},
      workingMessage: null,
      workingVisible: false,
      hiddenThinkingLabel: null,
      title: "Visual Editor",
      editorText: "",
      toolsExpanded: false,
    };

    this.editorRecord = record;

    // Bind session — events go to editor:event channel
    record.unsubscribe = runtime.session.subscribe((event) => {
      if (event.type === "queue_update") {
        record.queue = {
          steering: [...event.steering],
          followUp: [...event.followUp],
        };
      }
      if (event.type === "agent_end") {
        this.completeEditorMutation("success");
        this.reloadMainWindow?.();
      }
      this.emitEditor({ type: "event", event });
      // push a lightweight snapshot
      this.pushEditorSnapshot();
      if (event.type === "agent_end") {
        this.pushSettledEditorSnapshot();
      }
    });

    await runtime.session.bindExtensions({
      uiContext: this.buildEditorUiContext(),
      mode: "rpc",
      abortHandler: () => runtime.session.abort(),
      shutdownHandler: () => {},
      onError: (err) => {
        this.emitEditor({
          type: "notification",
          message: err.error,
          level: "error",
        });
      },
    });

    this.pushEditorSnapshot();
  }

  private resolveEditorSnapshot(): AgentRuntimeSnapshot {
    const record = this.editorRecord;
    if (!record) {
      return {
        projectId: "__omni_editor__",
        threadId: null,
        sessionFile: null,
        sessionId: null,
        sessionName: null,
        cwd: null,
        model: null,
        thinkingLevel: null,
        isStreaming: false,
        isCompacting: false,
        isRetrying: false,
        autoCompactionEnabled: true,
        autoRetryEnabled: true,
        messages: [],
        streamingMessage: null,
        queue: { steering: [], followUp: [] },
        commands: [],
        models: [],
        stats: null,
        status: {},
        workingMessage: null,
        workingVisible: false,
        hiddenThinkingLabel: null,
        title: "Visual Editor",
        editorText: "",
      };
    }
    const session = record.runtime.session;
    return {
      projectId: "__omni_editor__",
      threadId: null,
      sessionFile: session.sessionFile ?? null,
      sessionId: session.sessionId ?? null,
      sessionName: session.sessionName ?? null,
      cwd: record.project.path,
      model: modelToSummary(session.model),
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isRetrying: session.isRetrying,
      autoCompactionEnabled: session.autoCompactionEnabled,
      autoRetryEnabled: session.autoRetryEnabled,
      messages: [...session.messages],
      streamingMessage: session.isStreaming ? (session.state.streamingMessage ?? null) : null,
      queue: record.queue,
      commands: [],
      models: modelsToSummary(session.modelRegistry.getAvailable()),
      stats: session.getSessionStats(),
      status: { ...record.status },
      workingMessage: record.workingMessage,
      workingVisible: record.workingVisible,
      hiddenThinkingLabel: record.hiddenThinkingLabel,
      title: record.title,
      editorText: record.editorText,
    };
  }

  private pushEditorSnapshot(): void {
    this.emitEditor({ type: "snapshot", snapshot: this.resolveEditorSnapshot() });
  }

  private pushSettledEditorSnapshot(): void {
    setTimeout(() => {
      this.pushEditorSnapshot();
    }, 0);
  }

  getEditorState(): AgentRuntimeSnapshot {
    return this.resolveEditorSnapshot();
  }

  async sendEditorPrompt(input: { message: string }): Promise<void> {
    if (!this.editorRecord) {
      await this.activateEditor();
    }
    const record = this.editorRecord;
    if (!record) throw new Error("Editor runtime is unavailable.");
    const activeProjectId = getActiveProjectId();
    this.editorPendingMutation = {
      startedAt: Date.now(),
      properties: this.buildMutationProperties(input.message, {
        projectId: activeProjectId ?? undefined,
        source: input.message.startsWith("[Component:") ? "overlay_comment" : "companion_prompt",
        model: modelToSummary(record.runtime.session.model),
      }),
    };
    this.captureAnalytics?.("mutation_started", this.editorPendingMutation.properties);

    void record.runtime.session.prompt(input.message).catch((error: unknown) => {
      this.completeEditorMutation("error", error);
      const message = error instanceof Error ? error.message : "Editor prompt failed.";
      this.emitEditor({ type: "notification", message, level: "error" });
    });

    this.pushEditorSnapshot();
  }

  private startMutation(key: string, properties: AnalyticsProperties): void {
    const pending = { startedAt: Date.now(), properties };
    this.pendingMutations.set(key, pending);
    this.captureAnalytics?.("mutation_started", properties);
  }

  private completeMutation(
    key: string,
    outcome: "success" | "error" | "cancelled",
    error?: unknown,
  ): void {
    const pending = this.pendingMutations.get(key);
    if (!pending) return;
    this.pendingMutations.delete(key);
    this.captureAnalytics?.("mutation_completed", {
      ...pending.properties,
      outcome,
      execution_duration_ms: Date.now() - pending.startedAt,
      error_type: outcome === "error" ? sanitizeErrorType(error) : undefined,
    });
  }

  private completeEditorMutation(
    outcome: "success" | "error" | "cancelled",
    error?: unknown,
  ): void {
    const pending = this.editorPendingMutation;
    if (!pending) return;
    this.editorPendingMutation = null;
    this.captureAnalytics?.("mutation_completed", {
      ...pending.properties,
      outcome,
      execution_duration_ms: Date.now() - pending.startedAt,
      error_type: outcome === "error" ? sanitizeErrorType(error) : undefined,
    });
  }

  private buildMutationProperties(
    message: string,
    input: {
      projectId?: string | null;
      threadId?: string | null;
      source: AnalyticsSource;
      model: AgentModelSummary | null;
    },
  ): AnalyticsProperties {
    const componentMatch = message.match(/^\[Component:\s*([^\]\n]+)\]/);
    return {
      project_id: input.projectId ?? undefined,
      thread_id: input.threadId ?? undefined,
      source: input.source,
      component_id: sanitizeIdentifier(componentMatch?.[1]),
      intent_category: categorizeIntent(message),
      model_id: input.model?.modelId,
      model_provider: input.model?.provider,
    };
  }

  async disposeEditor(): Promise<void> {
    if (!this.editorRecord) return;
    const record = this.editorRecord;
    this.editorRecord = null;
    record.unsubscribe?.();
    try {
      await record.runtime.dispose();
    } catch (err) {
      console.error("[AgentManager] Error disposing editor runtime:", err);
    }
  }
}
