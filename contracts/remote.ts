import type { PromptImagePayload } from "./prompt-images.ts";

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
  images?: PromptImagePayload[];
}

export interface RemotePromptInput {
  requestId: string;
  prompt: string;
  images?: PromptImagePayload[];
}

/**
 * What a paired device may do. `read` covers projects, threads and reports;
 * `run` starts agent work (new tasks, follow-ups). Every API route declares
 * the scope it needs.
 */
export type RemoteScope = "read" | "run";

export interface RemoteDevice {
  id: string;
  name: string;
  scopes: RemoteScope[];
  createdAt: number;
  lastSeenAt: number | null;
}

/** A one-time pairing code shown on the laptop (QR + typeable form). */
export interface RemotePairingOffer {
  /** Display form, e.g. "7KD2M-QX9HT". */
  code: string;
  /** QR target; null when no advertisable host is bound. */
  pairingUrl: string | null;
  expiresAt: number;
  scopes: RemoteScope[];
}

/**
 * How phones reach the laptop. `tailscale`: plain HTTP on the tailnet
 * address. `cloudflare`: HTTPS at a fixed hostname through this laptop's
 * named tunnel, provisioned by pipper.dev (requires sign-in).
 * `cloudflare-quick`: account-less quick tunnel for development — its
 * address changes whenever the tunnel restarts.
 */
export type RemoteTransport = "tailscale" | "cloudflare" | "cloudflare-quick";

export type RemoteTunnelStatus =
  | { state: "stopped" }
  | { state: "installing" }
  | { state: "starting" }
  | { state: "connected"; url: string }
  | { state: "reconnecting"; attempt: number; retryAt: number; lastError: string | null }
  | {
      state: "error";
      message: string;
      /** Signed out, or pipper.dev refused the laptop credential: sign in again. */
      signInRequired?: boolean;
    };

export interface RemoteServerInfo {
  enabled: boolean;
  serving: boolean;
  transport: RemoteTransport;
  /** Base URL phones use (tunnel or tailnet); null while unreachable. */
  publicUrl: string | null;
  tunnel: RemoteTunnelStatus;
  host: string | null;
  port: number | null;
  /** Why the server isn't serving (e.g. port taken); null when it is. */
  error: string | null;
}

export interface RemoteDevicesState {
  devices: RemoteDevice[];
  /** The current pairing offer, if one is still waiting to be redeemed. */
  offer: RemotePairingOffer | null;
}

export interface RemotePairRequest {
  code: string;
  deviceName?: string;
}

/**
 * Who a phone is about to pair with, shown for confirmation before any code
 * is redeemed. `attestation` is pipper.dev's signed owner statement (named
 * tunnels only); `name` is whatever the laptop calls itself — unverified.
 */
export interface RemoteLaptopIdentity {
  name: string;
  host: string | null;
  attestation: string | null;
}

export interface RemotePairPreviewResponse {
  laptop: RemoteLaptopIdentity;
}

export interface RemotePairResponse {
  token: string;
  device: RemoteDevice;
  laptop: RemoteLaptopIdentity;
}
