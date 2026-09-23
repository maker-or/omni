import { beforeEach, describe, expect, test } from "vitest";
import { selectDraftContextProjectId, useWorkspaceViewStore } from "./workspace-view-store";

describe("workspace-view-store draft", () => {
  beforeEach(() => {
    useWorkspaceViewStore.setState({
      mode: "agent",
      activeTerminalId: null,
      requestedThreadId: "stale-thread",
      draft: null,
      draftCompletionThreadId: null,
    });
  });

  test("beginDraft clears thread request, sets agent mode, seeds project", () => {
    useWorkspaceViewStore.getState().beginDraft({
      projectId: "p1",
      previousActiveProjectId: "p0",
      worktreePath: "/repo/wt",
    });
    const state = useWorkspaceViewStore.getState();
    expect(state.mode).toBe("agent");
    expect(state.requestedThreadId).toBeNull();
    expect(state.draft).toEqual({
      projectId: "p1",
      agentId: null,
      modelId: null,
      worktreePath: "/repo/wt",
      dirty: false,
      previousActiveProjectId: "p0",
      softDefaultProject: true,
    });
  });

  test("beginDraft without project leaves chrome unbound", () => {
    useWorkspaceViewStore.getState().beginDraft();
    expect(useWorkspaceViewStore.getState().draft?.projectId).toBeNull();
    expect(selectDraftContextProjectId(useWorkspaceViewStore.getState().draft)).toBeNull();
  });

  test("setDraftProject and endDraft", () => {
    useWorkspaceViewStore.getState().beginDraft();
    useWorkspaceViewStore.getState().setDraftProject("p2", "/p2");
    expect(useWorkspaceViewStore.getState().draft?.projectId).toBe("p2");
    expect(useWorkspaceViewStore.getState().draft?.dirty).toBe(true);
    useWorkspaceViewStore.getState().endDraft();
    expect(useWorkspaceViewStore.getState().draft).toBeNull();
  });

  test("completed draft carries the created thread to the tab bar", () => {
    useWorkspaceViewStore.getState().beginDraft({ projectId: "p1" });
    useWorkspaceViewStore.getState().completeDraft("new-thread");

    expect(useWorkspaceViewStore.getState().draft).toBeNull();
    expect(useWorkspaceViewStore.getState().draftCompletionThreadId).toBe("new-thread");

    useWorkspaceViewStore.getState().clearDraftCompletion();
    expect(useWorkspaceViewStore.getState().draftCompletionThreadId).toBeNull();
  });

  test("changing project without worktree clears stale worktree path", () => {
    useWorkspaceViewStore.getState().beginDraft({
      projectId: "p1",
      worktreePath: "/repo/a",
    });
    useWorkspaceViewStore.getState().setDraftProject("p2");
    const draft = useWorkspaceViewStore.getState().draft;
    expect(draft?.projectId).toBe("p2");
    expect(draft?.worktreePath).toBeNull();
  });

  test("setDraftAgent / setDraftModel", () => {
    useWorkspaceViewStore.getState().beginDraft({ projectId: "p1" });
    useWorkspaceViewStore.getState().setDraftAgent("claude");
    useWorkspaceViewStore.getState().setDraftModel("sonnet");
    const draft = useWorkspaceViewStore.getState().draft;
    expect(draft?.agentId).toBe("claude");
    expect(draft?.modelId).toBe("sonnet");
  });
});

describe("workspace-view-store browser + seeded drafts", () => {
  test("a seeded draft (e.g. from the Morning Brief) starts dirty with its text", () => {
    useWorkspaceViewStore.getState().beginDraft({ projectId: "p1", seedText: "Review PR #42" });
    const draft = useWorkspaceViewStore.getState().draft;
    expect(draft?.seedText).toBe("Review PR #42");
    expect(draft?.dirty).toBe(true);
  });

  test("showBrowser switches the workspace to that browser tab", () => {
    useWorkspaceViewStore.getState().showBrowser("browser-1");
    const state = useWorkspaceViewStore.getState();
    expect(state.mode).toBe("browser");
    expect(state.activeBrowserTabId).toBe("browser-1");
  });
});
