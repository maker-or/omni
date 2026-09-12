import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CaretDown,
  CaretRight,
  FunnelSimple,
  FolderPlus,
  GitBranch,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import type { Worktree } from "../../contracts/worktrees.ts";
import { orderWorktreesForDisplay } from "../../contracts/worktrees.ts";
import { AgentView } from "@/components/agent-view";
import { DiffIngestor } from "@/components/diff-ingestor";
import { GlobalTabBar } from "@/components/global-tab-bar";
import { TerminalSession } from "@/components/terminal-session";
import { WorkspaceControlPanel } from "@/components/workspace-control-panel";
import { Toaster } from "@/components/ui/toaster";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { useThreadStore } from "@/store/thread-store";
import { useTerminalStore } from "@/store/terminal-store";
import { useWorktreeStore } from "@/store/worktree-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { cn } from "@/lib/utils";
import { normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";

function WorkspaceNameDialog({
  project,
  isCreating,
  error,
  onCancel,
  onSubmit,
}: {
  project: Project;
  isCreating: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-surface-1 p-5 shadow-surface-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">New workspace</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            Create an isolated workspace in {project.name}.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Workspace name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Fix login redirect"
            className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/50 focus:ring-1 focus:ring-ring"
          />
        </label>
        {error && (
          <p className="mt-3 text-xs leading-5 text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || isCreating}>
            Create workspace
          </Button>
        </div>
      </form>
    </div>
  );
}

function WorkspaceRow({
  worktree,
  selected,
  onSelect,
  onArchive,
  onDelete,
  archived,
}: {
  worktree: Worktree;
  selected: boolean;
  onSelect: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  archived?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = worktree.workspaceName ?? (worktree.isProjectRoot ? "Main" : "Workspace");

  return (
    <div className="relative">
      <button
        type="button"
        data-active={selected ? "true" : undefined}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors duration-80",
          selected
            ? "bg-active font-medium text-foreground"
            : "text-muted-foreground hover:bg-hover hover:text-foreground",
        )}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
      >
        <GitBranch
          size={14}
          weight="duotone"
          className={cn(
            "shrink-0 transition-colors duration-80",
            selected ? "text-foreground" : undefined,
          )}
        />
        <span className="min-w-0 flex-1 truncate">
          {name}
          {selected && <span className="sr-only"> (active workspace)</span>}
        </span>
      </button>
      {menuOpen && (
        <div className="absolute left-2 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-surface-1 p-1 shadow-surface-5">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
            onClick={() => {
              setMenuOpen(false);
              onArchive?.();
            }}
          >
            <Archive size={14} /> {archived ? "Restore workspace" : "Archive workspace"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
            onClick={() => {
              setMenuOpen(false);
              onDelete?.();
            }}
          >
            <Trash size={14} /> Delete workspace
          </button>
        </div>
      )}
    </div>
  );
}

export function AdvancedShell() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const queryClient = useQueryClient();
  const {
    selectedWorktreePathByProject,
    isCreating,
    error: worktreeError,
    loadWorktrees,
    createWorktree,
    switchWorktree,
    syncSelections,
  } = useWorktreeStore();
  const loadProjectThreads = useThreadStore((state) => state.loadProjectThreads);
  const [projects, setProjects] = useState<Project[]>([]);
  const [worktreesByProject, setWorktreesByProject] = useState<Record<string, Worktree[]>>({});
  const [dialogProject, setDialogProject] = useState<Project | null>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(new Set());
  const toggleProjectCollapsed = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  // Collapse every project except the active one so the full project
  // list always fits on screen with no sidebar scrolling — only the
  // active project's workspaces expand.
  useEffect(() => {
    if (projects.length === 0) return;
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      for (const project of projects) {
        if (project.id === activeProject?.id) next.delete(project.id);
        else next.add(project.id);
      }
      return next;
    });
  }, [projects, activeProject?.id]);
  const [archivedKeys, setArchivedKeys] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem("pipper.archived-workspaces") ?? "[]"));
    } catch {
      return new Set();
    }
  });

  const selectedPath = activeProject
    ? normalizeWorkspacePath(selectedWorktreePathByProject[activeProject.id], activeProject.path)
    : null;
  const selectedWorktree = useMemo(() => {
    if (!activeProject || !selectedPath) return null;
    return (
      (worktreesByProject[activeProject.id] ?? []).find(
        (item) => normalizeWorkspacePath(item.path, activeProject.path) === selectedPath,
      ) ?? null
    );
  }, [activeProject, selectedPath, worktreesByProject]);
  const selectedWorkspaceName = useMemo(() => {
    if (!selectedPath) return null;
    if (selectedWorktree && !selectedWorktree.isProjectRoot)
      return selectedWorktree.workspaceName ?? null;
    if (selectedWorktree?.isProjectRoot) return "main";
    return selectedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
  }, [selectedPath, selectedWorktree]);

  useEffect(() => {
    void window.omni.projects
      .list()
      .then((items) => setProjects(items.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setProjects([]));
    const unsubscribe = window.omni.projects.onListChanged?.((project) => {
      setProjects((current) =>
        [...current.filter((item) => item.id !== project.id), project].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (projects.length === 0) return;
    let cancelled = false;
    void Promise.all(
      projects.map(async (project) => {
        try {
          return [project.id, await window.omni.worktrees.list(project.id)] as const;
        } catch {
          return [project.id, [] as Worktree[]] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      // Newest-first for linked worktrees (git order is arbitrary readdir).
      const ordered = Object.fromEntries(
        entries.map(([id, list]) => [id, orderWorktreesForDisplay(list)]),
      );
      setWorktreesByProject(ordered);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    if (!activeProject) return;
    void loadWorktrees(activeProject.id);
    void loadProjectThreads(activeProject.id, { reset: true });
  }, [activeProject?.id, loadProjectThreads, loadWorktrees]);

  const terminalTabsRevision = useTerminalStore((state) => state.tabsRevision);
  const terminalSessions = useMemo(
    () =>
      useTerminalStore.getState().sessions.map((session) => ({ id: session.id, cwd: session.cwd })),
    [terminalTabsRevision],
  );
  const workspaceMode = useWorkspaceViewStore((state) => state.mode);
  const activeTerminalId = useWorkspaceViewStore((state) => state.activeTerminalId);
  const showTerminalView = workspaceMode === "terminal" && activeTerminalId != null;

  const openProject = async (project: Project) => {
    if (project.id !== activeProject?.id) await window.omni.projects.setActive(project.id);
  };

  const createWorkspace = async (name: string) => {
    if (!dialogProject) return;
    const project = dialogProject;
    const worktree = await createWorktree(project.id, name);
    if (!worktree) return;
    setDialogProject(null);
    const thread = await selectWorkspace(project, worktree.path);
    if (thread) {
      await window.omni.threads.rename(thread.id, name);
      void queryClient.invalidateQueries({ queryKey: ["open-tabs"] });
    }
    setWorktreesByProject((current) => {
      const existing = current[project.id] ?? [];
      const withoutDup = existing.filter((item) => item.path !== worktree.path);
      // Newest-first: the fresh worktree carries Date.now(), so it sorts top.
      return { ...current, [project.id]: orderWorktreesForDisplay([worktree, ...withoutDup]) };
    });
    await loadWorktrees(project.id);
  };

  const workspaceKey = (projectId: string, path: string) => `${projectId}:${path}`;
  const persistArchived = (next: Set<string>) => {
    setArchivedKeys(next);
    try {
      window.localStorage.setItem("pipper.archived-workspaces", JSON.stringify([...next]));
    } catch {
      // Keep the current session state when storage is unavailable.
    }
  };
  const archiveWorkspace = async (project: Project, worktree: Worktree) => {
    if (worktree.isProjectRoot) return;
    // Free the disk first (node_modules); the archived flag is only set once
    // that succeeded so a failed cleanup never leaves a "phantom" archive.
    await window.omni.worktrees.archive({ projectId: project.id, path: worktree.path });
    if (project.id === activeProject?.id && worktree.path === selectedPath) {
      await switchWorktree(project.id, project.path);
    }
    const next = new Set(archivedKeys);
    next.add(workspaceKey(project.id, worktree.path));
    persistArchived(next);
  };
  const restoreWorkspace = (project: Project, worktree: Worktree) => {
    const next = new Set(archivedKeys);
    next.delete(workspaceKey(project.id, worktree.path));
    persistArchived(next);
    // Deps were dropped on archive; bring them back in the background.
    void window.omni.worktrees.restore({ projectId: project.id, path: worktree.path });
  };
  /** After "Continue" the worktree is on a new branch — refresh git-derived rows. */
  const reloadWorkspaces = async (project: Project) => {
    const items = await window.omni.worktrees.list(project.id).catch(() => null);
    if (items) setWorktreesByProject((current) => ({ ...current, [project.id]: items }));
    if (project.id === activeProject?.id) await loadWorktrees(project.id);
  };
  const deleteWorkspace = async (project: Project, worktree: Worktree) => {
    if (worktree.isProjectRoot) return;
    if (
      !window.confirm(
        `Delete workspace "${worktree.workspaceName ?? "Workspace"}" and all of its chats?`,
      )
    )
      return;
    await window.omni.worktrees.delete({ projectId: project.id, path: worktree.path });
    const next = new Set(archivedKeys);
    next.delete(workspaceKey(project.id, worktree.path));
    persistArchived(next);
    setWorktreesByProject((current) => ({
      ...current,
      [project.id]: (current[project.id] ?? []).filter((item) => item.path !== worktree.path),
    }));
    await syncSelections();
    if (project.id === activeProject?.id) await loadWorktrees(project.id);
  };

  const selectWorkspace = async (project: Project, path: string) => {
    if (project.id !== activeProject?.id) await window.omni.projects.setActive(project.id);
    return switchWorktree(project.id, path);
  };

  return (
    <SidebarProvider defaultOpen>
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-surface-1 text-foreground">
        <DiffIngestor />
        <Toaster />
        <div className="flex min-h-0 flex-1">
          <Sidebar collapsible="none" bordered={false} rail={false}>
            <SidebarContent className="p-2 pt-12">
              <SidebarMenu>
                {projects.map((project) => {
                  const active = activeProject?.id === project.id;
                  // Canonical workspace identity per project: null means the
                  // project root ("main"). Only the active project can have a
                  // selected worktree; other projects show none highlighted.
                  const projectSelectedPath =
                    project.id === activeProject?.id ? selectedPath : null;
                  const visibleWorktrees = (worktreesByProject[project.id] ?? []).filter(
                    (worktree) => !worktree.isProjectRoot,
                  );
                  const isCollapsed = collapsedProjectIds.has(project.id);
                  return (
                    <SidebarMenuItem key={project.id}>
                      <div className="flex min-w-0 items-center gap-1">
                        {visibleWorktrees.length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0"
                            aria-label={`${isCollapsed ? "Expand" : "Collapse"} workspaces in ${project.name}`}
                            aria-expanded={!isCollapsed}
                            onClick={() => toggleProjectCollapsed(project.id)}
                          >
                            {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                          </Button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <SidebarMenuButton
                            className="w-full min-w-0"
                            isActive={active}
                            onClick={() => void openProject(project)}
                          >
                            <ProjectIcon name={project.icon} className="size-4" />
                            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                              {project.name}
                            </span>
                          </SidebarMenuButton>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          aria-label={`New workspace in ${project.name}`}
                          onClick={() => setDialogProject(project)}
                        >
                          <Plus size={16} />
                        </Button>
                      </div>
                      {isCollapsed ? null : (
                        <div className="mt-1 flex flex-col gap-0.5 pl-2">
                          {visibleWorktrees
                            .filter(
                              (worktree) =>
                                !archivedKeys.has(workspaceKey(project.id, worktree.path)),
                            )
                            .map((worktree) => (
                              <WorkspaceRow
                                key={worktree.path}
                                worktree={worktree}
                                selected={worktree.path === projectSelectedPath}
                                onSelect={() => void selectWorkspace(project, worktree.path)}
                                onArchive={() => void archiveWorkspace(project, worktree)}
                                onDelete={() => void deleteWorkspace(project, worktree)}
                              />
                            ))}
                          {visibleWorktrees
                            .filter((worktree) =>
                              archivedKeys.has(workspaceKey(project.id, worktree.path)),
                            )
                            .map((worktree) => (
                              <WorkspaceRow
                                key={`archived-${worktree.path}`}
                                worktree={worktree}
                                selected={false}
                                archived
                                onSelect={() => void selectWorkspace(project, worktree.path)}
                                onArchive={() => restoreWorkspace(project, worktree)}
                                onDelete={() => void deleteWorkspace(project, worktree)}
                              />
                            ))}
                        </div>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarContent>
            <SidebarFooter className="border-t border-border/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Projects
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Filter projects">
                    <FunnelSimple size={16} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add project"
                    onClick={() => void window.omni.launch.show("add")}
                  >
                    <FolderPlus size={16} />
                  </Button>
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>

          <main className="relative min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-w-0">
              <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex h-12 shrink-0 items-center justify-center bg-surface-1 px-3">
                  <div className="mt-2 w-full max-w-[1000px] px-4">
                    <GlobalTabBar />
                  </div>
                </div>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <AgentView />
                  {terminalSessions.map((session) => {
                    const active = showTerminalView && activeTerminalId === session.id;
                    return (
                      <div
                        key={session.id}
                        className={cn(
                          "absolute inset-0 z-30 bg-surface-1 p-2",
                          active ? "visible" : "invisible pointer-events-none",
                        )}
                      >
                        <TerminalSession
                          sessionId={session.id}
                          cwd={session.cwd}
                          isActive={active}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
              <aside className="hidden w-[22rem] shrink-0 bg-surface-1 lg:flex lg:flex-col">
                <WorkspaceControlPanel
                  project={activeProject}
                  worktreePath={selectedPath}
                  workspaceName={selectedWorkspaceName}
                  onArchive={
                    activeProject && selectedWorktree && !selectedWorktree.isProjectRoot
                      ? () => archiveWorkspace(activeProject, selectedWorktree)
                      : undefined
                  }
                  onContinued={activeProject ? () => reloadWorkspaces(activeProject) : undefined}
                />
              </aside>
            </div>
          </main>
        </div>
      </div>
      {dialogProject && (
        <WorkspaceNameDialog
          project={dialogProject}
          isCreating={isCreating}
          error={worktreeError}
          onCancel={() => setDialogProject(null)}
          onSubmit={(name) => void createWorkspace(name)}
        />
      )}
    </SidebarProvider>
  );
}
