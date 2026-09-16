import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CaretDown,
  DotsThree,
  FolderPlus,
  FunnelSimple,
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
import {
  WorkspaceControlPanel,
  HEADER_TONE_GRADIENT,
  type HeaderTone,
} from "@/components/workspace-control-panel";
import { Toaster } from "@/components/ui/toaster";
import { Sidebar, SidebarFooter, SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Elevated } from "@/lib/elevated";
import { useProjectStore } from "@/store/project-store";
import { useThreadStore } from "@/store/thread-store";
import { useTerminalStore } from "@/store/terminal-store";
import { useWorktreeStore } from "@/store/worktree-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { cn } from "@/lib/utils";
import { normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";

/** Workspaces shown for a project before the "Load more" affordance appears. */
const WORKSPACE_PAGE_SIZE = 6;

/** A small, stable set of heights so the card grid reads as an organic
 *  masonry rather than a uniform table — picked by workspace path. */
const CARD_HEIGHTS = [128, 168, 144, 188, 132, 160, 116, 176];

function cardHeight(path: string, selected: boolean): number {
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  const base = CARD_HEIGHTS[hash % CARD_HEIGHTS.length];
  return selected ? base + 24 : base;
}

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
      <Elevated
        offset={4}
        data-pipper-id="workspace-name-dialog"
        className="w-full max-w-sm rounded-xl border border-border"
      >
        <form
          className="p-5"
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
      </Elevated>
    </div>
  );
}

