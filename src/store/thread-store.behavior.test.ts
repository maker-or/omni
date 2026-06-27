import { afterEach, describe, expect, test, vi } from "vitest";
import type { Thread } from "../../contracts/threads.ts";
import { useThreadStore } from "./thread-store";

function thread(id: string, projectId = "project-1"): Thread {
  return {
    id,
    project_id: projectId,
    title: id,
    session_file: null,
    created_at: Number(id.replace(/\D/g, "")) || 1,
    last_used_at: Number(id.replace(/\D/g, "")) || 1,
  };
}

function resetStore() {
  useThreadStore.setState({
    threads: [],
    pagesByProject: {},
    isLoading: false,
    error: null,
  });
}

afterEach(() => {
  resetStore();
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("thread store pagination behavior", () => {
  test("reset page loads replace only that project's cached threads", async () => {
    const pageThreads = [thread("thread-10"), thread("thread-11")];
    const listProject = vi.fn(async () => ({
      threads: pageThreads,
      hasMore: true,
      nextOffset: 10,
    }));
    (globalThis as any).window = { omni: { threads: { listProject } } };
    useThreadStore.setState({
      threads: [thread("stale-1"), thread("other-1", "project-2")],
      pagesByProject: {
        "project-1": { nextOffset: 20, hasMore: false, isLoading: false },
      },
      isLoading: false,
      error: null,
    });

    await useThreadStore.getState().loadProjectThreads("project-1", { reset: true });

    expect(listProject).toHaveBeenCalledWith({ projectId: "project-1", limit: 10, offset: 0 });
    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual([
      "other-1",
      "thread-10",
      "thread-11",
    ]);
    expect(useThreadStore.getState().pagesByProject["project-1"]).toEqual({
      nextOffset: 10,
      hasMore: true,
      isLoading: false,
    });
  });

  test("does not fetch another page when pagination says no more data", async () => {
    const listProject = vi.fn();
    (globalThis as any).window = { omni: { threads: { listProject } } };
    useThreadStore.setState({
      pagesByProject: {
        "project-1": { nextOffset: 10, hasMore: false, isLoading: false },
      },
    });

    await useThreadStore.getState().loadProjectThreads("project-1");

    expect(listProject).not.toHaveBeenCalled();
  });

  test("keeps retryable pagination state after page load failure", async () => {
    const listProject = vi.fn(async () => {
      throw new Error("network down");
    });
    (globalThis as any).window = { omni: { threads: { listProject } } };

    await useThreadStore.getState().loadProjectThreads("project-1");

    expect(useThreadStore.getState().error).toBe("network down");
    expect(useThreadStore.getState().pagesByProject["project-1"]).toEqual({
      nextOffset: 0,
      hasMore: true,
      isLoading: false,
    });
  });

  test("adding a thread does not skew the next paginated offset", () => {
    useThreadStore.setState({
      threads: [thread("thread-1")],
      pagesByProject: {
        "project-1": { nextOffset: 30, hasMore: true, isLoading: false },
      },
    });

    useThreadStore.getState().addThread(thread("thread-new"));

    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual([
      "thread-new",
      "thread-1",
    ]);
    expect(useThreadStore.getState().pagesByProject["project-1"]).toEqual({
      nextOffset: 30,
      hasMore: true,
      isLoading: false,
    });
  });

  test("create and rename failures surface store errors without mutating threads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn(async () => {
      throw new Error("cannot create");
    });
    const rename = vi.fn(async () => {
      throw new Error("cannot rename");
    });
    (globalThis as any).window = { omni: { threads: { create, rename } } };
    useThreadStore.setState({ threads: [thread("thread-1")] });

    await expect(
      useThreadStore.getState().createThread("project-1", "New thread"),
    ).resolves.toBeNull();
    expect(useThreadStore.getState().error).toBe("cannot create");
    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual(["thread-1"]);

    await expect(useThreadStore.getState().renameThread("thread-1", "Renamed")).resolves.toBeNull();
    expect(useThreadStore.getState().error).toBe("cannot rename");
    expect(useThreadStore.getState().threads[0]?.title).toBe("thread-1");
  });

  test("delete removes the thread on success and rethrows failure for callers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deleteThread = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("cannot delete"));
    (globalThis as any).window = { omni: { threads: { delete: deleteThread } } };
    useThreadStore.setState({ threads: [thread("thread-1"), thread("thread-2")] });

    await useThreadStore.getState().deleteThread("thread-1");
    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual(["thread-2"]);
    expect(useThreadStore.getState().error).toBeNull();

    await expect(useThreadStore.getState().deleteThread("thread-2")).rejects.toThrow(
      "cannot delete",
    );
    expect(useThreadStore.getState().threads.map((item) => item.id)).toEqual(["thread-2"]);
    expect(useThreadStore.getState().error).toBe("cannot delete");
  });
});
