import { create } from "zustand";
import type {
  AcpAgentInstance,
  AcpAgentInstanceInput,
  AgentAccountSchema,
} from "../../contracts/acp.ts";

interface AgentInstancesState {
  instances: AcpAgentInstance[];
  schemas: AgentAccountSchema[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: AcpAgentInstanceInput) => Promise<AcpAgentInstance>;
  update: (id: string, input: Partial<AcpAgentInstanceInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  launchLogin: (id: string) => Promise<{ command: string; opened: boolean }>;
}

/**
 * Provider accounts/instances. One default instance per driver (id === driver
 * id) always exists; additional accounts are user-created and carry their own
 * environment (e.g. an isolated CODEX_HOME).
 */
export const useAgentInstancesStore = create<AgentInstancesState>((set, get) => ({
  instances: [],
  schemas: [],
  loading: false,
  error: null,

  load: async () => {
    if (!window.omni?.agent?.listInstances) return;
    set({ loading: true, error: null });
    try {
      const [instances, schemas] = await Promise.all([
        window.omni.agent.listInstances(),
        window.omni.agent.getAccountSchemas?.() ?? Promise.resolve([]),
      ]);
      set({ instances, schemas, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load accounts",
      });
    }
  },

  create: async (input) => {
    try {
      const created = await window.omni.agent.createInstance(input);
      await get().load();
      return created;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to add account" });
      throw err;
    }
  },

  update: async (id, input) => {
    try {
      await window.omni.agent.updateInstance(id, input);
      await get().load();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to update account" });
      throw err;
    }
  },

  remove: async (id) => {
    try {
      await window.omni.agent.deleteInstance(id);
      await get().load();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to remove account" });
      throw err;
    }
  },

  launchLogin: async (id) => window.omni.agent.launchInstanceLogin(id),
}));

// Accounts are managed from the Settings window but consumed by every window
// (the main window's composer picker). Reload on a cross-window change so a
// newly added or removed account shows up without a restart.
if (typeof window !== "undefined" && window.omni?.agent?.onInstancesChanged) {
  window.omni.agent.onInstancesChanged(() => {
    void useAgentInstancesStore.getState().load();
  });
}
