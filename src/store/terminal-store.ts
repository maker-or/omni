import { create } from "zustand";

export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
  history: string;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  listenerInitialized: boolean;
  createSession: (cwd?: string) => void;
  closeSession: (id: string) => void;
  clearSessions: () => void;
  setActiveSessionId: (id: string | null) => void;
  appendHistory: (id: string, data: string) => void;
  initializeGlobalListener: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  listenerInitialized: false,

  createSession: (cwd?: string) => {
    const id = crypto.randomUUID();
    const sessionCount = get().sessions.length + 1;
    const title = `Terminal ${sessionCount}`;
    const newSession: TerminalSession = { id, title, cwd, history: "" };

    set({
      sessions: [...get().sessions, newSession],
      activeSessionId: id,
    });
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
      nextActiveId =
        filteredSessions.length > 0 ? filteredSessions[filteredSessions.length - 1].id : null;
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
