"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChatCircleIcon,
  FolderPlusIcon,
  PlusIcon,
  TerminalWindowIcon,
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
import { useWorktreeStore } from "@/store/worktree-store";
import { useTerminalStore } from "@/store/terminal-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { useUiModeStore } from "@/store/ui-mode-store";
import { confirmDiscardDraft, selectThread } from "@/lib/thread-actions";
import { beginRendererInteraction } from "@/lib/monitor-runtime-observer";
import {
  OPEN_TABS_QUERY_KEY,
  useOpenTabsQuery,
  usePrefetchRecentProjects,
  useRecentProjectsQuery,
} from "@/lib/thread-queries";
import type { Thread } from "../../contracts/threads.ts";
import { isThreadInWorkspace, normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";
import {
  isCloseTabShortcutEvent,
  isNewTabShortcutEvent,
  tabIndexFromShortcutEvent,
  tabValueAtShortcutIndex,
  tabValuesInBarOrder,
} from "@/lib/tab-shortcuts";

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
 * The shared tab strip that lives above the active workspace. It merges the
 * two kinds of views into one row:
 *   - agent threads (persisted, backed by open-tabs)
 *   - terminals (ephemeral, backed by the in-memory terminal store)
 *
 * "New thread" opens a draft composer (no session spawn). Creation happens on
 * first send in AgentPanel.
 */
export function GlobalTabBar() {
  const queryClient = useQueryClient();
  const { activeProject } = useProjectStore();
  const { pagesByProject, loadProjectThreads, renameThread } = useThreadStore();
  const snapshot = useAgentStore((state) => state.snapshot);
  const agentError = useAgentStore((state) => state.error);
  const runningThreadIds = useAgentStore((state) => state.runningThreadIds);
  const pendingThreadTarget = useAgentStore((state) => state.pendingThreadTarget);

  const requestedThreadId = useWorkspaceViewStore((state) => state.requestedThreadId);
  const requestThread = useWorkspaceViewStore((state) => state.requestThread);
  const mode = useWorkspaceViewStore((state) => state.mode);
  const showAgent = useWorkspaceViewStore((state) => state.showAgent);
  const showTerminal = useWorkspaceViewStore((state) => state.showTerminal);
  const draft = useWorkspaceViewStore((state) => state.draft);
  const draftCompletionThreadId = useWorkspaceViewStore((state) => state.draftCompletionThreadId);
  const beginDraft = useWorkspaceViewStore((state) => state.beginDraft);
  const endDraft = useWorkspaceViewStore((state) => state.endDraft);
  const clearDraftCompletion = useWorkspaceViewStore((state) => state.clearDraftCompletion);

  const terminalTabsRevision = useTerminalStore((state) => state.tabsRevision);
  const terminalTabs = useMemo(
    () =>
      useTerminalStore
        .getState()
        .sessions.map(({ id, title, status, cwd }) => ({ id, title, status, cwd })),
    [terminalTabsRevision],
  );
  const activeTerminalId = useWorkspaceViewStore((state) => state.activeTerminalId);
  const setViewActiveTerminalId = useWorkspaceViewStore((state) => state.setActiveTerminalId);
  const createSession = useTerminalStore((state) => state.createSession);
  const closeSession = useTerminalStore((state) => state.closeSession);
  const initializeGlobalListener = useTerminalStore((state) => state.initializeGlobalListener);

  const selectedWorktreePathByProject = useWorktreeStore(
    (state) => state.selectedWorktreePathByProject,
  );
  const uiMode = useUiModeStore((state) => state.mode);

  const [projectsList, setProjectsList] = useState<
    Array<{ id: string; name: string; icon: string; path?: string }>
  >([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [editingThreadOriginalTitle, setEditingThreadOriginalTitle] = useState("");

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closingTabIdsRef = useRef<Set<string>>(new Set());
  const openedDraftCompletionRef = useRef<string | null>(null);

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
  const optimisticRequestedThreadId =
    requestedThreadId && pendingThreadTarget === requestedThreadId ? requestedThreadId : null;

  const activeWorkspacePath = useMemo(() => {
    if (!activeProject) return null;
    return normalizeWorkspacePath(
      selectedWorktreePathByProject[activeProject.id],
      activeProject.path,
    );
  }, [activeProject, selectedWorktreePathByProject]);

  const visibleOpenThreads = useMemo(() => {
    if (uiMode !== "advanced") return orderedOpenThreads;
    if (!activeProject) return [];

    return orderedOpenThreads.filter((thread) => {
      if (thread.project_id !== activeProject.id) return false;
      if (thread.id === optimisticRequestedThreadId) return true;
      return isThreadInWorkspace(thread, activeWorkspacePath);
    });
  }, [orderedOpenThreads, uiMode, activeProject, activeWorkspacePath, optimisticRequestedThreadId]);

  const visibleTerminalTabs = useMemo(() => {
    if (uiMode !== "advanced" || !activeProject) return terminalTabs;
    return terminalTabs.filter(
      (session) => normalizeWorkspacePath(session.cwd, activeProject.path) === activeWorkspacePath,
    );
  }, [activeProject, activeWorkspacePath, terminalTabs, uiMode]);

  const recentProjectsQuery = useRecentProjectsQuery(
    activeProject?.id,
    threadSwitchHistory,
    openThreads,
  );
  usePrefetchRecentProjects(recentProjectsQuery.data ?? []);

  useEffect(() => {
    async function loadProjects() {
      const list = await window.omni.projects.list();
      setProjectsList(list);
    }
    void loadProjects();
  }, [activeProject?.id]);

  useEffect(() => {
    if (!window.omni?.projects?.onListChanged) return;
    const unsubscribe = window.omni.projects.onListChanged(() => {
      void window.omni.projects
        .list()
        .then((list) => setProjectsList(list))
        .catch((err) => console.error("Failed to reload projects list:", err));
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    initializeGlobalListener();
  }, [initializeGlobalListener]);

  useEffect(() => {
    for (const projectId of recentProjectsQuery.data ?? []) {
      if (!pagesByProject[projectId]) void loadProjectThreads(projectId, { reset: true });
    }
  }, [loadProjectThreads, pagesByProject, recentProjectsQuery.data]);

  useEffect(() => {
    // While composing a draft, the snapshot can still belong to the previous
    // live thread (or to an unrelated background activation). Do not turn that
    // snapshot into an open tab until the draft has become a real thread.
    if (draft) return;
    // Draft submission provides the authoritative new thread id. Keep using
    // it until the agent snapshot catches up; otherwise a stale snapshot can
    // reopen the thread that was visible before the draft started.
    if (draftCompletionThreadId) {
      const targetThreadId = draftCompletionThreadId;
      if (openedDraftCompletionRef.current !== targetThreadId) {
        openedDraftCompletionRef.current = targetThreadId;
        void window.omni.tabs
          .open(targetThreadId)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
          })
          .catch(() => {});
      }
      if (snapshotThreadId === targetThreadId) {
        openedDraftCompletionRef.current = null;
        clearDraftCompletion();
      }
      return;
    }
    if (!snapshotThreadId) return;
    // While a user switch is pending, snapshotThreadId is intentionally still
    // the previous thread. Persisting it here races the target activation and
    // makes the tab highlight jump back to the old thread.
    if (pendingThreadTarget) return;
    if (closingTabIdsRef.current.has(snapshotThreadId)) return;
    void window.omni.tabs
      .open(snapshotThreadId)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      })
      .catch(() => {});
  }, [
    snapshotThreadId,
    pendingThreadTarget,
    draft,
    draftCompletionThreadId,
    clearDraftCompletion,
    queryClient,
  ]);

  useEffect(() => {
    if (!requestedThreadId) return;
    if (requestedThreadId === snapshotThreadId || pendingThreadTarget !== requestedThreadId) {
      requestThread(null);
    }
  }, [requestedThreadId, snapshotThreadId, pendingThreadTarget, requestThread]);

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
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

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

  const handleSelectThread = async (id: string, activateView = true) => {
    const currentDraft = useWorkspaceViewStore.getState().draft;
    if (currentDraft?.dirty) {
      const ok = confirmDiscardDraft();
      if (!ok) return;
    }
    if (currentDraft) endDraft();
    closingTabIdsRef.current.delete(id);
    await selectThread(id, { activateView });
  };

  const handleCloseThreadTab = async (id: string) => {
    if (closingTabIdsRef.current.has(id)) return;
    closingTabIdsRef.current.add(id);
    try {
      const wasActive = id === (snapshotThreadId ?? activeThreadId);
      const nextState = await window.omni.tabs.close(id);
      await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      if (!wasActive) return;
      if (nextState.activeThreadId) {
        await handleSelectThread(nextState.activeThreadId, mode !== "terminal");
      } else {
        requestThread(null);
        const sessions = useTerminalStore.getState().sessions;
        const referencedTerminalId = useWorkspaceViewStore.getState().activeTerminalId;
        const terminalId = sessions.some((session) => session.id === referencedTerminalId)
          ? referencedTerminalId
          : (sessions[0]?.id ?? null);
        if (mode === "agent" && terminalId) {
          showTerminal(terminalId);
        } else {
          const project = activeProject;
          const worktreePath = project
            ? normalizeWorkspacePath(selectedWorktreePathByProject[project.id], project.path)
            : null;
          beginDraft({
            projectId: project?.id ?? null,
            previousActiveProjectId: project?.id ?? null,
            worktreePath,
          });
          showAgent();
        }
      }
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Close tab failed",
        description: err instanceof Error ? err.message : "The active tab could not be changed.",
      });
    } finally {
      closingTabIdsRef.current.delete(id);
    }
  };

  const handleNewThread = () => {
    setIsDropdownOpen(false);
    const currentDraft = useWorkspaceViewStore.getState().draft;
    if (currentDraft?.dirty) {
      const ok = confirmDiscardDraft();
      if (!ok) return;
    } else if (currentDraft) {
      showAgent();
      return;
    }
    const project = activeProject;
    const worktreePath = project
      ? normalizeWorkspacePath(selectedWorktreePathByProject[project.id], project.path)
      : null;
    beginDraft({
      projectId: project?.id ?? null,
      previousActiveProjectId: project?.id ?? null,
      worktreePath,
    });
    showAgent();
  };

  const handleSelectTerminal = (id: string) => {
    showTerminal(id);
  };

  const handleNewTerminal = () => {
    const project = activeProject;
    const cwd = project ? (selectedWorktreePathByProject[project.id] ?? project.path) : undefined;
    const id = createSession(cwd);
    showTerminal(id);
  };

  const handleCloseTerminal = (id: string) => {
    const wasViewTerminal = mode === "terminal";
    const wasReferencedTerminal = activeTerminalId === id;
    const next = closeSession(id);
    if (!wasReferencedTerminal) return;
    if (wasViewTerminal) {
      if (next) {
        showTerminal(next);
      } else {
        const hasOpenThreads = orderedOpenThreads.length > 0;
        const targetThreadId = snapshotThreadId ?? activeThreadId ?? orderedOpenThreads[0]?.id;
        if (hasOpenThreads && targetThreadId) {
          showAgent();
        } else {
          const project = activeProject;
          const worktreePath = project
            ? normalizeWorkspacePath(selectedWorktreePathByProject[project.id], project.path)
            : null;
          beginDraft({
            projectId: project?.id ?? null,
            previousActiveProjectId: project?.id ?? null,
            worktreePath,
          });
          showAgent();
        }
      }
    } else {
      setViewActiveTerminalId(next);
    }
  };

  // Draft is tab-less: use a sentinel that matches no TabItem so nothing highlights.
  const selectedThreadId = optimisticRequestedThreadId ?? snapshotThreadId ?? activeThreadId ?? "";
  const selectedTabValue =
    mode === "terminal" && activeTerminalId
      ? `${TERMINAL_TAB_PREFIX}${activeTerminalId}`
      : draft
        ? "__draft__"
        : selectedThreadId;

  const orderedTabValues = useMemo(
    () =>
      tabValuesInBarOrder(
        visibleOpenThreads.map((thread) => thread.id),
        visibleTerminalTabs.map((session) => session.id),
        TERMINAL_TAB_PREFIX,
      ),
    [visibleOpenThreads, visibleTerminalTabs],
  );

  const handleTabChangeRef = useRef<(value: string) => void>(() => {});
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;

  const handleTabChange = (value: string) => {
    const clickStartedAt = performance.now();
    beginRendererInteraction("tab-click");
    if (value.startsWith(TERMINAL_TAB_PREFIX)) {
      handleSelectTerminal(value.slice(TERMINAL_TAB_PREFIX.length));
      return;
    }
    const highlightPaint = new Promise<number>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(performance.now() - clickStartedAt));
      });
    });
    void handleSelectThread(value)
      .then(async () => {
        const clickToSwitchResolvedMs = performance.now() - clickStartedAt;
        // The selected tab changes optimistically, before the main-process
        // activation promise settles. Start its double-rAF clock at click time
        // so a background snapshot reconciliation is not misreported as paint.
        const clickToHighlightPaintMs = await highlightPaint;
        void window.omni.monitor?.reportTabClickTiming({
          timestamp: Date.now(),
          threadId: value,
          clickToHighlightPaintMs,
          clickToSwitchResolvedMs,
          switchDurationMs: null,
          phase: null,
          success: true,
        });
      })
      .catch((err) => {
        void window.omni.monitor?.reportTabClickTiming({
          timestamp: Date.now(),
          threadId: value,
          clickToHighlightPaintMs: performance.now() - clickStartedAt,
          clickToSwitchResolvedMs: performance.now() - clickStartedAt,
          switchDurationMs: null,
          phase: null,
          success: false,
        });
        toast({
          icon: <WarningIcon className="size-5 text-red-500" />,
          title: "Thread switch failed",
          description: err instanceof Error ? err.message : "The thread could not be opened.",
        });
      });
  };
  handleTabChangeRef.current = handleTabChange;

  const handleCloseActiveTab = () => {
    const currentMode = useWorkspaceViewStore.getState().mode;
    const currentDraft = useWorkspaceViewStore.getState().draft;
    const curTerminalId = useWorkspaceViewStore.getState().activeTerminalId;
    const curThreadId = optimisticRequestedThreadId ?? snapshotThreadId ?? activeThreadId;

    if (currentDraft) {
      if (currentDraft.dirty) {
        const ok = confirmDiscardDraft();
        if (!ok) return;
      }
      endDraft();
      return;
    }

    if (currentMode === "terminal" && curTerminalId) {
      handleCloseTerminal(curTerminalId);
      return;
    }

    if (curThreadId) {
      void handleCloseThreadTab(curThreadId);
    }
  };

  const handleCloseActiveTabRef = useRef(handleCloseActiveTab);
  handleCloseActiveTabRef.current = handleCloseActiveTab;

  useEffect(() => {
    const activateTabAtIndex = (index: number) => {
      const value = tabValueAtShortcutIndex(orderedTabValues, index);
      if (!value) return;
      handleTabChangeRef.current(value);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isNewTabShortcutEvent(event)) {
        event.preventDefault();
        handleNewThreadRef.current();
        return;
      }
      if (isCloseTabShortcutEvent(event)) {
        event.preventDefault();
        handleCloseActiveTabRef.current();
        return;
      }
      const index = tabIndexFromShortcutEvent(event);
      if (index == null) return;
      if (!tabValueAtShortcutIndex(orderedTabValues, index)) return;
      event.preventDefault();
      activateTabAtIndex(index);
    };

    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribeSelect = window.omni.tabs.onSelectByIndex?.(activateTabAtIndex);
    const unsubscribeNewTab = window.omni.tabs.onNewTab?.(() => handleNewThreadRef.current());
    const unsubscribeCloseActive = window.omni.tabs.onCloseActive?.(() =>
      handleCloseActiveTabRef.current(),
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribeSelect?.();
      unsubscribeNewTab?.();
      unsubscribeCloseActive?.();
    };
  }, [orderedTabValues]);

  return (
    <Tabs value={selectedTabValue} onValueChange={handleTabChange}>
      <div
        className="flex w-full max-w-[1000px] min-w-0 items-center gap-1"
        data-pipper-id="global-tab-bar"
      >
        <TabsList
          data-pipper-id="global-tabs"
          className="min-w-0 flex-1 gap-1 overflow-x-auto p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
          {visibleTerminalTabs.map((session, idx) => (
            <TabItem
              key={session.id}
              index={visibleOpenThreads.length + idx}
              value={`${TERMINAL_TAB_PREFIX}${session.id}`}
              label={session.title}
              scrollLabelOnHover
              icon={
                session.status === "exited" || session.status === "error"
                  ? WarningIcon
                  : TerminalWindowIcon
              }
              onClose={() => handleCloseTerminal(session.id)}
              title={
                session.status === "exited"
                  ? "Terminal process exited"
                  : session.status === "error"
                    ? "Terminal failed to start"
                    : undefined
              }
              className={
                session.status === "exited" || session.status === "error"
                  ? "[&_svg]:!text-red-500"
                  : undefined
              }
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
            onClick={() => setIsDropdownOpen((prev) => !prev)}
          >
            <PlusIcon size={16} />
          </Button>

          {isDropdownOpen && (
            <div
              data-pipper-id="add-tab-dropdown"
              ref={dropdownRef}
              className="absolute left-0 top-full mt-1.5 z-[200]"
            >
              <Dropdown className="w-56">
                <MenuItem
                  index={0}
                  label="New terminal"
                  icon={TerminalWindowIcon}
                  onSelect={() => {
                    setIsDropdownOpen(false);
                    handleNewTerminal();
                  }}
                />
                <MenuItem
                  index={1}
                  label="New thread"
                  icon={ChatCircleIcon}
                  onSelect={handleNewThread}
                />
                <DropdownSeparator />
                <MenuItem
                  index={2}
                  label="New project"
                  icon={FolderPlusIcon}
                  onSelect={async () => {
                    setIsDropdownOpen(false);
                    await window.omni.launch.show("add");
                  }}
                />
              </Dropdown>
            </div>
          )}
        </div>
      </div>
    </Tabs>
  );
}
