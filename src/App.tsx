import { useEffect, useState, useRef, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { useWorktreeStore } from "@/store/worktree-store";
import { useTerminalStore } from "@/store/terminal-store";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/components/ui/toast";
import { AgentView } from "@/components/agent-view";
import { GlobalTabBar } from "@/components/global-tab-bar";
import { TerminalSession } from "@/components/terminal-session";
import { DiffView } from "@/components/diff-view";
import { DiffIngestor } from "@/components/diff-ingestor";
import { CompanionView } from "@/components/companion-view";
import { useDiffStore } from "@/store/diff-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { cn } from "@/lib/utils";
import { PipperOverlay } from "@/components/pipper-overlay";
import { usePipperStore } from "@/store/pipper-store";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { UpdateBanner } from "@/components/update-banner";
import { UpdateDialog } from "@/components/update-dialog";
import { useUpdateStore } from "@/store/update-store";
import { useLauncherUpdateStore } from "@/store/launcher-update-store";
import { LauncherUpdateBanner, LauncherUpdateDialog } from "@/components/launcher-update";
import { SelectionBackground, GitDiffIcon, Bell, FolderPlus, GitBranch, Plus } from "@phosphor-icons/react";

export default function App() {
  const [stage] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("stage");
    }
    return null;
  });

  const { activeProject, loadActiveProject, isLoading, error: projectError } = useProjectStore();
  const { syncFromBroadcast } = usePipperStore();

  // ── Workspace view routing ────────────────────────────────────────────
  // The header tab strip (GlobalTabBar) flips these; we route the workspace
  // area between a full-width agent view, a 40:60 agent|diff split, and a
  // full-width terminal overlay. The agent view stays mounted across all
  // three states (terminal is an overlay, the diff panel mounts beside it)
  // so its composer draft and scroll position survive tab switches.
  const workspaceMode = useWorkspaceViewStore((state) => state.mode);
  const activeTerminalId = useWorkspaceViewStore((state) => state.activeTerminalId);
  // Narrow, primitive selectors: `sessions` gets a new array identity on every
  // PTY output chunk (appendHistory), so subscribing to the array here would
  // re-render the whole shell continuously. Existence + cwd are stable.
  const hasActiveTerminal = useTerminalStore(
    (state) => activeTerminalId != null && state.sessions.some((s) => s.id === activeTerminalId),
  );
  const activeTerminalCwd = useTerminalStore(
    (state) => state.sessions.find((s) => s.id === activeTerminalId)?.cwd,
  );
  const diffFileCount = useDiffStore((state) => state.order.length);
  const isDiffOpen = useDiffStore((state) => state.isOpen);
  const diffUnseenCount = useDiffStore((state) => state.unseenCount);
  const openDiff = useDiffStore((state) => state.open);
  const closeDiff = useDiffStore((state) => state.close);
  const showAgent = useWorkspaceViewStore((state) => state.showAgent);
  const showDiffSplit = workspaceMode === "agent" && isDiffOpen && diffFileCount > 0;
  const showTerminalView = workspaceMode === "terminal" && hasActiveTerminal;
  const toggleDiff = () => {
    if (workspaceMode !== "agent") {
      showAgent();
      openDiff();
      return;
    }
    if (isDiffOpen) closeDiff();
    else openDiff();
  };
  const initializeUpdates = useUpdateStore((state) => state.initialize);
  const checkForUpdates = useUpdateStore((state) => state.check);
  const updateState = useUpdateStore((state) => state.state);
  const updateRun = useUpdateStore((state) => state.run);
  const initializeLauncherUpdates = useLauncherUpdateStore((state) => state.initialize);

  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isWorkspaceDropdownOpen, setIsWorkspaceDropdownOpen] = useState(false);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [isWorkspaceFormOpen, setIsWorkspaceFormOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const branchButtonRef = useRef<HTMLButtonElement>(null);
  const {
    worktrees,
    branches,
    projectId: worktreeProjectId,
    branchProjectId,
    selectedWorktreePathByProject,
    isLoading: isLoadingWorktrees,
    isCreating: isCreatingWorktree,
    isSwitching: isSwitchingWorktree,
    isLoadingBranches,
    isSwitchingBranch,
    error: worktreeError,
    loadWorktrees,
    loadBranches,
    createWorktree,
    switchWorktree,
    switchBranch,
  } = useWorktreeStore();

  const loadProjectsList = async () => {
    try {
      if (window.omni?.projects?.list) {
        const list = await window.omni.projects.list();
        setProjectsList(list);
      }
    } catch (err) {
      console.error("Failed to load projects list:", err);
    }
  };

  useEffect(() => {
    void loadProjectsList();
  }, [activeProject?.id]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initializeUpdates().then((dispose) => {
      cleanup = dispose;
    });
    return () => cleanup?.();
  }, [initializeUpdates]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initializeLauncherUpdates().then((dispose) => {
      cleanup = dispose;
    });
    return () => cleanup?.();
  }, [initializeLauncherUpdates]);

  useEffect(() => {
    if (updateState?.phase === "awaiting-health-check" && updateRun?.target_version) {
      void window.omni.update.markActiveHealthy(updateRun.target_version).then((success) => {
        if (!success) {
          toast({
            icon: <Bell className="size-5 text-red-500" />,
            title: "Update health check not accepted",
            description: "The updater is waiting for a matching active version.",
          });
        }
      });
    }
  }, [updateState?.phase, updateRun?.target_version]);

  const handleToggleDropdown = async () => {
    if (!isDropdownOpen) {
      await loadProjectsList();
    }
    setIsDropdownOpen((prev) => !prev);
  };

  const closeWorkspaceDropdown = () => {
    setIsWorkspaceDropdownOpen(false);
    setIsWorkspaceFormOpen(false);
    setWorkspaceName("");
  };

  const closeBranchDropdown = () => setIsBranchDropdownOpen(false);

  const handleToggleWorkspaceDropdown = () => {
    if (!activeProject) return;
    if (!isWorkspaceDropdownOpen) void loadWorktrees(activeProject.id);
    setIsWorkspaceDropdownOpen((open) => !open);
    closeBranchDropdown();
    setIsDropdownOpen(false);
  };

  const handleToggleBranchDropdown = () => {
    if (!activeProject) return;
    if (!isBranchDropdownOpen) void loadBranches(activeProject.id);
    setIsBranchDropdownOpen((open) => !open);
    closeWorkspaceDropdown();
    setIsDropdownOpen(false);
  };

  const handleCreateWorkspace = async () => {
    if (!activeProject || !workspaceName.trim() || isCreatingWorktree) return;
    const worktree = await createWorktree(activeProject.id, workspaceName.trim());
    if (!worktree) return;
    const thread = await switchWorktree(activeProject.id, worktree.path);
    if (!thread) return;
    const wasTerminalActive = workspaceMode === "terminal" && activeTerminalId;
    const newActiveId = useTerminalStore.getState().restartSessionsIn(worktree.path);
    if (wasTerminalActive && newActiveId) {
      useWorkspaceViewStore.getState().showTerminal(newActiveId);
    }
    setWorkspaceName("");
    setIsWorkspaceFormOpen(false);
    toast({
      icon: <GitBranch className="size-5 text-foreground" />,
      title: "Worktree created",
      description: `${worktree.branch ?? "New branch"} is now selected.`,
    });
  };

  const handleSwitchWorktree = async (path: string) => {
    if (!activeProject || isSwitchingWorktree) return;
    const thread = await switchWorktree(activeProject.id, path);
    if (!thread) return;
    const wasTerminalActive = workspaceMode === "terminal" && activeTerminalId;
    const newActiveId = useTerminalStore.getState().restartSessionsIn(path);
    if (wasTerminalActive && newActiveId) {
      useWorkspaceViewStore.getState().showTerminal(newActiveId);
    }
    closeWorkspaceDropdown();
  };

  const handleSwitchBranch = async (branch: string) => {
    if (!activeProject || !selectedWorktreePath || isSwitchingBranch) return;
    const worktree = await switchBranch(activeProject.id, selectedWorktreePath, branch);
    if (!worktree) return;
    closeBranchDropdown();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        isDropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsDropdownOpen(false);
      }
      if (
        isWorkspaceDropdownOpen &&
        workspaceDropdownRef.current &&
        !workspaceDropdownRef.current.contains(target) &&
        workspaceButtonRef.current &&
        !workspaceButtonRef.current.contains(target)
      ) {
        closeWorkspaceDropdown();
      }
      if (
        isBranchDropdownOpen &&
        branchDropdownRef.current &&
        !branchDropdownRef.current.contains(target) &&
        branchButtonRef.current &&
        !branchButtonRef.current.contains(target)
      ) {
        closeBranchDropdown();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen, isWorkspaceDropdownOpen, isBranchDropdownOpen]);

  const checkedIndex = useMemo(() => {
    const idx = projectsList.findIndex((p) => p.id === activeProject?.id);
    return idx !== -1 ? idx : undefined;
  }, [activeProject?.id, projectsList]);
  const visibleWorktrees = worktreeProjectId === activeProject?.id ? worktrees : [];
  const visibleBranches = branchProjectId === activeProject?.id ? branches : [];
  const storedWorktreePath = activeProject
    ? selectedWorktreePathByProject[activeProject.id]
    : undefined;
  // Anchor to git's canonical entries: the stored selection, else the project
  // root (`isProjectRoot`). Defaulting to `activeProject.path` would miss when
  // the project path has a symlinked ancestor (git reports realpaths).
  const selectedWorktree =
    visibleWorktrees.find((worktree) => worktree.path === storedWorktreePath) ??
    visibleWorktrees.find((worktree) => worktree.isProjectRoot) ??
    visibleWorktrees[0] ??
    null;
  const selectedWorktreePath =
    selectedWorktree?.path ?? storedWorktreePath ?? activeProject?.path ?? null;
  // Derive a real name from the path we already know, so the label is meaningful
  // even before the worktree list loads (or if it fails): the project root reads
  // as "main"; a linked worktree reads as its folder name. Never literal "Workspace".
  const derivedWorkspaceName = (() => {
    if (!selectedWorktreePath || !activeProject) return "main";
    if (selectedWorktreePath === activeProject.path) return "main";
    return selectedWorktreePath.split(/[\\/]/).filter(Boolean).at(-1) ?? "main";
  })();
  const workspaceNameLabel = selectedWorktree?.workspaceName ?? derivedWorkspaceName;
  const branchLabel = selectedWorktree?.branch ?? (isLoadingWorktrees ? "Loading…" : "main");

  // Subscribe to pipper cross-window state broadcasts
  useEffect(() => {
    if (!window.omni?.pipper?.onStateChanged) return;
    const unsub = window.omni.pipper.onStateChanged((payload) => {
      syncFromBroadcast(payload);
    });
    return unsub;
  }, [syncFromBroadcast]);

  useEffect(() => {
    void loadActiveProject();
  }, [loadActiveProject]);

  useEffect(() => {
    if (activeProject) void loadWorktrees(activeProject.id);
  }, [activeProject?.id, loadWorktrees]);

  useEffect(() => {
    if (!window.omni?.projects?.onActiveChanged) return;
    const unsubscribe = window.omni.projects.onActiveChanged(() => {
      void loadActiveProject();
    });
    return unsubscribe;
  }, [loadActiveProject]);

  if (stage === "companion") {
    return <CompanionView />;
  }

  if (isLoading && !activeProject) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-1 text-muted-foreground text-sm font-mono">
        Loading project context…
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen flex flex-col bg-surface-1 text-foreground">
      {/* Headless: keeps the diff store fed from the active agent thread. */}
      <DiffIngestor />
      {/* Pipper overlay — sits above everything in the main window */}
      <PipperOverlay />
      <UpdateDialog />
      <LauncherUpdateDialog />

      {/* Title Bar / Header */}
      <header
        className="h-14 flex items-center justify-between pl-20 pr-4 border-b border-border/60 bg-surface-1 select-none shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        data-pipper-id="header"
      >
        <div
          className="relative flex min-w-0 items-center gap-3 p-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          data-pipper-id="Project Selector Wrapper"
        >
          {activeProject && (
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-col items-start">
                <button
                  type="button"
                  ref={buttonRef}
                  onClick={handleToggleDropdown}
                  className="group flex max-w-[280px] items-center gap-1 rounded px-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                    {activeProject.name}
                  </span>

                </button>
                <div className="flex max-w-[470px] items-center gap-1 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    ref={workspaceButtonRef}
                    onClick={handleToggleWorkspaceDropdown}
                    className="group flex min-w-0 items-center gap-1 rounded px-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Select worktree"
                  >
                    <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate group-hover:text-foreground">
                      {workspaceNameLabel}
                    </span>
                  </button>
                  <span className="text-muted-foreground/40">/</span>
                  <button
                    type="button"
                    ref={branchButtonRef}
                    onClick={handleToggleBranchDropdown}
                    className="group flex min-w-0 items-center gap-1 rounded px-1 font-mono text-left outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Select branch"
                  >
                    <span className="truncate group-hover:text-foreground">{branchLabel}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {isDropdownOpen && (
            <div ref={dropdownRef} className="absolute left-0 top-full mt-1 z-[200]">
              <Dropdown checkedIndex={checkedIndex} className="w-64 max-h-[300px]">
                {projectsList.map((project, idx) => {
                  const ProjectIconItem = ((props: { className?: string }) => (
                    <ProjectIcon name={project.icon} className={props.className} />
                  )) as any;
                  return (
                    <MenuItem
                      key={project.id}
                      index={idx}
                      label={project.name}
                      icon={ProjectIconItem}
                      checked={activeProject?.id === project.id}
                      onSelect={async () => {
                        setIsDropdownOpen(false);
                        if (window.omni?.projects?.setActive) {
                          try {
                            await window.omni.projects.setActive(project.id);
                          } catch (err) {
                            toast({
                              icon: <Bell className="size-5 text-red-500" />,
                              title: "Project switch failed",
                              description:
                                err instanceof Error
                                  ? err.message
                                  : "Could not activate that project.",
                            });
                          }
                        }
                      }}
                    />
                  );
                })}
                {projectsList.length > 0 && <DropdownSeparator />}
                <MenuItem
                  index={projectsList.length}
                  label="Add Project"
                  icon={FolderPlus}
                  onSelect={async () => {
                    setIsDropdownOpen(false);
                    if (window.omni?.launch?.show) {
                      await window.omni.launch.show("add");
                    }
                  }}
                />
              </Dropdown>
            </div>
          )}

          {isWorkspaceDropdownOpen && activeProject && (
            <div
              ref={workspaceDropdownRef}
              className="absolute left-7 top-full z-[200] mt-1 w-80 overflow-hidden rounded-xl border border-border bg-surface-1 p-1.5 shadow-surface-5"
            >
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Worktrees
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {isLoadingWorktrees ? (
                  <div className="px-2 py-3 text-[12px] text-muted-foreground">
                    Loading worktrees…
                  </div>
                ) : (
                  visibleWorktrees.map((worktree) => {
                    const isSelected = worktree.path === selectedWorktreePath;
                    const name = worktree.workspaceName ?? "Workspace";
                    return (
                      <button
                        key={worktree.path}
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                          isSelected
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-hover hover:text-foreground"
                        }`}
                        disabled={isSelected || isSwitchingWorktree}
                        onClick={() => void handleSwitchWorktree(worktree.path)}
                      >
                        <GitBranch className="size-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{name}</span>
                          <span className="block truncate font-mono text-[10px] opacity-70">
                            {worktree.path}
                          </span>
                        </span>
                        {isSelected && <span className="size-1.5 rounded-full bg-foreground" />}
                      </button>
                    );
                  })
                )}
              </div>
              {worktreeError && (
                <div className="px-2 py-2 text-[11px] text-red-500">{worktreeError}</div>
              )}
              <div className="mt-1 border-t border-border/60 pt-1">
                {isWorkspaceFormOpen ? (
                  <form
                    className="flex gap-1 px-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleCreateWorkspace();
                    }}
                  >
                    <input
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="New worktree name"
                      aria-label="New worktree name"
                      autoFocus
                      className="min-w-0 flex-1 rounded-md bg-surface-2 px-2 py-1.5 text-[12px] text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/60 focus:ring-ring"
                    />
                    <button
                      type="submit"
                      disabled={!workspaceName.trim() || isCreatingWorktree || isSwitchingWorktree}
                      className="rounded-md bg-foreground px-2 text-[11px] font-medium text-background disabled:opacity-50"
                    >
                      {isCreatingWorktree || isSwitchingWorktree ? "…" : "Create"}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                    onClick={() => setIsWorkspaceFormOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    New worktree
                  </button>
                )}
              </div>
            </div>
          )}

          {isBranchDropdownOpen && activeProject && selectedWorktree && (
            <div
              ref={branchDropdownRef}
              className="absolute left-7 top-full z-[200] mt-1 w-80 overflow-hidden rounded-xl border border-border bg-surface-1 p-1.5 shadow-surface-5"
            >
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Local branches · {workspaceNameLabel}
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {isLoadingBranches ? (
                  <div className="px-2 py-3 text-[12px] text-muted-foreground">
                    Loading branches…
                  </div>
                ) : visibleBranches.length === 0 ? (
                  <div className="px-2 py-3 text-[12px] text-muted-foreground">
                    No local branches found.
                  </div>
                ) : (
                  visibleBranches.map((branch) => {
                    const isCurrent = branch.name === selectedWorktree.branch;
                    const heldElsewhere =
                      branch.worktreePath !== null && branch.worktreePath !== selectedWorktree.path;
                    const heldBy = visibleWorktrees.find(
                      (worktree) => worktree.path === branch.worktreePath,
                    );
                    return (
                      <button
                        key={branch.name}
                        type="button"
                        disabled={isCurrent || heldElsewhere || isSwitchingBranch}
                        onClick={() => void handleSwitchBranch(branch.name)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors disabled:cursor-default ${
                          isCurrent
                            ? "bg-accent text-foreground"
                            : heldElsewhere
                              ? "text-muted-foreground/45"
                              : "text-muted-foreground hover:bg-hover hover:text-foreground"
                        }`}
                      >
                        <GitBranch className="size-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px] font-medium">
                            {branch.name}
                          </span>
                          {heldElsewhere && (
                            <span className="block truncate text-[10px] opacity-70">
                              Checked out in {heldBy?.workspaceName ?? "another worktree"}
                            </span>
                          )}
                        </span>
                        {isCurrent && <span className="size-1.5 rounded-full bg-foreground" />}
                      </button>
                    );
                  })
                )}
              </div>
              {worktreeError && (
                <div className="px-2 py-2 text-[11px] text-red-500">{worktreeError}</div>
              )}
            </div>
          )}
        </div>

        <div
          className="mx-2 flex min-w-0 flex-1 items-center justify-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          data-pipper-id="Global Tab Bar Wrapper"
        >
          <GlobalTabBar />
        </div>

        <div
          className="flex items-center gap-1 "
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          data-pipper-id="Theme and Flyout Controls"
        >
          {diffFileCount > 0 && (
            <button
              type="button"
              onClick={toggleDiff}
              aria-label={showDiffSplit ? "Hide changes" : "View changes"}
              title={showDiffSplit ? "Hide changes" : "View changes"}
              className={cn(
                "relative inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                showDiffSplit
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              data-pipper-id="header-diff-toggle"
            >
              <GitDiffIcon className="size-4" />

            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.omni?.companion?.open) {
                window.omni.companion.open().catch((err) => {
                  toast({
                    icon: <Bell className="size-5 text-red-500" />,
                    title: "Could not open companion",
                    description:
                      err instanceof Error ? err.message : "Edit mode is not available right now.",
                  });
                });
              }
            }}
            aria-label="Open Companion"
            title="Open Companion"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <SelectionBackground className="size-4" />
          </button>


          <ThemeToggle />
        </div>
      </header>

      <LauncherUpdateBanner />
      <UpdateBanner />
      {projectError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-500">
          {projectError}
        </div>
      )}

      <Toaster />

      {/* Workspace area.
          - Agent thread (global): AgentView at 100% width.
          - Agent thread + diffs (thread-specific): 40:60 AgentView | DiffView.
          - Terminal (global): full-width terminal overlaid on the (still
            mounted) agent view.
          The agent Panel is always child #1 of the Group so AgentView never
          remounts as the layout changes. */}
      <div
        className="relative flex-1 flex min-h-0"
        data-pipper-id="workspace panel"
      >
        <Group
          orientation="horizontal"
          defaultLayout={showDiffSplit ? { agent: 40, diff: 60 } : undefined}
          className="flex-1 flex min-h-0"
          data-pipper-id="workspace split"
        >
          <Panel
            id="agent"
            data-pipper-id="agent panel"
            className="relative z-20 overflow-visible"
          >
            {/* Stable wrapper (never conditionally swapped) so AgentView is not
                remounted when the diff split toggles. When the agent view is
                the full-width global view we cap its content to a centered
                column — a full-bleed conversation reads badly; inside the diff
                split the panel is already narrow so it uses full width. */}
            <div
              className={cn(
                "flex h-full w-full flex-col",
                !showDiffSplit && "mx-auto lg:w-[62%]",
              )}
            >
              <AgentView />
            </div>
          </Panel>
          {showDiffSplit && (
            <Separator className="group relative w-px bg-border data-[separator-state=hover]:bg-foreground/20 data-[separator-state=drag]:bg-foreground/30 transition-colors">
              <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
            </Separator>
          )}
          {showDiffSplit && (
            <Panel
              id="diff"
              data-pipper-id="diff panel"
              minSize="40%"
              className="relative z-10 overflow-hidden"
            >
              <section className="h-full w-full flex flex-col bg-surface-1 p-2">
                <div className="flex-1 overflow-hidden min-h-0 rounded-md">
                  <DiffView />
                </div>
              </section>
            </Panel>
          )}
        </Group>

        {showTerminalView && activeTerminalId && (
          <section
            className="absolute inset-0 z-30 flex flex-col bg-surface-1 p-2"
            data-pipper-id="terminal panel"
          >
            {/* Same centered column as the agent view so a selected terminal
                tab uses the space without stretching edge-to-edge. */}
            <div className="mx-auto flex h-full w-full flex-col lg:w-[62%]">
              <div className="flex-1 overflow-hidden min-h-0">
                <TerminalSession
                  key={activeTerminalId}
                  sessionId={activeTerminalId}
                  cwd={activeTerminalCwd}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
