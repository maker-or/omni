import { create } from "zustand";
import type { AcpAgentDescriptor, AgentProbeResult } from "../../contracts/acp.ts";

interface AgentRegistryState {
  agents: AcpAgentDescriptor[];
  selectedAgentIds: string[];
  connectionState: "idle" | "connecting" | "connected" | "error";
  authRequiredMessage: string | null;
  error: string | null;
  /** Real handshake probe outcome per agent id, from the last `probeAgents` run. */
  probeResults: Record<string, AgentProbeResult>;
  /** Agent ids whose setup step the user dismissed for now (still selected, just not nagged). */
  skippedAgentIds: string[];
  /** True once the user hit "Skip setup" — bypasses the walkthrough entirely. */
  setupSkipped: boolean;
  load: () => Promise<void>;
  toggleAgent: (agentId: string) => Promise<void>;
  setSelectedAgents: (agentIds: string[]) => Promise<void>;
  /** Probes every given agent id in parallel; updates `probeResults` as each resolves. */
  probeAgents: (agentIds: string[]) => Promise<void>;
  skipAgentSetup: (agentId: string) => void;
  skipAllSetup: () => void;
  resetSetupWalkthrough: () => void;
}

export const useAgentRegistryStore = create<AgentRegistryState>((set, get) => ({
  agents: [],
  selectedAgentIds: [],
  connectionState: "idle",
  authRequiredMessage: null,
  error: null,
  probeResults: {},
  skippedAgentIds: [],
  setupSkipped: false,

  load: async () => {
    if (!window.omni?.agent?.listAgents) {
      set({ agents: [], connectionState: "idle" });
      return;
    }
    try {
      const agents = await window.omni.agent.listAgents();
      const selectedIds = window.omni.agent.getSelectedAgentIds
        ? await window.omni.agent.getSelectedAgentIds()
        : [];
      set({
        agents,
        selectedAgentIds: selectedIds,
        error: null,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to list agents",
      });
    }
  },

  toggleAgent: async (agentId: string) => {
    const current = get().selectedAgentIds;
    const next = current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId];
    set({ selectedAgentIds: next });
    try {
      await window.omni.agent.setSelectedAgentIds?.(next);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to save selected agents",
      });
    }
  },

  setSelectedAgents: async (agentIds: string[]) => {
    set({ connectionState: "connecting", error: null, selectedAgentIds: agentIds });
    try {
      if (window.omni.agent.setSelectedAgentIds) {
        await window.omni.agent.setSelectedAgentIds(agentIds);
      }
      set({ connectionState: "connected", error: null });
    } catch (err) {
      set({
        connectionState: "error",
        error: err instanceof Error ? err.message : "Failed to save selected agents",
      });
    }
  },

  probeAgents: async (agentIds: string[]) => {
    if (!window.omni?.agent?.probeAgent || agentIds.length === 0) return;
    set((state) => ({
      probeResults: {
        ...state.probeResults,
        ...Object.fromEntries(
          agentIds.map((agentId) => [agentId, { agentId, status: "probing" as const }]),
        ),
      },
    }));
    await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          const result = await window.omni.agent.probeAgent(agentId);
          set((state) => ({ probeResults: { ...state.probeResults, [agentId]: result } }));
        } catch (err) {
          set((state) => ({
            probeResults: {
              ...state.probeResults,
              [agentId]: {
                agentId,
                status: "error",
                message: err instanceof Error ? err.message : "Failed to check agent status",
              },
            },
          }));
        }
      }),
    );
  },

  skipAgentSetup: (agentId: string) => {
    set((state) =>
      state.skippedAgentIds.includes(agentId)
        ? state
        : { skippedAgentIds: [...state.skippedAgentIds, agentId] },
    );
  },

  skipAllSetup: () => {
    set({ setupSkipped: true });
  },

  resetSetupWalkthrough: () => {
    set({ probeResults: {}, skippedAgentIds: [], setupSkipped: false });
  },
}));
