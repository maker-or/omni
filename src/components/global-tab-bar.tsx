"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderPlusIcon,
  PlusIcon,
  TerminalWindowIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { PixelGridLoader } from "@/components/ui/pixel-grid-loader";
import { toast } from "@/components/ui/toast";
import { useProjectStore } from "@/store/project-store";
import { useThreadStore } from "@/store/thread-store";
import { useAgentStore } from "@/store/agent-store";
import { useAgentRegistryStore } from "@/store/agent-registry-store";
import { useWorktreeStore } from "@/store/worktree-store";
import { useTerminalStore } from "@/store/terminal-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { selectThread } from "@/lib/thread-actions";
import {
  OPEN_TABS_QUERY_KEY,
  useMergedProjectThreads,
  useOpenTabsQuery,
  usePrefetchRecentProjects,
  useProjectThreadsQuery,
  useRecentProjectsQuery,
} from "@/lib/thread-queries";
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";
import { isThreadInWorkspace, normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";

const TERMINAL_TAB_PREFIX = "terminal:";

// Stable component identity — a fresh function reference remounts the icon on
// every unrelated re-render (e.g. streaming), restarting the CSS pulse.
function TabWorkingIcon(props: { className?: string; size?: number }) {
  return <PixelGridLoader size={props.size} className={props.className} />;
}

const projectIconComponentCache = new Map<
  string,
  (props: { className?: string }) => ReactElement
>();
function getProjectIconComponent(name: string) {
  let Component = projectIconComponentCache.get(name);
  if (!Component) {
    Component = (props: { className?: string }) => (
      <ProjectIcon name={name} className={props.className} />
    );
    projectIconComponentCache.set(name, Component);
  }
  return Component;
}

/**
 * The single, global tab strip that lives in the title bar. It merges the two
 * kinds of "global" views into one row:
 *   - agent threads (persisted, backed by open-tabs)
 *   - terminals (ephemeral, backed by the in-memory terminal store)
 *
 * Selecting a tab flips `useWorkspaceViewStore.mode`; `App` reads that to route
 * the workspace area (full-width agent / agent+diff split / full-width
 * terminal). All thread create/select/close/rename plumbing that used to live
 * inside `AgentPanel`'s header now lives here.
 */
export function GlobalTabBar() {
  const queryClient = useQueryClient();
  const { activeProject } = useProjectStore();
  const {
    threads,
    pagesByProject,
    loadProjectThreads,
    renameThread,
    deleteThread,
    error: threadError,
  } = useThreadStore();
  const snapshot = useAgentStore((state) => state.snapshot);
  const agentError = useAgentStore((state) => state.error);
  const runningThreadIds = useAgentStore((state) => state.runningThreadIds);
  const createThread = useAgentStore((state) => state.createThread);
  const isStreaming = snapshot?.isStreaming ?? false;

  const requestedThreadId = useWorkspaceViewStore((state) => state.requestedThreadId);
  const requestThread = useWorkspaceViewStore((state) => state.requestThread);
  const mode = useWorkspaceViewStore((state) => state.mode);
  const showAgent = useWorkspaceViewStore((state) => state.showAgent);
  const showTerminal = useWorkspaceViewStore((state) => state.showTerminal);

  // Subscribe to a *primitive* signature of the terminal tabs (id+title) so
  // streaming PTY output — which replaces the `sessions` array on every chunk
  // via appendHistory — doesn't re-render the tab strip, and (critically)
  // getSnapshot stays referentially stable so useSyncExternalStore doesn't
  // loop. Only tab add/remove/rename changes the key. The rendered list is
  // derived from the key, so it's stable too.
  const terminalTabsKey = useTerminalStore((state) =>
    state.sessions.map((session) => `${session.id}\t${session.title}`).join("\n"),
  );
  const terminalTabs = useMemo(
    () =>
      terminalTabsKey
        ? terminalTabsKey.split("\n").map((entry) => {
            const [id, title] = entry.split("\t");
            return { id, title };
          })
        : [],
    [terminalTabsKey],
  );
  const activeTerminalId = useWorkspaceViewStore((state) => state.activeTerminalId);
  const createSession = useTerminalStore((state) => state.createSession);
  const closeSession = useTerminalStore((state) => state.closeSession);
  const setActiveSessionId = useTerminalStore((state) => state.setActiveSessionId);
  const initializeGlobalListener = useTerminalStore((state) => state.initializeGlobalListener);

  const selectedWorktreePathByProject = useWorktreeStore(
    (state) => state.selectedWorktreePathByProject,
  );

  const [projectsList, setProjectsList] = useState<
    Array<{ id: string; name: string; icon: string; path?: string }>
  >([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [pendingCreateProjectId, setPendingCreateProjectId] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [editingThreadOriginalTitle, setEditingThreadOriginalTitle] = useState("");
  const [threadPaneStyle, setThreadPaneStyle] = useState<CSSProperties | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const threadPaneRef = useRef<HTMLDivElement>(null);
  // Tabs whose close is in flight (or whose thread the agent snapshot still
  // references after closing) — guards double-close and the tab-sync effect
  // from re-opening a just-closed tab while switchThread lands.
  const closingTabIdsRef = useRef<Set<string>>(new Set());

  const openTabsQuery = useOpenTabsQuery();
  const openTabsState = openTabsQuery.data;
  const openThreads = useMemo(() => openTabsState?.openThreads ?? [], [openTabsState?.openThreads]);
  const orderedOpenThreads = useMemo(() => {
    const threadsById = new Map(openThreads.map((thread) => [thread.id, thread]));
    return (openTabsState?.openThreadIds ?? [])
      .map((threadId) => threadsById.get(threadId))
      .filter((thread): thread is Thread => Boolean(thread));
  }, [openTabsState?.openThreadIds, openThreads]);
  const activeThreadId = openTabsState?.activeThreadId ?? null;
  const threadSwitchHistory = openTabsState?.threadSwitchHistory ?? [];
  const snapshotThreadId = snapshot?.threadId ?? null;

  // Workspace-first: the strip shows only threads that belong to their
  // project's current workspace. Hidden tabs stay open (hide, not close) and
  // reappear when the user switches back. The active thread is never hidden —
  // whatever produced it, its conversation is on screen and needs a tab.
  const visibleOpenThreads = useMemo(() => {
    const alwaysVisibleId = requestedThreadId ?? activeThreadId ?? snapshotThreadId;
    return orderedOpenThreads.filter((thread) => {
      if (thread.id === alwaysVisibleId) return true;
      const project = projectsList.find((item) => item.id === thread.project_id);
      // Until the project's path is known we can't tell root from worktree;
      // show rather than hide.
      if (!project?.path) return true;
      const workspacePath = normalizeWorkspacePath(
        selectedWorktreePathByProject[thread.project_id],
        project.path,
      );
      return isThreadInWorkspace(thread, workspacePath);
    });
  }, [
    orderedOpenThreads,
    projectsList,
    selectedWorktreePathByProject,
    requestedThreadId,
    activeThreadId,
    snapshotThreadId,
  ]);

  const recentProjectsQuery = useRecentProjectsQuery(
    activeProject?.id,
    threadSwitchHistory,
    openThreads,
  );
  usePrefetchRecentProjects(recentProjectsQuery.data ?? []);
  const hoveredProjectThreadsQuery = useProjectThreadsQuery(hoveredProjectId);

  // ── Effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadProjects() {
      const list = await window.omni.projects.list();
      setProjectsList(list);
    }
    void loadProjects();
  }, [activeProject?.id]);

  useEffect(() => {
    void useAgentRegistryStore.getState().load();
  }, []);

  // Terminal output streams through a single global IPC listener (was owned by
  // the removed OthersView). Idempotent — guarded by listenerInitialized.
  useEffect(() => {
    initializeGlobalListener();
  }, [initializeGlobalListener]);

  // Terminals are cwd-bound and workspace-scoped: App's workspace-bucket
  // effect stashes/restores them whenever the (project, workspace) context
  // changes, so no project-switch cleanup is needed here anymore.

  useEffect(() => {
    if (!isDropdownOpen) setHoveredProjectId(null);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!hoveredProjectId) return;
    const exists = projectsList.some((project) => project.id === hoveredProjectId);
    if (!exists) setHoveredProjectId(projectsList[0]?.id ?? null);
  }, [hoveredProjectId, projectsList]);

  useEffect(() => {
    if (!hoveredProjectId) return;
    if (pagesByProject[hoveredProjectId]) return;
    void loadProjectThreads(hoveredProjectId, { reset: true });
  }, [hoveredProjectId, loadProjectThreads, pagesByProject]);

  useEffect(() => {
    for (const projectId of recentProjectsQuery.data ?? []) {
      if (!pagesByProject[projectId]) void loadProjectThreads(projectId, { reset: true });
    }
  }, [loadProjectThreads, pagesByProject, recentProjectsQuery.data]);

  // Position the hover thread-pane next to the project list.
  useEffect(() => {
    if (!isDropdownOpen || !hoveredProjectId) {
      setThreadPaneStyle(null);
      return;
    }
    const updatePosition = () => {
      const rect = projectListRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 8;
      const paneWidth = 320;
      const paneHeight = 420;
      const canFitRight = rect.right + gap + paneWidth <= window.innerWidth - gap;
      const left = canFitRight ? rect.right + gap : Math.max(gap, rect.left - paneWidth - gap);
      const top = Math.min(
        Math.max(gap, rect.top),
        Math.max(gap, window.innerHeight - paneHeight - gap),
      );
      setThreadPaneStyle({
        position: "fixed",
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        zIndex: 3000,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isDropdownOpen, hoveredProjectId]);

  // Keep the current agent thread registered + active in open-tabs, and clear
  // the optimistic switch target once the snapshot catches up.
  useEffect(() => {
    if (!snapshotThreadId) return;
    if (closingTabIdsRef.current.has(snapshotThreadId)) return;
    void window.omni.tabs.open(snapshotThreadId).then(() => {
      void queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
    });
  }, [snapshotThreadId, queryClient]);

  useEffect(() => {
    if (requestedThreadId && snapshotThreadId === requestedThreadId) requestThread(null);
  }, [requestedThreadId, snapshotThreadId, requestThread]);

  useEffect(() => {
    if (requestedThreadId && agentError) requestThread(null);
  }, [agentError, requestedThreadId, requestThread]);

  useEffect(() => {
    if (!editingThreadId) return;
    if (openThreads.some((thread) => thread.id === editingThreadId)) return;
    cancelRenameThread();
  }, [editingThreadId, openThreads]);

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
        if (threadPaneRef.current?.contains(target)) return;
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  // ── Rename ────────────────────────────────────────────────────────────
  const startRenameThread = (threadId: string, title: string) => {
    setEditingThreadId(threadId);
    setEditingThreadTitle(title);
    setEditingThreadOriginalTitle(title);
  };
  const cancelRenameThread = () => {
    setEditingThreadId(null);
    setEditingThreadTitle("");
    setEditingThreadOriginalTitle("");
  };
  const commitRenameThread = async () => {
    if (!editingThreadId) return false;
    const nextTitle = editingThreadTitle.trim();
    const originalTitle = editingThreadOriginalTitle.trim();
    if (!nextTitle || nextTitle === originalTitle) {
      cancelRenameThread();
      return true;
    }
    const renamedThread = await renameThread(editingThreadId, nextTitle);
    if (!renamedThread) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Rename failed",
        description: useThreadStore.getState().error ?? "The thread title was not updated.",
      });
      return false;
    }
    queryClient.setQueryData<{ openThreads: Thread[] } | undefined>(
      OPEN_TABS_QUERY_KEY,
      (current) =>
        current
          ? {
              ...current,
              openThreads: current.openThreads.map((thread) =>
                thread.id === renamedThread.id ? renamedThread : thread,
              ),
            }
          : current,
    );
    cancelRenameThread();
    return true;
  };

  // ── Thread select / close / delete ────────────────────────────────────
  const handleSelectThread = async (id: string) => {
    closingTabIdsRef.current.delete(id);
    await selectThread(id);
  };

  const handleCloseThreadTab = async (id: string) => {
    if (closingTabIdsRef.current.has(id)) return;
    closingTabIdsRef.current.add(id);
    try {
      const wasActive = id === (requestedThreadId ?? activeThreadId ?? snapshotThreadId);
      const nextState = await window.omni.tabs.close(id);
      await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      if (!wasActive) return;
      if (nextState.activeThreadId) await handleSelectThread(nextState.activeThreadId);
      else requestThread(null);
    } finally {
      if (id !== useAgentStore.getState().snapshot?.threadId) {
        closingTabIdsRef.current.delete(id);
      }
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    if (thread.id === snapshot?.threadId && isStreaming) return;
    if (!window.confirm(`Permanently delete “${thread.title}” and its session history?`)) return;
    try {
      await deleteThread(thread.id);
      queryClient.setQueriesData<ThreadPage>(
        { queryKey: ["project-threads", thread.project_id] },
        (current) => {
          if (!current) return current;
          const hadThread = current.threads.some((item) => item.id === thread.id);
          return {
            ...current,
            threads: current.threads.filter((item) => item.id !== thread.id),
            nextOffset: hadThread ? Math.max(0, current.nextOffset - 1) : current.nextOffset,
          };
        },
      );
      queryClient.setQueryData<OpenTabsState & { openThreads: Thread[] }>(
        OPEN_TABS_QUERY_KEY,
        (current) => {
          if (!current) return current;
          const openThreadIds = current.openThreadIds.filter((id) => id !== thread.id);
          return {
            ...current,
            openThreadIds,
            openThreads: current.openThreads.filter((item) => item.id !== thread.id),
            activeThreadId:
              current.activeThreadId === thread.id
                ? (openThreadIds[0] ?? null)
                : current.activeThreadId,
          };
        },
      );
      setIsDropdownOpen(false);
      await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["project-threads", thread.project_id] });
      const state = await window.omni.tabs.listOpen();
      if (state.activeThreadId) await handleSelectThread(state.activeThreadId);
      else requestThread(null);
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Delete failed",
        description: err instanceof Error ? err.message : "The thread was not deleted.",
      });
    }
  };

  // ── Thread create ─────────────────────────────────────────────────────
  const dismissThreadCreator = () => {
    setShowAgentPicker(false);
    setPendingCreateProjectId(null);
  };

  const handleCreateThread = async (agentId?: string | null) => {
    const projectId = pendingCreateProjectId ?? hoveredProjectId ?? activeProject?.id;
    if (!projectId || isCreatingThread) return;
    const project = projectsList.find((item) => item.id === projectId);
    // New threads always bind to the project's current workspace.
    const worktreePath = normalizeWorkspacePath(
      selectedWorktreePathByProject[projectId],
      project?.path ?? null,
    );
    const nextCount = threads.filter((thread) => thread.project_id === projectId).length + 1;
    const title = `${project?.name ?? "Thread"} #${nextCount}`;
    setIsCreatingThread(true);
    dismissThreadCreator();
    try {
      const thread = await createThread(
        projectId,
        title,
        snapshot?.threadId ?? null,
        agentId ?? null,
        worktreePath,
      );
      await loadProjectThreads(projectId, { reset: true });
      await handleSelectThread(thread.id);
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Create thread failed",
        description: err instanceof Error ? err.message : "The thread was not created.",
      });
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleRequestCreateThread = () => {
    const projectId = hoveredProjectId ?? activeProject?.id;
    if (!projectId || isCreatingThread) return;
    const registryAgents = useAgentRegistryStore.getState().agents;
    const selectedIds = useAgentRegistryStore.getState().selectedAgentIds;
    const availableAgents = registryAgents.filter((a) => selectedIds.includes(a.id) && a.available);
    if (availableAgents.length === 0) {
      toast({
        icon: <WarningIcon className="size-5 text-amber-500" />,
        title: "No agents selected",
        description: "Select a coding agent in the launch window first.",
      });
      return;
    }
    setPendingCreateProjectId(projectId);
    setShowAgentPicker(true);
  };

  // ── Terminal select / create / close ──────────────────────────────────
  const handleSelectTerminal = (id: string) => {
    setActiveSessionId(id);
    showTerminal(id);
  };

  const handleNewTerminal = () => {
    const project = activeProject;
    const cwd = project ? (selectedWorktreePathByProject[project.id] ?? project.path) : undefined;
    const id = createSession(cwd);
    showTerminal(id);
  };

  const handleCloseTerminal = (id: string) => {
    const wasActiveTerminal = mode === "terminal" && activeTerminalId === id;
    closeSession(id);
    if (!wasActiveTerminal) return;
    const next = useTerminalStore.getState().activeSessionId;
    if (next) showTerminal(next);
    else showAgent();
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const projectItems = projectsList.map((project, idx) => ({
    id: project.id,
    name: project.name,
    icon: project.icon,
    // Index 0 is reserved for "New terminal", so project menu indices start at 1.
    index: idx + 1,
  }));
  const activeProjectItemIndex = projectItems.findIndex((item) => item.id === activeProject?.id);
  const checkedIndex = activeProjectItemIndex >= 0 ? activeProjectItemIndex + 1 : undefined;
  const addProjectIndex = projectItems.length + 1;
  // openThreads last so broadcast-fresh rows (e.g. a thread auto-created by
  // a workspace switch, not yet in the 2-min-stale project query) win.
  const hoveredStoreThreads = useMemo(() => [...threads, ...openThreads], [threads, openThreads]);
  const mergedHoveredProjectThreads = useMergedProjectThreads(
    hoveredProjectId,
    hoveredProjectThreadsQuery.data?.threads ?? [],
    hoveredStoreThreads,
  );
  // The picker only offers threads in the hovered project's current
  // workspace; cross-workspace threads require switching workspace first.
  const hoveredProject = projectsList.find((item) => item.id === hoveredProjectId);
  const hoveredWorkspacePath = normalizeWorkspacePath(
    hoveredProjectId ? selectedWorktreePathByProject[hoveredProjectId] : null,
    hoveredProject?.path ?? null,
  );
  const hoveredProjectThreads = useMemo(
    () =>
      hoveredProject?.path
        ? mergedHoveredProjectThreads.filter((thread) =>
            isThreadInWorkspace(thread, hoveredWorkspacePath),
          )
        : mergedHoveredProjectThreads,
    [mergedHoveredProjectThreads, hoveredProject?.path, hoveredWorkspacePath],
  );
  const hoveredWorkspaceLabel = hoveredWorkspacePath
    ? (hoveredWorkspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace")
    : "main";
  const hoveredThreadPage = hoveredProjectId ? pagesByProject[hoveredProjectId] : undefined;
  const isHoveredThreadsLoading =
    hoveredProjectThreadsQuery.isLoading || Boolean(hoveredThreadPage?.isLoading);
  const hoveredThreadsHasMore = hoveredThreadPage
    ? hoveredThreadPage.hasMore
    : Boolean(hoveredProjectThreadsQuery.data?.hasMore);

  const selectedThreadId = requestedThreadId ?? activeThreadId ?? snapshotThreadId ?? "";
  const selectedTabValue =
    mode === "terminal" && activeTerminalId
      ? `${TERMINAL_TAB_PREFIX}${activeTerminalId}`
      : selectedThreadId;

  const handleTabChange = (value: string) => {
    if (value.startsWith(TERMINAL_TAB_PREFIX)) {
      handleSelectTerminal(value.slice(TERMINAL_TAB_PREFIX.length));
      return;
    }
    void handleSelectThread(value);
  };

  return (
    <Tabs value={selectedTabValue} onValueChange={handleTabChange}>
      <div className="flex min-w-0 items-center gap-1" data-pipper-id="global-tab-bar">
        <TabsList
          data-pipper-id="global-tabs"
          className="min-w-0 p-1 gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleOpenThreads.map((thread, idx) => {
            const project = projectsList.find((item) => item.id === thread.project_id);
            const isThreadWorking = runningThreadIds.includes(thread.id);
            const Icon = isThreadWorking
              ? TabWorkingIcon
              : project
                ? getProjectIconComponent(project.icon)
                : undefined;
            const isEditing = editingThreadId === thread.id;
            const tabTitle = thread.title ?? "New thread";
            return (
              <TabItem
                key={thread.id}
                index={idx}
                value={thread.id}
                label={tabTitle}
                scrollLabelOnHover
                icon={Icon}
                onClose={() => handleCloseThreadTab(thread.id)}
                editing={isEditing}
                editValue={isEditing ? editingThreadTitle : tabTitle}
                onEditValueChange={setEditingThreadTitle}
                onEditCommit={commitRenameThread}
                onEditCancel={cancelRenameThread}
                onDoubleClick={() => startRenameThread(thread.id, tabTitle)}
                data-pipper-id={`thread-tab-${thread.id}`}
              />
            );
          })}
          {terminalTabs.map((session, idx) => (
            <TabItem
              key={session.id}
              index={visibleOpenThreads.length + idx}
              value={`${TERMINAL_TAB_PREFIX}${session.id}`}
              label={session.title}
              scrollLabelOnHover
              icon={TerminalWindowIcon}
              onClose={() => handleCloseTerminal(session.id)}
              data-pipper-id={`terminal-tab-${session.id}`}
            />
          ))}
        </TabsList>

        <div className="relative shrink-0" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
          <Button
            data-pipper-id="add-tab-button"
            ref={buttonRef}
            variant="ghost"
            size="icon-sm"
            active={isDropdownOpen}
            aria-label="Add tab"
            onClick={() =>
              setIsDropdownOpen((prev) => {
                const next = !prev;
                if (next) {
                  setHoveredProjectId(activeProject?.id ?? projectItems[0]?.id ?? null);
                  // Refresh on open (like the header project dropdown does) so
                  // projects added via the launch window appear without an
                  // active-project change.
                  void window.omni.projects.list().then(setProjectsList);
                }
                return next;
              })
            }
          >
            <PlusIcon size={16} />
          </Button>

          {isDropdownOpen && (
            <div
              data-pipper-id="add-tab-dropdown"
              ref={dropdownRef}
              className="absolute left-0 top-full mt-1.5 z-[200]"
            >
              <div ref={projectListRef} className="relative">
                <Dropdown checkedIndex={checkedIndex} className="w-72 max-h-[300px]">
                  <MenuItem
                    index={0}
                    label="New terminal"
                    icon={TerminalWindowIcon}
                    onSelect={() => {
                      setIsDropdownOpen(false);
                      handleNewTerminal();
                    }}
                  />
                  <DropdownSeparator />
                  {projectItems.map((item) => {
                    const project = projectsList.find((p) => p.id === item.id);
                    const ProjectIconItem = project
                      ? getProjectIconComponent(project.icon)
                      : undefined;
                    return (
                      <MenuItem
                        key={item.id}
                        index={item.index}
                        label={item.name}
                        icon={ProjectIconItem}
                        checked={activeProject?.id === item.id}
                        onMouseEnter={() => setHoveredProjectId(item.id)}
                        onFocus={() => setHoveredProjectId(item.id)}
                        onSelect={() => setHoveredProjectId(item.id)}
                      />
                    );
                  })}
                  <DropdownSeparator />
                  <MenuItem
                    index={addProjectIndex}
                    label="Add Project"
                    icon={FolderPlusIcon}
                    onSelect={async () => {
                      setIsDropdownOpen(false);
                      await window.omni.launch.show("add");
                    }}
                  />
                </Dropdown>
              </div>
              {hoveredProjectId && threadPaneStyle && typeof document !== "undefined"
                ? createPortal(
                    <div
                      data-pipper-id="thread-pane"
                      className="w-80 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-surface-1 shadow-surface-5 p-2"
                      ref={threadPaneRef}
                      style={threadPaneStyle}
                    >
                      <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Threads · {hoveredWorkspaceLabel}
                      </div>
                      <div className="flex flex-col gap-1">
                        {threadError && (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-[12px] text-red-500">
                            {threadError}
                          </div>
                        )}
                        {hoveredProjectThreads.length > 0 ? (
                          hoveredProjectThreads.map((thread) => {
                            const isActive = thread.id === selectedThreadId;
                            return (
                              <div
                                key={thread.id}
                                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={async () => {
                                    setIsDropdownOpen(false);
                                    await handleSelectThread(thread.id);
                                  }}
                                >
                                  <span
                                    className={
                                      isActive
                                        ? "block w-full truncate text-[13px] text-foreground font-medium"
                                        : "block w-full truncate text-[13px] text-muted-foreground hover:text-foreground"
                                    }
                                  >
                                    {thread.title}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Delete ${thread.title}`}
                                  disabled={thread.id === snapshot?.threadId && isStreaming}
                                  onClick={() => void handleDeleteThread(thread)}
                                  className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                                >
                                  <TrashIcon size={14} />
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-2 py-3 text-[13px] text-muted-foreground">
                            {isHoveredThreadsLoading ? "Loading threads..." : "No threads yet."}
                          </div>
                        )}
                      </div>
                      {hoveredProjectId && hoveredThreadsHasMore ? (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg px-2 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          disabled={isHoveredThreadsLoading}
                          onClick={() => {
                            void loadProjectThreads(hoveredProjectId).then(() => {
                              const nextError = useThreadStore.getState().error;
                              if (nextError) {
                                toast({
                                  icon: <WarningIcon className="size-5 text-red-500" />,
                                  title: "Threads failed to load",
                                  description: nextError,
                                });
                              }
                            });
                          }}
                        >
                          {isHoveredThreadsLoading ? "Loading..." : "Load more"}
                        </button>
                      ) : null}
                      <div className="mt-2 pt-2 border-t border-border/60">
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full justify-center"
                          leadingIcon={PlusIcon}
                          disabled={isCreatingThread}
                          onClick={() => {
                            setIsDropdownOpen(false);
                            handleRequestCreateThread();
                          }}
                        >
                          {isCreatingThread ? "Creating..." : "Create new thread"}
                        </Button>
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          )}
        </div>
      </div>

      {showAgentPicker && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[300] flex items-center justify-center"
              onClick={() => dismissThreadCreator()}
            >
              <div className="absolute inset-0 bg-black/30" />
              <div
                className="relative z-10 w-72 rounded-xl border border-border bg-surface-1 shadow-surface-5 p-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Pick an agent for this thread
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  {useAgentRegistryStore
                    .getState()
                    .agents.filter(
                      (a) =>
                        useAgentRegistryStore.getState().selectedAgentIds.includes(a.id) &&
                        a.available,
                    )
                    .map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
                        onClick={() => void handleCreateThread(agent.id)}
                      >
                        <span className="flex-1 font-medium">{agent.displayName}</span>
                        <span className="text-[11px] text-muted-foreground">{agent.name}</span>
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  className="mt-1 w-full rounded-lg px-2 py-1.5 text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => dismissThreadCreator()}
                >
                  Cancel
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </Tabs>
  );
}
