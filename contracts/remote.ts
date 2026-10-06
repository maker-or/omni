/** Shared shapes for the mobile Remote PWA. Phone holds no truth; the
 * laptop's RemoteServer owns threads + worktrees. One chat = one thread =
 * one worktree. */

export interface RemoteProject {
  id: string;
  name: string;
  path: string;
}

export interface RemoteModel {
  id: string;
  name: string;
  /** Provider/driver display name; used to group accounts on the phone. */
  provider?: string;
}

/** A model offered inside one agent (the ACP session's model option). */
export interface RemoteAgentModel {
  id: string;
  name: string;
}

/** The thread's current model and what it can switch to. */
export interface RemoteThreadModel {
  current: string | null;
  options: RemoteAgentModel[];
}

export interface RemoteThreadSummary {
  id: string;
  projectId: string;
  worktreePath: string | null;
  title: string | null;
  running: boolean;
  lastUsedAt: number;
}

export interface RemoteReport {
  threadId: string;
  running: boolean;
  summary: string | null;
  /** Accumulated agent reply text (no tool calls) — shown whole at the end. */
  finalText: string | null;
  messages: Array<{ role: "user" | "agent"; text: string }>;
  /** Project display name, so a wrong-project thread is obvious on the phone. */
  projectName: string | null;
  filesTouched: string[];
  worktreePath: string | null;
  /** False when worktree creation failed and the task ran in project root. */
  isolated: boolean;
  isolationNote: string | null;
  permissions: RemotePermission[];
  request: RemoteRequestStatus | null;
  /** Null when the thread isn't loaded on the Mac or its agent has no model choice. */
  model: RemoteThreadModel | null;
}

export interface RemotePermission {
  id: string;
  title: string;
  detail: string | null;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface RemoteRequestStatus {
  id: string;
  threadId: string | null;
  state: "preparing" | "running" | "completed" | "failed" | "interrupted";
  error: string | null;
  updatedAt: number;
}

export interface RemoteDiagnostics {
  paired: true;
  agentReady: boolean;
  availableAgents: number;
  projects: number;
}

export interface RemoteCreateThreadInput {
  requestId: string;
  projectId: string;
  /** Agent instance id from the desktop registry (named `modelId` for
   * compatibility with shipped clients); null = desktop default. */
  modelId?: string | null;
  /** Model inside that agent, from `/api/remote/agent-models`; null = agent default. */
  model?: string | null;
  prompt: string;
}

export interface RemotePromptInput {
  requestId: string;
  prompt: string;
}
