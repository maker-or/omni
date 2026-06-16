import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";

export const OPEN_TABS_QUERY_KEY = ["open-tabs"] as const;
const PROJECT_THREAD_PAGE_SIZE = 10;
const RECENT_THREAD_PREFETCH_COUNT = 5;

function projectThreadsQueryKey(projectId: string, limit = PROJECT_THREAD_PAGE_SIZE) {
  return ["project-threads", projectId, limit] as const;
}

function recentProjectsQueryKey(threadSwitchHistory: string[], openThreads: Thread[]) {
  return [
    "recent-projects",
    threadSwitchHistory.join("|"),
    openThreads.map((thread) => `${thread.id}:${thread.project_id}`).join("|"),
  ] as const;
}

async function fetchOpenTabs(): Promise<OpenTabsState & { openThreads: Thread[] }> {
  const state = await window.omni.tabs.listOpen();
  const openThreads = await window.omni.threads.listByIds(state.openThreadIds);
  const existingIds = new Set(openThreads.map((thread) => thread.id));
  const openThreadIds = state.openThreadIds.filter((id) => existingIds.has(id));
  return {
    ...state,
    openThreadIds,
    activeThreadId:
      state.activeThreadId && existingIds.has(state.activeThreadId)
        ? state.activeThreadId
        : (openThreadIds[0] ?? null),
    openThreads,
  };
}

export function useOpenTabsQuery() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.omni.tabs.onChanged((state) => {
      queryClient.setQueryData<
        OpenTabsState & {
          openThreads: Thread[];
        }
      >(OPEN_TABS_QUERY_KEY, (current) => ({
        ...state,
        openThreads: current?.openThreads ?? [],
      }));
      void queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: OPEN_TABS_QUERY_KEY,
    queryFn: fetchOpenTabs,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useProjectThreadsQuery(projectId: string | null, limit = PROJECT_THREAD_PAGE_SIZE) {
  return useQuery({
    queryKey: projectId ? projectThreadsQueryKey(projectId, limit) : ["project-threads", "none"],
    queryFn: async (): Promise<ThreadPage> => {
      if (!projectId) {
        return { threads: [], hasMore: false, nextOffset: 0 };
      }
      return window.omni.threads.listProject({ projectId, limit, offset: 0 });
    },
    enabled: Boolean(projectId),
    staleTime: 2 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function useRecentProjectsQuery(
  activeProjectId: string | null | undefined,
  threadSwitchHistory: string[],
  openThreads: Thread[],
) {
  return useQuery({
    queryKey: recentProjectsQueryKey(threadSwitchHistory, openThreads),
    queryFn: async () => {
      const byThreadId = new Map(openThreads.map((thread) => [thread.id, thread]));
      return [
        activeProjectId,
        ...threadSwitchHistory
          .map((threadId) => byThreadId.get(threadId)?.project_id)
          .filter((id): id is string => Boolean(id)),
        ...openThreads.map((thread) => thread.project_id),
      ]
        .filter((id): id is string => Boolean(id))
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .slice(0, 3);
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function usePrefetchRecentProjects(projectIds: string[]) {
  const queryClient = useQueryClient();
  const projectKey = projectIds.join("|");

  useEffect(() => {
    const ids = projectKey ? projectKey.split("|") : [];
    for (const projectId of ids) {
      void queryClient.prefetchQuery({
        queryKey: projectThreadsQueryKey(projectId, RECENT_THREAD_PREFETCH_COUNT),
        queryFn: () =>
          window.omni.threads.listProject({
            projectId,
            limit: RECENT_THREAD_PREFETCH_COUNT,
            offset: 0,
          }),
        staleTime: 2 * 60_000,
        gcTime: 30 * 60_000,
      });
    }
  }, [projectKey, queryClient]);
}

export function useMergedProjectThreads(
  projectId: string | null,
  queryThreads: Thread[],
  storeThreads: Thread[],
) {
  return useMemo(() => {
    if (!projectId) return [];
    const byId = new Map<string, Thread>();
    for (const thread of queryThreads) {
      if (thread.project_id === projectId) byId.set(thread.id, thread);
    }
    for (const thread of storeThreads) {
      if (thread.project_id === projectId) byId.set(thread.id, thread);
    }
    return Array.from(byId.values()).sort(
      (a, b) => b.last_used_at - a.last_used_at || b.created_at - a.created_at,
    );
  }, [projectId, queryThreads, storeThreads]);
}
