import { afterEach, describe, expect, test, vi } from "vitest";
import { useProjectStore } from "./project-store";

function resetStore() {
  useProjectStore.setState({
    activeProject: null,
    isLoading: false,
    error: null,
  });
}

afterEach(() => {
  resetStore();
  delete (globalThis as { window?: unknown }).window;
});

describe("project store active project behavior", () => {
  test("loads the active project and clears stale errors", async () => {
    const project = {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project",
      icon: "folder",
      created_at: 1,
      last_opened_at: 2,
    };
    (globalThis as any).window = {
      omni: {
        projects: {
          getActive: vi.fn(async () => project),
        },
      },
    };
    useProjectStore.setState({ error: "old error" });

    await useProjectStore.getState().loadActiveProject();

    expect(useProjectStore.getState()).toMatchObject({
      activeProject: project,
      isLoading: false,
      error: null,
    });
  });

  test("preserves previous active project and surfaces load failures", async () => {
    const previous = {
      id: "project-old",
      name: "Old Project",
      path: "/tmp/old",
      icon: "folder",
      created_at: 1,
      last_opened_at: 2,
    };
    (globalThis as any).window = {
      omni: {
        projects: {
          getActive: vi.fn(async () => {
            throw new Error("project database unavailable");
          }),
        },
      },
    };
    useProjectStore.setState({ activeProject: previous });

    await useProjectStore.getState().loadActiveProject();

    expect(useProjectStore.getState()).toMatchObject({
      activeProject: previous,
      isLoading: false,
      error: "project database unavailable",
    });
  });

  test("clears the active project without touching loading or error state", () => {
    useProjectStore.setState({
      activeProject: {
        id: "project-1",
        name: "Project One",
        path: "/tmp/project",
        icon: "folder",
        created_at: 1,
        last_opened_at: 2,
      },
      isLoading: true,
      error: "kept",
    });

    useProjectStore.getState().clearActiveProject();

    expect(useProjectStore.getState()).toMatchObject({
      activeProject: null,
      isLoading: true,
      error: "kept",
    });
  });
});
