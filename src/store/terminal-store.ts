import { create } from "zustand";

export interface TerminalSession {
  id: string;
  title: string;
  cwd?: string;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  createSession: (cwd?: string) => void;
  closeSession: (id: string) => void;
  setActiveSessionId: (id: string | null) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  createSession: (cwd?: string) => {
    const id = crypto.randomUUID();
    const sessionCount = get().sessions.length + 1;
    const title = `Terminal ${sessionCount}`;
    const newSession: TerminalSession = { id, title, cwd };

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
      nextActiveId = filteredSessions.length > 0 ? filteredSessions[filteredSessions.length - 1].id : null;
    }

    set({
      sessions: filteredSessions,
      activeSessionId: nextActiveId,
    });
  },

  setActiveSessionId: (id: string | null) => {
    set({ activeSessionId: id });
  },
}));
