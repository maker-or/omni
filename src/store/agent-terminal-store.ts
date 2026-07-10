/**
 * Accumulates ACP agent-spawned terminal output (distinct from user interactive terminals).
 * Single-writer: only agent-store.connect() feeds this via applyTerminalOutput.
 * Components read outputs; they do not register IPC listeners.
 */
import { create } from "zustand";

interface AgentTerminalState {
  /** terminalId → accumulated output */
  outputs: Record<string, string>;
  exitCodes: Record<string, number | null>;
  /** Apply one terminal-output bridge event (append or replace). */
  applyTerminalOutput: (terminalId: string, output: string, append: boolean) => void;
  getOutput: (terminalId: string) => string;
  clear: (terminalId: string) => void;
  reset: () => void;
}

export const useAgentTerminalStore = create<AgentTerminalState>((set, get) => ({
  outputs: {},
  exitCodes: {},

  applyTerminalOutput: (terminalId, output, append) => {
    set((s) => ({
      outputs: {
        ...s.outputs,
        [terminalId]: append ? (s.outputs[terminalId] ?? "") + output : output,
      },
    }));
  },

  getOutput: (terminalId) => get().outputs[terminalId] ?? "",

  clear: (terminalId) => {
    set((s) => {
      const outputs = { ...s.outputs };
      delete outputs[terminalId];
      const exitCodes = { ...s.exitCodes };
      delete exitCodes[terminalId];
      return { outputs, exitCodes };
    });
  },

  reset: () => set({ outputs: {}, exitCodes: {} }),
}));
