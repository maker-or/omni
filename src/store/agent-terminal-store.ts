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
    set((s) => {
      // Limit accumulated output size to 200,000 chars to avoid unbounded memory
      // growth on long-lived sessions (mirrors terminal-store.ts's appendHistory).
      let next = append ? (s.outputs[terminalId] ?? "") + output : output;
      if (next.length > 200000) {
        next = next.slice(next.length - 100000);
      }
      return {
        outputs: {
          ...s.outputs,
          [terminalId]: next,
        },
      };
    });
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
