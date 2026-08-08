import { create } from "zustand";

export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
  status: "starting" | "running" | "exited" | "error";
  exitCode?: number;
  exitSignal?: number;
  history: string;
}

/** Stashed shape of a session whose PTY was killed when its workspace left view. */
interface StashedTerminalSession {
  id: string;
  title: string;
  history: string;
}

const MAX_HISTORY_CHARS = 200_000;
const MAX_STASHED_WORKSPACES = 10;

/**
 * Scrollback is recovery data, not a serialized VT state. Remove terminal
 * control sequences before retaining it so restoring a killed workspace can
 * never start replay in the middle of an ANSI/OSC sequence.
 */
export function toPlainTerminalHistory(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      const sequenceType = value[index + 1];
      index += 1;

      if (sequenceType === "[") {
        while (index + 1 < value.length) {
          const nextCode = value.charCodeAt(index + 1);
          index += 1;
          if (nextCode >= 0x40 && nextCode <= 0x7e) break;
        }
      } else if (sequenceType === "]" || sequenceType === "P") {
        while (index + 1 < value.length) {
          const nextCode = value.charCodeAt(index + 1);
          index += 1;
          if (nextCode === 0x07) break;
          if (nextCode === 0x1b && value[index + 1] === "\\") {
            index += 1;
            break;
          }
        }
      } else {
        const sequenceTypeCode = sequenceType?.charCodeAt(0) ?? 0;
        if (sequenceTypeCode < 0x30 || sequenceTypeCode > 0x7e) {
          while (index + 1 < value.length) {
            const nextCode = value.charCodeAt(index + 1);
            index += 1;
            if (nextCode >= 0x30 && nextCode <= 0x7e) break;
          }
        }
      }
      continue;
    }

    if (code === 0x0d && value.charCodeAt(index + 1) !== 0x0a) continue;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      continue;
    }
    result += value[index];
  }

  return result;
}

export function appendBoundedTerminalHistory(history: string, data: string): string {
  const combined = history + toPlainTerminalHistory(data);
  if (combined.length <= MAX_HISTORY_CHARS) return combined;

  const target = combined.length - MAX_HISTORY_CHARS;
  const nextLine = combined.indexOf("\n", target);
  return combined.slice(nextLine >= 0 ? nextLine + 1 : target);
}

/** Bucket identity for terminal sessions: one bucket per (project, workspace). */
export function makeWorkspaceKey(projectId: string, workspacePath: string): string {
  return `${projectId}\u0000${workspacePath}`;
}

interface TerminalState {
  sessions: TerminalSession[];
  /** Which (project, workspace) bucket the visible sessions belong to. */
  workspaceKey: string | null;
  /** Sessions of workspaces the user navigated away from, restorable on return. */
  stashByWorkspace: Record<string, StashedTerminalSession[]>;
  nextSessionNumber: number;
  /** Changes only when tab metadata changes, never for ordinary PTY output. */
  tabsRevision: number;
  listenerInitialized: boolean;
  createSession: (cwd?: string) => string;
  closeSession: (id: string) => string | null;
  clearSessions: () => void;
  /**
   * Enter a workspace's terminal bucket: kill the visible PTYs (stashing their
   * titles + scrollback under the old bucket) and recreate the target bucket's
   * sessions with fresh PTYs in the workspace cwd, scrollback restored.
   * Returns the restored active session id, or null when the bucket is empty.
   */
  setWorkspace: (key: string, cwd: string) => string | null;
  appendHistory: (id: string, data: string) => void;
  markRunning: (id: string) => void;
  markError: (id: string) => void;
  initializeGlobalListener: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  workspaceKey: null,
  stashByWorkspace: {},
  nextSessionNumber: 1,
  tabsRevision: 0,
  listenerInitialized: false,

  createSession: (cwd?: string) => {
    const { nextSessionNumber, sessions, tabsRevision } = get();
    const id = `terminal:${crypto.randomUUID()}`;
    const title = `Terminal ${nextSessionNumber}`;
    const newSession: TerminalSession = {
      id,
      title,
      cwd,
      status: "starting",
      history: "",
    };

    set({
      sessions: [newSession, ...sessions],
      nextSessionNumber: nextSessionNumber + 1,
      tabsRevision: tabsRevision + 1,
    });
    return id;
  },

