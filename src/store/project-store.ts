import { create } from "zustand";
import type { Project } from "../../contracts/projects.ts";

interface ProjectState {
  activeProject: Project | null;
  isLoading: boolean;
  error: string | null;
  loadActiveProject: () => Promise<void>;
  clearActiveProject: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeProject: null,
  isLoading: false,
  error: null,
  loadActiveProject: async () => {
    set({ isLoading: true, error: null });
    try {
      const project = await window.omni.projects.getActive();
      set({ activeProject: project, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load active project",
        isLoading: false,
      });
    }
  },
  clearActiveProject: () => set({ activeProject: null }),
}));
