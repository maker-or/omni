import { create } from "zustand";

export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
  history: string;
}

/** Stashed shape of a session whose PTY was killed when its workspace left view. */
interface StashedTerminalSession {
  title: string;
  history: string;
}

/** Bucket identity for terminal sessions: one bucket per (project, workspace). */
export function makeWorkspaceKey(projectId: string, workspacePath: string): string {
  return `${projectId}\u0000${workspacePath}`;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  /** Which (project, workspace) bucket the visible sessions belong to. */
  workspaceKey: string | null;
  /** Sessions of workspaces the user navigated away from, restorable on return. */
  stashByWorkspace: Record<string, StashedTerminalSession[]>;
  listenerInitialized: boolean;
  createSession: (cwd?: string) => string;
  closeSession: (id: string) => void;
  clearSessions: () => void;
  /**
   * Enter a workspace's terminal bucket: kill the visible PTYs (stashing their
   * titles + scrollback under the old bucket) and recreate the target bucket's
   * sessions with fresh PTYs in the workspace cwd, scrollback restored.
   * Returns the restored active session id, or null when the bucket is empty.
   */
  setWorkspace: (key: string, cwd: string) => string | null;
  setActiveSessionId: (id: string | null) => void;
  appendHistory: (id: string, data: string) => void;
  initializeGlobalListener: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  workspaceKey: null,
  stashByWorkspace: {},
  listenerInitialized: false,

  createSession: (cwd?: string) => {
    const id = crypto.randomUUID();
    const sessionCount = get().sessions.length + 1;
    const title = `Terminal ${sessionCount}`;
    const newSession: TerminalSession = { id, title, cwd, history: "" };

    set({
      sessions: [newSession, ...get().sessions],
      activeSessionId: id,
    });
    return id;
  },

  closeSession: (id: string) => {
    // Notify the backend to clean up the process
    if (window.omni?.terminal?.kill) {
      window.omni.terminal.kill(id);
    }

    const { sessions, activeSessionId } = get();
    const filteredSessions = sessions.filter((s) => s.id !== id);

    let nextActiveId = activeSessionId;
    if (activeSessionId === id) {
      nextActiveId = filteredSessions.length > 0 ? filteredSessions[0].id : null;
    }

    set({
      sessions: filteredSessions,
      activeSessionId: nextActiveId,
    });
  },

  clearSessions: () => {
    const { sessions } = get();
    if (window.omni?.terminal?.kill) {
      for (const session of sessions) {
        window.omni.terminal.kill(session.id);
      }
    }
    set({
      sessions: [],
      activeSessionId: null,
    });
  },

  setWorkspace: (key, cwd) => {
    const { sessions, activeSessionId, workspaceKey, stashByWorkspace } = get();
    if (workspaceKey === key) return activeSessionId;

    // No shell may keep running in a workspace that left view.
    if (window.omni?.terminal?.kill) {
      for (const session of sessions) {
        window.omni.terminal.kill(session.id);
      }
    }

    const nextStash = { ...stashByWorkspace };
    if (workspaceKey !== null && sessions.length > 0) {
      nextStash[workspaceKey] = sessions.map((session) => ({
        title: session.title,
        history: session.history,
      }));
    } else if (workspaceKey !== null) {
      delete nextStash[workspaceKey];
    }

    // Restore the target bucket with fresh PTYs (ids change; scrollback kept).
    const restored = (nextStash[key] ?? []).map((stashed) => ({
      id: crypto.randomUUID(),
      title: stashed.title,
      cwd,
      history: stashed.history,
    }));
    delete nextStash[key];

    const newActiveId = restored[0]?.id ?? null;
    set({
      sessions: restored,
      activeSessionId: newActiveId,
      workspaceKey: key,
      stashByWorkspace: nextStash,
    });
    return newActiveId;
  },

  setActiveSessionId: (id: string | null) => {
    set({ activeSessionId: id });
  },

  appendHistory: (id: string, data: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== id) return s;
        // Limit history string size to 200,000 chars to avoid memory issues
        let newHistory = s.history + data;
        if (newHistory.length > 200000) {
          newHistory = newHistory.slice(newHistory.length - 100000);
        }
        return { ...s, history: newHistory };
      }),
    }));
  },

  initializeGlobalListener: () => {
    if (get().listenerInitialized) return;
    if (window.omni?.terminal?.onData) {
      window.omni.terminal.onData((payload) => {
        get().appendHistory(payload.sessionId, payload.data);
      });
      set({ listenerInitialized: true });
    }
  },
}));