  closeSession: (id: string) => {
    const { sessions, tabsRevision } = get();
    if (!sessions.some((session) => session.id === id)) return sessions[0]?.id ?? null;

    // Notify the backend to clean up the process
    if (window.omni?.terminal?.kill) {
      void window.omni.terminal.kill(id);
    }

    const filteredSessions = sessions.filter((s) => s.id !== id);

    set({
      sessions: filteredSessions,
      tabsRevision: tabsRevision + 1,
    });
    return filteredSessions[0]?.id ?? null;
  },

  clearSessions: () => {
    const { sessions } = get();
    if (window.omni?.terminal?.kill) {
      for (const session of sessions) {
        void window.omni.terminal.kill(session.id);
      }
    }
    set({
      sessions: [],
      tabsRevision: get().tabsRevision + 1,
    });
  },

  setWorkspace: (key, cwd) => {
    const { sessions, workspaceKey, stashByWorkspace } = get();
    if (workspaceKey === key) return sessions[0]?.id ?? null;

    // No shell may keep running in a workspace that left view.
    if (window.omni?.terminal?.kill) {
      for (const session of sessions) {
        void window.omni.terminal.kill(session.id);
      }
    }

    const nextStash = { ...stashByWorkspace };
    if (workspaceKey !== null && sessions.length > 0) {
      nextStash[workspaceKey] = sessions.map((session) => ({
        id: session.id,
        title: session.title,
        history: session.history,
      }));
    } else if (workspaceKey !== null) {
      delete nextStash[workspaceKey];
    }

    // Restore the target bucket with fresh PTYs while preserving tab identity.
    const restored = (nextStash[key] ?? []).map((stashed) => ({
      id: stashed.id,
      title: stashed.title,
      cwd,
      status: "starting" as const,
      history: stashed.history,
    }));
    delete nextStash[key];
    const stashKeys = Object.keys(nextStash);
    while (stashKeys.length > MAX_STASHED_WORKSPACES) {
      const oldest = stashKeys.shift();
      if (oldest) delete nextStash[oldest];
    }

    const newActiveId = restored[0]?.id ?? null;
    set({
      sessions: restored,
      workspaceKey: key,
      stashByWorkspace: nextStash,
      tabsRevision: get().tabsRevision + 1,
    });
    return newActiveId;
  },

  appendHistory: (id: string, data: string) => {
    set((state) => {
      const index = state.sessions.findIndex((session) => session.id === id);
      if (index < 0) return {};
      const sessions = [...state.sessions];
      const session = sessions[index];
      sessions[index] = {
        ...session,
        history: appendBoundedTerminalHistory(session.history, data),
      };
      return { sessions };
    });
  },

  markRunning: (id) => {
    set((state) => {
      const index = state.sessions.findIndex((session) => session.id === id);
      if (index < 0 || state.sessions[index]?.status === "running") return {};
      const sessions = [...state.sessions];
      sessions[index] = {
        ...sessions[index],
        status: "running",
        exitCode: undefined,
        exitSignal: undefined,
      };
      return { sessions, tabsRevision: state.tabsRevision + 1 };
    });
  },

  markError: (id) => {
    set((state) => {
      const index = state.sessions.findIndex((session) => session.id === id);
      if (index < 0 || state.sessions[index]?.status === "error") return {};
      const sessions = [...state.sessions];
      sessions[index] = { ...sessions[index], status: "error" };
      return { sessions, tabsRevision: state.tabsRevision + 1 };
    });
  },

  initializeGlobalListener: () => {
    if (get().listenerInitialized) return;
    if (!window.omni?.terminal?.onData) return;

    window.omni.terminal.onData((payload) => {
      get().appendHistory(payload.sessionId, payload.data);
    });
    window.omni.terminal.onExit?.((payload) => {
      set((state) => {
        const index = state.sessions.findIndex((session) => session.id === payload.sessionId);
        if (index < 0) return {};
        const sessions = [...state.sessions];
        const session = sessions[index];
        const completion = `\r\n[Process completed (exit ${payload.exitCode})]\r\n`;
        sessions[index] = {
          ...session,
          status: "exited",
          exitCode: payload.exitCode,
          exitSignal: payload.signal,
          history: appendBoundedTerminalHistory(session.history, completion),
        };
        return { sessions, tabsRevision: state.tabsRevision + 1 };
      });
    });
    set({ listenerInitialized: true });
  },
}));
