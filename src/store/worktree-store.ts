import { create } from "zustand";
import type { GitBranch, Worktree } from "../../contracts/worktrees.ts";
import type { Thread } from "../../contracts/threads.ts";

interface WorktreeState {
  /** Worktrees for the currently-loaded project, including its main tree. */
  worktrees: Worktree[];
  branches: GitBranch[];
  projectId: string | null;
  branchProjectId: string | null;
  /** Active workspace target by project. The project root is stored as its path. */
  selectedWorktreePathByProject: Record<string, string>;
  isLoading: boolean;
  isCreating: boolean;
  isSwitching: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  error: string | null;
  lastWorktreeRequest: string | null;
  lastBranchRequest: string | null;
  loadWorktrees: (projectId: string) => Promise<void>;
  loadBranches: (projectId: string) => Promise<void>;
  createWorktree: (projectId: string, name: string) => Promise<Worktree | null>;
  switchWorktree: (projectId: string, path: string) => Promise<Thread | null>;
  switchBranch: (projectId: string, path: string, branch: string) => Promise<Worktree | null>;
  selectWorktree: (projectId: string, path: string) => void;
  clear: () => void;
}

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  worktrees: [],
  branches: [],
  projectId: null,
  branchProjectId: null,
  selectedWorktreePathByProject: {},
  isLoading: false,
  isCreating: false,
  isSwitching: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  error: null,
  lastWorktreeRequest: null,
  lastBranchRequest: null,
  loadWorktrees: async (projectId) => {
    const requestToken = `${projectId}-${Date.now()}`;
    set({ isLoading: true, error: null, lastWorktreeRequest: requestToken });
    try {
      const worktrees = await window.omni.worktrees.list(projectId);
      // Only apply if this request is still current
      if (get().lastWorktreeRequest === requestToken) {
        set({ worktrees, projectId, isLoading: false });
      }
    } catch (err) {
      // Only apply if this request is still current
      if (get().lastWorktreeRequest === requestToken) {
        set({
          error: err instanceof Error ? err.message : "Failed to load worktrees",
          isLoading: false,
        });
      }
    }
  },
  createWorktree: async (projectId, name) => {
    set({ isCreating: true, error: null });
    try {
      const worktree = await window.omni.worktrees.create({ projectId, name });
      set((state) => ({
        worktrees: state.projectId === projectId ? [...state.worktrees, worktree] : state.worktrees,
        isCreating: false,
      }));
      return worktree;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create worktree",
        isCreating: false,
      });
      return null;
    }
  },
  loadBranches: async (projectId) => {
    const requestToken = `${projectId}-${Date.now()}`;
    set({ isLoadingBranches: true, error: null, lastBranchRequest: requestToken });
    try {
      const branches = await window.omni.worktrees.listBranches({ projectId });
      // Only apply if this request is still current
      if (get().lastBranchRequest === requestToken) {
        set({ branches, branchProjectId: projectId, isLoadingBranches: false });
      }
    } catch (err) {
      // Only apply if this request is still current
      if (get().lastBranchRequest === requestToken) {
        set({
          error: err instanceof Error ? err.message : "Failed to load branches",
          isLoadingBranches: false,
        });
      }
    }
  },
  switchWorktree: async (projectId, path) => {
    set({ isSwitching: true, error: null });
    try {
      const thread = await window.omni.worktrees.switch({ projectId, path });
      set((state) => ({
        isSwitching: false,
        selectedWorktreePathByProject: {
          ...state.selectedWorktreePathByProject,
          [projectId]: path,
        },
      }));
      return thread;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to switch worktree",
        isSwitching: false,
      });
      return null;
    }
  },
  switchBranch: async (projectId, path, branch) => {
    set({ isSwitchingBranch: true, error: null });
    try {
      const { worktree } = await window.omni.worktrees.switchBranch({ projectId, path, branch });
      set((state) => ({
        isSwitchingBranch: false,
        worktrees:
          state.projectId === projectId
            ? state.worktrees.map((item) => (item.path === path ? worktree : item))
            : state.worktrees,
        branches:
          state.branchProjectId === projectId
            ? state.branches.map((item) =>
                item.name === branch
                  ? { ...item, worktreePath: worktree.path }
                  : item.worktreePath === worktree.path
                    ? { ...item, worktreePath: null }
                    : item,
              )
            : state.branches,
        selectedWorktreePathByProject: {
          ...state.selectedWorktreePathByProject,
          [projectId]: path,
        },
      }));
      return worktree;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to switch branches",
        isSwitchingBranch: false,
      });
      return null;
    }
  },
  selectWorktree: (projectId, path) =>
    set((state) => ({
      selectedWorktreePathByProject: { ...state.selectedWorktreePathByProject, [projectId]: path },
    })),
  clear: () =>
    set({ worktrees: [], branches: [], projectId: null, branchProjectId: null, error: null }),
}));
