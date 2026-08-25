import type { AcpSessionSlice } from "../src/lib/acp-session-reducer.ts";
import { SessionRetentionTracker } from "../src/lib/session-retention.ts";
import type { ToolCallPayload } from "../src/lib/tool-call-payload.ts";

export interface ThreadSessionRuntime {
  threadId: string;
  agentSessionId: string;
  /** Which agent process owns this session. */
  agentId: string;
  projectId: string;
  cwd: string;
  slice: AcpSessionSlice;
  editorText: string;
  /**
   * True only between a client-initiated prompt request being sent and its
   * response resolving. `isStreaming` (which drives the composer's stop button
   * and the tab's working indicator) is set true by every agent chunk/tool_call
   * in `applySessionUpdate`, but is only cleared by `applyTurnStop` when the
   * prompt request resolves. Without this flag, a `session/update` that arrives
   * after the turn ends — a late flush, or an agent streaming background work
   * out-of-band — would flip `isStreaming` back to true with nothing left to
   * clear it, sticking the loader forever. Updates outside an active turn are
   * clamped to non-streaming in `handleSessionUpdate`.
   */
  promptInFlight: boolean;
  activeTurnId: string | null;
  monitorUpdateCount: number;
  /** Full tool bodies parked off the lean session slice. Lazily created. */
  toolPayloads?: Map<string, ToolCallPayload>;
  /** Retention accounting. Lazily created (replay defers it). */
  retention?: SessionRetentionTracker;
  /**
   * Tool-call record already sent to the renderer (via thread-tool-calls or a
   * session-state snapshot). The record is only re-broadcast when its
   * reference changes, so message-chunk updates don't ship the full
   * accumulated tool payload over IPC on every streamed chunk.
   */
  emittedToolCalls: AcpSessionSlice["toolCalls"] | null;
  /**
   * Tool-call record seen by the last payload-sync pass. Orphaned-payload
   * cleanup is only needed when the reducer REPLACED the record (trim);
   * chunk updates keep it reference-equal, so the scan skips them entirely.
   */
  lastSyncedToolCalls?: AcpSessionSlice["toolCalls"] | null;
}

/**
 * Cached agent sessions keyed by thread, plus a reverse index from ACP session
 * id to thread so the hot path (`handleSessionUpdate`, permission requests)
 * resolves in O(1) instead of scanning every cached session.
 *
 * The reverse index is the reason this class exists: `agentSessionId` mutates
 * after registration (switchThreadCore rebinds through load→resume→new), and a
 * plain side map maintained by hand would silently drift from the runtimes.
 * All mutation must go through register/rebind/remove/clear.
 *
 * Collision policy (session id already mapped to another thread — should never
 * happen since session/new mints unique ids): registration keeps the FIRST
 * owner, matching the insertion-order scan this index replaced; an explicit
 * rebind honors the caller and displaces the stale owner. Both warn.
 */
export class ThreadSessionRegistry {
  private readonly byThread = new Map<string, ThreadSessionRuntime>();
  private readonly threadIdBySession = new Map<string, string>();

  get size(): number {
    return this.byThread.size;
  }

  has(threadId: string): boolean {
    return this.byThread.has(threadId);
  }

  get(threadId: string): ThreadSessionRuntime | undefined {
    return this.byThread.get(threadId);
  }

  values(): IterableIterator<ThreadSessionRuntime> {
    return this.byThread.values();
  }

  entries(): IterableIterator<[string, ThreadSessionRuntime]> {
    return this.byThread.entries();
  }

  keys(): IterableIterator<string> {
    return this.byThread.keys();
  }

  /** Resolve the owning thread for an ACP session update. Hot path. */
  threadIdForSession(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return this.threadIdBySession.get(sessionId) ?? null;
  }

  register(runtime: ThreadSessionRuntime): void {
    const existingOwner = this.threadIdBySession.get(runtime.agentSessionId);
    if (existingOwner != null && existingOwner !== runtime.threadId) {
      console.warn(
        `[sessions] agent session ${runtime.agentSessionId} already owned by thread ${existingOwner}; keeping first owner`,
      );
    } else {
      this.threadIdBySession.set(runtime.agentSessionId, runtime.threadId);
    }
    this.byThread.set(runtime.threadId, runtime);
  }

  /**
   * Point the runtime (and the index) at a new session id after the
   * load→resume→new chain settles. No-op for unknown threads so callers can
   * invoke it unconditionally on a runtime they just mutated.
   */
  rebindSession(threadId: string, newSessionId: string): void {
    const runtime = this.byThread.get(threadId);
    if (!runtime) return;
    const oldSessionId = runtime.agentSessionId;
    if (oldSessionId === newSessionId) return;
    if (this.threadIdBySession.get(oldSessionId) === threadId) {
      this.threadIdBySession.delete(oldSessionId);
    }
    const displaced = this.threadIdBySession.get(newSessionId);
    if (displaced != null && displaced !== threadId) {
      console.warn(
        `[sessions] rebind displaces session ${newSessionId} owner ${displaced} with thread ${threadId}`,
      );
    }
    this.threadIdBySession.set(newSessionId, threadId);
    runtime.agentSessionId = newSessionId;
  }

  remove(threadId: string): boolean {
    const runtime = this.byThread.get(threadId);
    if (!runtime) return false;
    if (this.threadIdBySession.get(runtime.agentSessionId) === threadId) {
      this.threadIdBySession.delete(runtime.agentSessionId);
    }
    return this.byThread.delete(threadId);
  }

  clear(): void {
    this.byThread.clear();
    this.threadIdBySession.clear();
  }
}
