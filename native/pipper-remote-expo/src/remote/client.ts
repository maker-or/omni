import type { PairingLink } from "./pairing-link";
import type {
  RemoteAgentModel,
  RemoteCatalog,
  RemoteConfig,
  RemoteDevice,
  RemoteDiagnostics,
  RemoteLaptopIdentity,
  RemotePairResponse,
  RemoteReport,
  RemoteThreadModel,
  RemoteThreadSummary,
} from "./types";

type ErrorKind = "notPaired" | "badURL" | "unreachable" | "http" | "decoding" | "rejected";

/** Mirrors `RemoteClientError` in the iOS app, including its user-facing text. */
export class RemoteClientError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;

  constructor(kind: ErrorKind, detail = "", status: number | null = null) {
    super(RemoteClientError.describe(kind, detail, status));
    this.name = "RemoteClientError";
    this.kind = kind;
    this.status = status;
  }

  private static describe(kind: ErrorKind, detail: string, status: number | null): string {
    switch (kind) {
      case "notPaired":
        return "Not paired with a Mac yet.";
      case "badURL":
        return "The Mac address is invalid.";
      case "unreachable":
        return `Couldn't reach your Mac (${detail}). Keep Pipper open on your Mac and check your connection.`;
      case "rejected":
        return detail;
      case "decoding":
        return `Unexpected reply from the Mac (${detail}).`;
      case "http": {
        if (status === 401) return "Your Mac no longer accepts this phone. Pair again.";
        if (status === 429) return "Too many attempts. Wait a minute and try again.";
        if (status === 503) return "The agent on your Mac isn't ready yet.";
        // 403 explains itself (e.g. a read-only phone starting work).
        if (status === 403 && detail) return detail;
        const trimmed = detail.trim();
        return trimmed ? `Mac returned HTTP ${status}: ${trimmed}` : `Mac returned HTTP ${status}.`;
      }
    }
  }
}

export function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof RemoteClientError && error.kind === "http" && error.status === status;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Server errors are `{ "error": "..." }`; surface the message, not JSON. */
function parseRejection(text: string): { error: string | null; retryable: boolean } {
  try {
    const body = JSON.parse(text) as { error?: unknown; retryable?: unknown };
    return {
      error: typeof body.error === "string" ? body.error : null,
      retryable: body.retryable === true,
    };
  } catch {
    return { error: null, retryable: false };
  }
}