/** Horizontal, scrollable project switcher pinned above the workspace grid. */
function ProjectTabs({
  projects,
  activeProjectId,
  onSelect,
}: {
  projects: Project[];
  activeProjectId: string | undefined;
  onSelect: (project: Project) => void;
}) {
  if (projects.length === 0) {
    return <p className="px-2 py-1.5 text-[13px] text-muted-foreground/70">No projects yet</p>;
  }
  return (
    <div
      role="tablist"
      aria-label="Projects"
      className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {projects.map((project) => {
        const active = project.id === activeProjectId;
        return (
          <button
            key={project.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? "true" : undefined}
            onClick={() => onSelect(project)}
            className={cn(
              "relative shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[15px] leading-none outline-none transition-colors duration-80",
              "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            {project.name}
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2.5 -bottom-0.5 h-0.5 rounded-full bg-foreground/70"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A single workspace rendered as a card in the grid. */
function WorkspaceCard({
  worktree,
  selected,
  tone = "neutral",
  archived,
  onSelect,
  onArchive,
  onDelete,
}: {
  worktree: Worktree;
  selected: boolean;
  /** Git-state tone of the selected workspace — mirrors the panel header. */
  tone?: HeaderTone;
  archived?: boolean;
  onSelect: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = worktree.workspaceName ?? (worktree.isProjectRoot ? "Main" : "Workspace");

  // Dismiss the context menu on any click outside it, or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={menuRef} className="group/card relative mb-2 break-inside-avoid">
      <button
        type="button"
        data-active={selected ? "true" : undefined}
        aria-current={selected ? "page" : undefined}
        onClick={() => {
          setMenuOpen(false);
          onSelect();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
        style={{ minHeight: cardHeight(worktree.path, selected) }}
        className={cn(
          "relative flex w-full flex-col overflow-hidden rounded-2xl p-3 text-left outline-none",
          "transition-[background-color,color,box-shadow] duration-80",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          selected
            ? cn(
                "bg-linear-to-b shadow-surface-4 ring-1",
                HEADER_TONE_GRADIENT[tone],
                tone === "neutral" ? "text-foreground ring-black/5" : "text-white ring-white/15",
              )
            : archived
              ? "border border-dashed border-foreground/15 bg-transparent text-neutral-500 hover:bg-foreground/5"
              : "bg-[#262626] text-neutral-400 hover:bg-[#303030] hover:text-neutral-100",
        )}
      >
        <span
          className={cn(
            "line-clamp-3 pr-5 text-[13px] font-medium leading-snug",
            selected && tone !== "neutral" && "drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]",
          )}
        >
          {name}
          {selected && <span className="sr-only"> (active workspace)</span>}
        </span>
        {archived && (
          <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">
            Archived
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`${name} options`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-open={menuOpen ? "true" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        className={cn(
          "absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md outline-none",
          "text-current opacity-0 transition-opacity duration-80",
          "group-hover/card:opacity-100 focus-visible:opacity-100 data-[open=true]:opacity-100",
          selected ? "hover:bg-white/20" : "hover:bg-white/10",
        )}
      >
        <DotsThree size={16} weight="bold" />
      </button>
      {menuOpen && (
        <Elevated
          offset={2}
          data-pipper-id="workspace-context-menu"
          className="absolute right-1 top-full z-50 mt-1 w-44 rounded-lg border border-border p-1"
        >
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
        </Elevated>
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
    clearError: clearWorktreeError,
  } = useWorktreeStore();
  const loadProjectThreads = useThreadStore((state) => state.loadProjectThreads);
  const [projects, setProjects] = useState<Project[]>([]);
  const [worktreesByProject, setWorktreesByProject] = useState<Record<string, Worktree[]>>({});
  const [dialogProject, setDialogProject] = useState<Project | null>(null);
  // Git-state tone of the selected workspace, reported by the control panel,
  // used to tint the active card with the panel's gradient.
  const [selectedTone, setSelectedTone] = useState<HeaderTone>("neutral");
  // Projects whose workspace list has been expanded past the initial page.
  const [expandedWorkspaceProjects, setExpandedWorkspaceProjects] = useState<Set<string>>(
    new Set(),
  );
  const loadMoreWorkspaces = (projectId: string) => {
    setExpandedWorkspaceProjects((current) => new Set(current).add(projectId));
  };
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

  const openWorkspaceDialog = (project: Project) => {
    // A failure from an earlier attempt (possibly another project) must not
    // greet the user before they have typed anything.
    clearWorktreeError();
    setDialogProject(project);
  };
  const closeWorkspaceDialog = () => {
    clearWorktreeError();
    setDialogProject(null);
  };

  const createWorkspace = async (name: string) => {
    if (!dialogProject) return;
    const project = dialogProject;
    const worktree = await createWorktree(project.id, name);
    if (!worktree) return;
    setDialogProject(null);
    // The worktree exists on disk now — show it before anything that can
    // still fail (switching, renaming), so the sidebar never hides a real
    // workspace behind a later error.
    setWorktreesByProject((current) => {
      const existing = current[project.id] ?? [];
      const withoutDup = existing.filter((item) => item.path !== worktree.path);
      // Newest-first: the fresh worktree carries Date.now(), so it sorts top.
      return { ...current, [project.id]: orderWorktreesForDisplay([worktree, ...withoutDup]) };
    });
    const thread = await selectWorkspace(project, worktree.path);
    if (thread) {
      try {
        await window.omni.threads.rename(thread.id, name);
      } catch (err) {
        // Cosmetic: the chat keeps its default title; the workspace is fine.
        console.error("[AdvancedShell] Failed to name the workspace thread:", err);
      }
      void queryClient.invalidateQueries({ queryKey: ["open-tabs"] });
    } else {
      // The dialog is gone, so the store's error has nowhere else to show.
      toast({
        icon: <GitBranch weight="duotone" className="size-5 text-destructive" />,
        title: "Workspace created, but could not be opened",
        description:
          useWorktreeStore.getState().error ?? "Select it from the sidebar to try again.",
      });
    }
    await loadWorktrees(project.id);
  };

  const workspaceKey = (projectId: string, path: string) => `${projectId}:${path}`;
  // Mirror the archived set to storage whenever it changes. Mutations below
  // are functional updates, so long-running flows (restore can take minutes)
  // never overwrite a change made in the meantime with a stale snapshot.
  useEffect(() => {
    try {
      window.localStorage.setItem("pipper.archived-workspaces", JSON.stringify([...archivedKeys]));
    } catch {
      // Keep the current session state when storage is unavailable.
    }
  }, [archivedKeys]);
  const setArchived = (key: string, archived: boolean) =>
    setArchivedKeys((current) => {
      if (current.has(key) === archived) return current;
      const next = new Set(current);
      if (archived) next.add(key);
      else next.delete(key);
      return next;
    });
  const archiveWorkspace = async (project: Project, worktree: Worktree) => {
    if (worktree.isProjectRoot) return;
    // Free the disk first (node_modules); the archived flag is only set once
    // that succeeded so a failed cleanup never leaves a "phantom" archive.
    await window.omni.worktrees.archive({ projectId: project.id, path: worktree.path });
    if (project.id === activeProject?.id && worktree.path === selectedPath) {
      await switchWorktree(project.id, project.path);
    }
    setArchived(workspaceKey(project.id, worktree.path), true);
  };
  const restoreWorkspace = async (project: Project, worktree: Worktree) => {
    const key = workspaceKey(project.id, worktree.path);
    // Optimistic: the row moves back immediately while deps reinstall (that
    // can take minutes). `restore` resolves only once the install finished;
    // on failure the workspace is parked again so "restored" always means
    // "usable".
    setArchived(key, false);
    try {
      await window.omni.worktrees.restore({ projectId: project.id, path: worktree.path });
    } catch (err) {
      setArchived(key, true);
      toast({
        icon: <Archive weight="duotone" className="size-5 text-destructive" />,
        title: "Workspace restore failed",
        description: err instanceof Error ? err.message : "Dependencies could not be installed.",
      });
    }
  };
  /** After "Continue" the worktree is on a new branch — refresh git-derived rows. */
  const reloadWorkspaces = async (project: Project) => {
    const items = await window.omni.worktrees.list(project.id).catch(() => null);
    // Git's order is readdir order; keep the same newest-first display as
    // the initial load so "Continue" never reshuffles the rows.
    if (items)
      setWorktreesByProject((current) => ({
        ...current,
        [project.id]: orderWorktreesForDisplay(items),
      }));
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
    setArchived(workspaceKey(project.id, worktree.path), false);
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

  // Workspaces for the active project — only the active project's grid renders.
  const visibleWorktrees = activeProject
    ? (worktreesByProject[activeProject.id] ?? []).filter((worktree) => !worktree.isProjectRoot)
    : [];
  const activeWorktrees = visibleWorktrees.filter(
    (worktree) => !archivedKeys.has(workspaceKey(activeProject?.id ?? "", worktree.path)),
  );
  const archivedWorktrees = visibleWorktrees.filter((worktree) =>
    archivedKeys.has(workspaceKey(activeProject?.id ?? "", worktree.path)),
  );
  const workspacesExpanded = activeProject
    ? expandedWorkspaceProjects.has(activeProject.id)
    : false;
  const shownWorktrees = workspacesExpanded
    ? activeWorktrees
    : activeWorktrees.slice(0, WORKSPACE_PAGE_SIZE);
  const hiddenWorkspaceCount = activeWorktrees.length - shownWorktrees.length;

  return (
    <SidebarProvider defaultOpen width="20rem">
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-surface-1 text-foreground">
        <DiffIngestor />
        <Toaster />
        <div className="flex min-h-0 flex-1">
          <Sidebar collapsible="none" rail={false}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-11">
                <div className="min-w-0 flex-1">
                  <ProjectTabs
                    projects={projects}
                    activeProjectId={activeProject?.id}
                    onSelect={(project) => void openProject(project)}
                  />
                </div>
                {activeProject && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={`New workspace in ${activeProject.name}`}
                    onClick={() => openWorkspaceDialog(activeProject)}
                  >
                    <Plus size={16} />
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2">
                {activeProject ? (
                  <>
                    {activeWorktrees.length === 0 && archivedWorktrees.length === 0 ? (
                      <button
                        type="button"
                        className="flex min-h-[7rem] w-full items-center justify-center rounded-2xl border border-dashed border-border text-[13px] text-muted-foreground/70 transition-colors duration-80 hover:bg-surface-2 hover:text-foreground"
                        onClick={() => openWorkspaceDialog(activeProject)}
                      >
                        <Plus size={16} className="mr-1.5" /> New workspace
                      </button>
                    ) : (
                      <div className="columns-2 gap-2">
                        {shownWorktrees.map((worktree) => {
                          const isSelected = worktree.path === selectedPath;
                          return (
                            <WorkspaceCard
                              key={worktree.path}
                              worktree={worktree}
                              selected={isSelected}
                              tone={isSelected ? selectedTone : "neutral"}
                              onSelect={() => void selectWorkspace(activeProject, worktree.path)}
                              onArchive={() => void archiveWorkspace(activeProject, worktree)}
                              onDelete={() => void deleteWorkspace(activeProject, worktree)}
                            />
                          );
                        })}
                      </div>
                    )}
                    {hiddenWorkspaceCount > 0 ? (
                      <button
                        type="button"
                        className="flex h-8 w-full items-center justify-center gap-2 rounded-md text-[12px] text-muted-foreground transition-colors duration-80 hover:bg-hover hover:text-foreground"
                        onClick={() => loadMoreWorkspaces(activeProject.id)}
                      >
                        <CaretDown size={14} />
                        Load more ({hiddenWorkspaceCount})
                      </button>
                    ) : null}
                    {archivedWorktrees.length > 0 ? (
                      <div className="mt-3">
                        <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                          Archived
                        </div>
                        <div className="columns-2 gap-2">
                          {archivedWorktrees.map((worktree) => (
                            <WorkspaceCard
                              key={`archived-${worktree.path}`}
                              worktree={worktree}
                              selected={false}
                              archived
                              onSelect={() => void selectWorkspace(activeProject, worktree.path)}
                              onArchive={() => void restoreWorkspace(activeProject, worktree)}
                              onDelete={() => void deleteWorkspace(activeProject, worktree)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="px-1 py-2 text-[13px] text-muted-foreground/70">
                    Select a project to see its workspaces.
                  </p>
                )}
              </div>
            </div>
            <SidebarFooter className="border-t border-white/5 bg-[#1a1a1a] p-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex h-8 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] text-neutral-400 outline-none transition-colors duration-80 hover:bg-white/10 hover:text-neutral-100"
                  onClick={() => void window.omni.launch.show("add")}
                >
                  <FolderPlus size={16} />
                  New project
                </button>
                <button
                  type="button"
                  aria-label="Filter projects"
                  className="grid size-8 shrink-0 place-items-center rounded-md text-neutral-400 outline-none transition-colors duration-80 hover:bg-white/10 hover:text-neutral-100"
                >
                  <FunnelSimple size={16} />
                </button>
              </div>
            </SidebarFooter>
          </Sidebar>

          <main className="relative min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-w-0">
              <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex h-12 shrink-0 items-center justify-center bg-surface-1 px-3">
                  <div className="mt-2 min-w-0 max-w-[1000px] px-4">
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
              <aside className="hidden w-[22rem] shrink-0 border-l border-border bg-surface-1 lg:flex lg:flex-col">
                <WorkspaceControlPanel
                  project={activeProject}
                  worktreePath={selectedPath}
                  workspaceName={selectedWorkspaceName}
                  onToneChange={setSelectedTone}
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
          onCancel={closeWorkspaceDialog}
          onSubmit={(name) => void createWorkspace(name)}
        />
      )}
    </SidebarProvider>
  );
}
