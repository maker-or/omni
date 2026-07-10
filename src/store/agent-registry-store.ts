import { create } from "zustand";
import type { AcpAgentDescriptor } from "../../contracts/acp.ts";

interface AgentRegistryState {
  agents: AcpAgentDescriptor[];
  selectedAgentIds: string[];
  connectionState: "idle" | "connecting" | "connected" | "error";
  authRequiredMessage: string | null;
  error: string | null;
  load: () => Promise<void>;
  toggleAgent: (agentId: string) => Promise<void>;
  setSelectedAgents: (agentIds: string[]) => Promise<void>;
}

export const useAgentRegistryStore = create<AgentRegistryState>((set, get) => ({
  agents: [],
  selectedAgentIds: [],
  connectionState: "idle",
  authRequiredMessage: null,
  error: null,

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
}));
