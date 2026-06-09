import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
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
import { getThread, listThreads, createThread, updateThreadSessionFile, deleteThread as removeThreadRow } from "./threads.ts";
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
  type SessionStats,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

type SendToRenderer = (channel: string, payload: unknown) => void;
type SetWindowTitle = (title: string) => void;

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

function modelToSummary(model: Model<any> | undefined): AgentModelSummary | null {
  if (!model) return null;
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

function modelsToSummary(models: Model<any>[]): AgentModelSummary[] {
  return models.map((model) => modelToSummary(model)).filter((value): value is AgentModelSummary => value != null);
}

function defaultThreadTitle(project: Project, existingCount: number): string {
  return `${project.name} #${existingCount + 1}`;
}

async function createProjectRuntime(project: Project, sessionManager: SessionManager) {
  const servicesFactory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager: manager, sessionStartEvent }) => {
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
  private readonly projectRuntimes = new Map<string, ProjectRuntimeRecord>();
  private readonly projectLocks = new Map<string, Promise<void>>();
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

  constructor(options: { sendToRenderer: SendToRenderer; setWindowTitle: SetWindowTitle }) {
    this.sendToRenderer = options.sendToRenderer;
    this.setWindowTitle = options.setWindowTitle;
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
          id: crypto.randomUUID(),
          kind: "select",
          title,
          options,
          timeoutMs: opts?.timeout,
        });
      },
      async confirm(title: string, message: string, opts) {
        const value = await manager.requestUi(projectId, {
          id: crypto.randomUUID(),
          kind: "confirm",
          title,
          message,
          timeoutMs: opts?.timeout,
        });
        return value === true;
      },
      async input(title: string, placeholder?: string, opts?) {
        const value = await manager.requestUi(projectId, {
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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
      get theme() {
        return {} as never;
      },
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return { success: false, error: "Theme switching is not available in the agent bridge." };
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

  private async syncThreadsFromSessions(project: Project): Promise<void> {
    const sessions = await SessionManager.list(project.path);
    const existing = new Set(
      listThreads()
        .filter((thread) => thread.project_id === project.id && thread.session_file != null)
        .map((thread) => thread.session_file as string),
    );
    const existingCount = listThreads().filter((thread) => thread.project_id === project.id).length;
    for (const info of sessions) {
      if (existing.has(info.path)) continue;
      const title = info.name?.trim() || defaultThreadTitle(project, existingCount + 1);
      createThread(project.id, title, info.path);
    }
  }

  private resolveProjectThread(projectId: string, sessionFile: string | null): Thread | null {
    const threads = listThreads().filter((thread) => thread.project_id === projectId);
    if (sessionFile) {
      const match = threads.find((thread) => thread.session_file === sessionFile);
      if (match) return match;
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
      streamingMessage: session.state.streamingMessage ?? null,
      queue: record.queue,
      commands: session.extensionRunner.getRegisteredCommands(),
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

  private async requestUi(projectId: string, request: AgentUiRequest): Promise<string | boolean | undefined> {
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
    this.emit({ type: "ui-response", requestId: response.requestId, value: response.value });
  }

  async activateProject(projectId: string, preferredThreadId?: string | null): Promise<void> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const existingRecord = this.getRecord(projectId);
    if (existingRecord) {
      this.activeProjectId = projectId;
      setActiveProjectId(projectId);
      if (preferredThreadId && preferredThreadId !== this.activeThreadId) {
        const thread = getThread(preferredThreadId);
        if (thread?.session_file && thread.session_file !== existingRecord.runtime.session.sessionFile) {
          await existingRecord.runtime.switchSession(thread.session_file, { cwdOverride: project.path });
        }
        this.activeThreadId = preferredThreadId;
        await updateLaunchSelection({ projectId, threadId: preferredThreadId });
      }
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
        if (thread?.session_file && existsSync(thread.session_file)) {
          sessionManager = SessionManager.open(thread.session_file, undefined, project.path);
        } else {
          sessionManager = SessionManager.continueRecent(project.path);
        }
      } else {
        sessionManager = SessionManager.continueRecent(project.path);
      }

      const runtime = await createProjectRuntime(project, sessionManager);
      const record: ProjectRuntimeRecord = {
        project,
        runtime,
        queue: { steering: [], followUp: [] },
        status: {},
        workingMessage: null,
        workingVisible: false,
        hiddenThinkingLabel: null,
        title: runtime.session.sessionName ?? project.name,
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
      await this.syncThreadsFromSessions(project);

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
        await updateLaunchSelection({ projectId, threadId: resolvedThread.id });
      } else {
        this.activeThreadId = null;
        await updateLaunchSelection({ projectId, threadId: null });
      }

      this.activeProjectId = projectId;
      setActiveProjectId(projectId);
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
      await record.runtime.switchSession(thread.session_file, { cwdOverride: project.path });
    } else if (!thread.session_file) {
      await record.runtime.newSession();
      updateThreadSessionFile(threadId, record.runtime.session.sessionFile ?? null);
    }

    this.activeThreadId = threadId;
    this.activeProjectId = project.id;
    setActiveProjectId(project.id);
    await updateLaunchSelection({ projectId: project.id, threadId });
    this.pushSnapshot(project.id);
  }

  async createThread(projectId: string, title: string): Promise<Thread> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    await this.activateProject(projectId);
    const record = this.getRecord(projectId);
    if (!record) throw new Error("Agent runtime is unavailable.");

    await record.runtime.newSession();
    record.runtime.session.setSessionName(title.trim());
    record.title = title.trim();
    record.editorText = "";

    await this.syncThreadsFromSessions(project);
    const existing = this.resolveProjectThread(projectId, record.runtime.session.sessionFile ?? null);
    const thread =
      existing ??
      createThread(projectId, title, record.runtime.session.sessionFile ?? null);

    if (thread.session_file !== record.runtime.session.sessionFile) {
      updateThreadSessionFile(thread.id, record.runtime.session.sessionFile ?? null);
    }

    this.activeThreadId = thread.id;
    this.activeProjectId = project.id;
    setActiveProjectId(project.id);
    await updateLaunchSelection({ projectId: project.id, threadId: thread.id });
    this.pushSnapshot(project.id);
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    const thread = getThread(threadId);
    if (!thread) return;

    const projectId = thread.project_id;
    const record = this.getRecord(projectId);
    const nextThread = listThreads().find((row) => row.project_id === projectId && row.id !== threadId);

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

  async sendPrompt(input: AgentPromptInput): Promise<void> {
    const projectId = input.threadId ? getThread(input.threadId)?.project_id ?? null : this.currentProjectId();
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
      const thread = await this.createThread(projectId, defaultThreadTitle(record.project, listThreads().filter((row) => row.project_id === projectId).length));
      this.activeThreadId = thread.id;
    }

    void record.runtime.session
      .prompt(input.message, {
        images: input.images,
        streamingBehavior: input.streamingBehavior,
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to send prompt.";
        this.emit({ type: "notification", message, level: "error" });
      });

    this.pushSnapshot(projectId);
  }

  async abort(): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    await record.runtime.session.abort();
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

  async cycleModel(direction: "forward" | "backward" = "forward"): Promise<AgentModelSummary | null> {
    const record = this.getCurrentRecord();
    if (!record) return null;
    const result = await record.runtime.session.cycleModel(direction);
    this.pushSnapshot(record.project.id);
    return result ? modelToSummary(result.model) : modelToSummary(record.runtime.session.model);
  }

  async setModel(model: { provider: string; modelId: string }): Promise<boolean> {
    const record = this.getCurrentRecord();
    if (!record) return false;
    const resolved = record.runtime.session.modelRegistry.find(model.provider, model.modelId);
    if (!resolved) return false;
    const success = await record.runtime.session.setModel(resolved);
    this.pushSnapshot(record.project.id);
    return success;
  }

  getCommands() {
    const record = this.getCurrentRecord();
    return record?.runtime.session.extensionRunner.getRegisteredCommands() ?? [];
  }

  getModels(): AgentModelSummary[] {
    const record = this.getCurrentRecord();
    return record ? modelsToSummary(record.runtime.session.modelRegistry.getAvailable()) : [];
  }

  getStats(): SessionStats | null {
    const record = this.getCurrentRecord();
    return record?.runtime.session.getSessionStats() ?? null;
  }

  async setEditorText(text: string): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    record.editorText = text;
    this.emit({ type: "editor-text", text });
  }

  async pasteToEditor(text: string): Promise<void> {
    const record = this.getCurrentRecord();
    if (!record) return;
    record.editorText = `${record.editorText}${text}`;
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
}
