import { useEffect } from "react";
import type { BriefOpenRequest, BriefPhase } from "../../contracts/brief.ts";
import { BRIEF_LATEST_URL } from "../../contracts/brief.ts";
import { normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";
import { confirmDiscardDraft } from "@/lib/thread-actions";
import { useBrowserStore } from "@/store/browser-store";
import { useProjectStore } from "@/store/project-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { useWorktreeStore } from "@/store/worktree-store";

/**
 * Renderer half of the Morning Brief. Main decides *when* the brief appears
 * (launch, schedule, wake); this module only reacts: it opens / focuses the
 * brief tab in the embedded browser, reloads it when a fresh brief lands, and
 * turns "Start in Pipper" actions into a prefilled thread draft.
 */

/** Open (or reuse) the brief tab; `activate` switches the workspace to it. */
export function openBriefTab(url: string = BRIEF_LATEST_URL, activate = true): string {
  const id = useBrowserStore.getState().openTab(url, { kind: "brief" });
  const view = useWorkspaceViewStore.getState();
  if (activate) view.showBrowser(id);
  else if (!view.activeBrowserTabId) view.setActiveBrowserTabId(id);
  return id;
}

/** Start a new thread draft in the current workspace with `prompt` prefilled. */
export function startDraftFromBrief(prompt: string): void {
  const view = useWorkspaceViewStore.getState();
  if (view.draft?.dirty && !confirmDiscardDraft()) return;
  const project = useProjectStore.getState().activeProject;
  const worktreePath = project
    ? normalizeWorkspacePath(
        useWorktreeStore.getState().selectedWorktreePathByProject[project.id],
        project.path,
      )
    : null;
  if (view.draft) view.endDraft();
  view.beginDraft({
    projectId: project?.id ?? null,
    previousActiveProjectId: project?.id ?? null,
    worktreePath,
    seedText: prompt,
  });
  view.showAgent();
}

function handleOpen(request: BriefOpenRequest | null): void {
  if (!request) return;
  openBriefTab(request.url, request.focus);
  void window.omni.brief.ackOpen().catch(() => {});
}

/** Mount once in the main window. */
export function useMorningBriefBridge(): void {
  useEffect(() => {
    const brief = window.omni?.brief;
    if (!brief) return;
    // A launch-time open can fire before this component mounted.
    void brief
      .takePendingOpen()
      .then(handleOpen)
      .catch(() => {});
    let lastPhase: BriefPhase | null = null;
    const offOpen = brief.onOpen(handleOpen);
    const offStatus = brief.onStatus((status) => {
      // The brief page itself doesn't poll; refresh it when a new one lands.
      if (status.phase === "ready" && lastPhase !== "ready") {
        useBrowserStore.getState().reloadKind("brief");
      }
      lastPhase = status.phase;
    });
    const offPrompt = brief.onAgentPrompt(({ prompt }) => startDraftFromBrief(prompt));
    return () => {
      offOpen();
      offStatus();
      offPrompt();
    };
  }, []);
}
