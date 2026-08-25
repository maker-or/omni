import type * as acp from "@agentclientprotocol/sdk";
import type { AcpBridgeEvent, AcpPermissionRequest } from "../contracts/acp.ts";
import type { AgentOsNotification } from "./os-notifications.ts";

/** Default allow_once after this long if the UI never responds. */
const PERMISSION_TIMEOUT_MS = 120_000;

interface PendingPermission {
  resolve: (response: acp.RequestPermissionResponse) => void;
  request: AcpPermissionRequest;
  timer: ReturnType<typeof setTimeout>;
}

export interface PermissionCoordinatorDeps {
  /** Auto-answer for headless subagent sessions; null means "ask the user". */
  autoResponse: (params: acp.RequestPermissionRequest) => acp.RequestPermissionResponse | null;
  findThreadBySessionId: (sessionId: string) => string | null;
  emit: (event: AcpBridgeEvent) => void;
  notifyIfHidden: (notification: AgentOsNotification) => void;
  threadDisplayTitle: (threadId: string | null | undefined) => string | null;
}

/**
 * Tracks agent permission requests awaiting a user answer. One pending request
 * per (sessionId, requestId); a re-request of the same key displaces the old
 * one with a cancellation, and every unresolved request settles after a
 * timeout so an agent can never block forever on a hidden prompt.
 */
export class PermissionCoordinator {
  private readonly deps: PermissionCoordinatorDeps;
  private readonly pending = new Map<string, PendingPermission>();
  private sequence = 0;

  constructor(deps: PermissionCoordinatorDeps) {
    this.deps = deps;
  }

  private key(sessionId: string, requestId: string | number): string {
    return `${sessionId}:${String(requestId)}`;
  }

  handle(
    params: acp.RequestPermissionRequest,
    requestId: string | number | null,
  ): Promise<acp.RequestPermissionResponse> {
    // Subagent sessions have no UI surface to answer on; resolve per config.
    const auto = this.deps.autoResponse(params);
    if (auto) return Promise.resolve(auto);

    const sessionId = params.sessionId;
    const stableRequestId = requestId ?? ++this.sequence;
    const key = this.key(sessionId, stableRequestId);
    const request: AcpPermissionRequest = {
      sessionId,
      requestId: stableRequestId,
      threadId: this.deps.findThreadBySessionId(sessionId),
      toolCall: params.toolCall as AcpPermissionRequest["toolCall"],
      options: (params.options ?? []).map((opt) => ({
        optionId: opt.optionId,
        name: opt.name,
        kind: opt.kind,
      })),
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(key);
        if (!pending) return;
        const allow = request.options.find((o) => o.kind === "allow_once") ?? request.options[0];
        this.pending.delete(key);
        if (allow) {
          resolve({
            outcome: { outcome: "selected", optionId: allow.optionId },
          });
        } else {
          resolve({ outcome: { outcome: "cancelled" } });
        }
        this.deps.emit({ type: "permission-resolved", sessionId, requestId: stableRequestId });
      }, PERMISSION_TIMEOUT_MS);
      const displaced = this.pending.get(key);
      if (displaced) {
        clearTimeout(displaced.timer);
        displaced.resolve({ outcome: { outcome: "cancelled" } });
        this.deps.emit({ type: "permission-resolved", sessionId, requestId: stableRequestId });
      }
      this.pending.set(key, { resolve, request, timer });
      this.deps.emit({ type: "permission-request", request });
      // An agent blocked on permissions while the user is away is dead time;
      // the in-app prompt cannot be seen, so escalate to the OS.
      this.deps.notifyIfHidden({
        kind: "permission-required",
        threadTitle: this.deps.threadDisplayTitle(request.threadId),
        detail:
          typeof (params.toolCall as { title?: string } | null | undefined)?.title === "string"
            ? (params.toolCall as { title: string }).title
            : undefined,
      });
    });
  }

  async respond(response: {
    sessionId: string;
    requestId?: string | number;
    optionId?: string;
    cancelled?: boolean;
  }): Promise<void> {
    const key =
      response.requestId == null
        ? [...this.pending.entries()].find(
            ([, pending]) => pending.request.sessionId === response.sessionId,
          )?.[0]
        : this.key(response.sessionId, response.requestId);
    const pending = key ? this.pending.get(key) : undefined;
    if (!pending) return;
    this.pending.delete(key!);
    clearTimeout(pending.timer);
    if (response.cancelled || !response.optionId) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      pending.resolve({
        outcome: { outcome: "selected", optionId: response.optionId },
      });
    }
    this.deps.emit({
      type: "permission-resolved",
      sessionId: response.sessionId,
      requestId: pending.request.requestId,
    });
  }

  cancelForSession(sessionId: string | null | undefined): void {
    for (const [key, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId) continue;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.resolve({ outcome: { outcome: "cancelled" } });
      this.deps.emit({
        type: "permission-resolved",
        sessionId: pending.request.sessionId,
        requestId: pending.request.requestId,
      });
    }
  }

  cancelAll(): void {
    for (const sessionId of new Set(
      [...this.pending.values()].map((pending) => pending.request.sessionId),
    )) {
      this.cancelForSession(sessionId);
    }
  }
}