async function send<T>(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const why = controller.signal.aborted ? "timed out" : errorMessage(error);
    throw new RemoteClientError("unreachable", why);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const rejection = parseRejection(text);
    // The Mac confirmed it never started this request: safe to try again.
    if (rejection.retryable && rejection.error)
      throw new RemoteClientError("rejected", rejection.error);
    throw new RemoteClientError("http", rejection.error ?? text.slice(0, 16_384), res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new RemoteClientError("decoding", errorMessage(error));
  }
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

/**
 * Thin client for the laptop's `/api/remote/*` routes, with this phone's
 * device token on every call. Port of `RemoteClient` in the iOS app.
 */
export class RemoteClient {
  constructor(
    readonly config: RemoteConfig,
    /** Called when the laptop refuses this phone's token (revoked or expired). */
    private readonly onUnauthorized?: () => void,
  ) {}

  // MARK: Routes

  async health(): Promise<boolean> {
    return (await this.get<{ ok: boolean }>("/api/remote/health")).ok;
  }

  /** The laptop's view of this phone (name and scopes). */
  async device(): Promise<RemoteDevice> {
    return (await this.get<{ device: RemoteDevice }>("/api/remote/session")).device;
  }

  /** Unpair on the laptop too, so the token is dead even if it leaked. */
  async revokeThisDevice(): Promise<void> {
    await this.call("DELETE", "/api/remote/session");
  }

  diagnostics(): Promise<RemoteDiagnostics> {
    return this.get("/api/remote/diagnostics");
  }

  fetchCatalog(): Promise<RemoteCatalog> {
    return this.get("/api/remote/catalog");
  }

  async listThreads(): Promise<RemoteThreadSummary[]> {
    return (await this.get<{ threads: RemoteThreadSummary[] }>("/api/remote/threads")).threads;
  }

  async report(threadId: string): Promise<RemoteReport> {
    const path = `/api/remote/threads/${encodeURIComponent(threadId)}/report`;
    return (await this.get<{ report: RemoteReport }>(path)).report;
  }

  /**
   * Models inside each agent, keyed by agent instance id. The Mac may spawn
   * agents to answer, so this gets a longer timeout than other routes.
   */
  async agentModels(): Promise<Record<string, RemoteAgentModel[]>> {
    const body = await this.call<{ models: Record<string, RemoteAgentModel[]> }>(
      "GET",
      "/api/remote/agent-models",
      undefined,
      30_000,
    );
    return body.models;
  }

  /**
   * `agentId` maps to the laptop's `modelId` field (it is an agent id there);
   * `model` is the model inside that agent, null for the agent's default.
   */
  async createThread(input: {
    projectId: string;
    agentId: string | null;
    model: string | null;
    prompt: string;
    requestId: string;
  }): Promise<RemoteThreadSummary> {
    const body = await this.call<{ thread: RemoteThreadSummary }>("POST", "/api/remote/threads", {
      requestId: input.requestId,
      projectId: input.projectId,
      modelId: input.agentId,
      model: input.model,
      prompt: input.prompt,
    });
    return body.thread;
  }

  async sendPrompt(threadId: string, prompt: string, requestId: string): Promise<void> {
    await this.call("POST", `/api/remote/threads/${encodeURIComponent(threadId)}/prompt`, {
      requestId,
      prompt,
    });
  }

  /** Switches the model for the thread's next turn. */
  async setModel(threadId: string, model: string): Promise<RemoteThreadModel | null> {
    const path = `/api/remote/threads/${encodeURIComponent(threadId)}/model`;
    const body = await this.call<{ model?: RemoteThreadModel | null }>("POST", path, { model });
    return body.model ?? null;
  }

  async stop(threadId: string): Promise<void> {
    await this.call("POST", `/api/remote/threads/${encodeURIComponent(threadId)}/stop`, {});
  }

  async answer(
    threadId: string,
    decisionId: string,
    optionId: string | null,
    cancelled = false,
  ): Promise<void> {
    await this.call("POST", `/api/remote/threads/${encodeURIComponent(threadId)}/permission`, {
      decisionId,
      optionId,
      cancelled,
    });
  }

  // MARK: Transport

  private get<T>(path: string): Promise<T> {
    return this.call<T>("GET", path);
  }

  private async call<T = { ok: boolean }>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.config.token || !this.config.baseURL) throw new RemoteClientError("notPaired");
    try {
      return await send<T>(
        `${this.config.baseURL}${path}`,
        {
          method,
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${this.config.token}` },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (error) {
      if (isHttpStatus(error, 401)) this.onUnauthorized?.();
      throw error;
    }
  }

  // MARK: Pairing (no token yet)

  /**
   * Ask the laptop who it is without using the code up, so the user can
   * confirm before this phone sends it anything (pairing-link hijack defense).
   */
  static async previewPairing(link: PairingLink): Promise<RemoteLaptopIdentity> {
    const body = await pairingCall<{ laptop: RemoteLaptopIdentity }>(
      link,
      "/api/remote/pair/preview",
      { code: link.code },
    );
    return body.laptop;
  }

  /** Redeem the one-time code for this phone's own device token. */
  static redeemPairing(link: PairingLink, deviceName: string): Promise<RemotePairResponse> {
    return pairingCall(link, "/api/remote/pair", { code: link.code, deviceName });
  }
}

async function pairingCall<T>(link: PairingLink, path: string, input: unknown): Promise<T> {
  try {
    return await send<T>(
      `${link.baseURL}${path}`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) },
      DEFAULT_TIMEOUT_MS,
    );
  } catch (error) {
    if (isHttpStatus(error, 401)) {
      throw new RemoteClientError(
        "rejected",
        "That code is wrong or has expired. Make a new one on your Mac.",
      );
    }
    if (isHttpStatus(error, 404)) {
      throw new RemoteClientError(
        "rejected",
        "That Mac's Pipper is too old for this app. Update Pipper on your Mac, then pair again.",
      );
    }
    throw error;
  }
}
