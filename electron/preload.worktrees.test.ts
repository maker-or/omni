import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import type { OmniApi } from "./preload.ts";

const bridge = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));
const ipc = new EventEmitter();
vi.mock("electron", () => ({ contextBridge: bridge, ipcRenderer: ipc }));

test("delivers workspace removal events and unsubscribes on cleanup", async () => {
  await import("./preload.ts");
  const api = bridge.exposeInMainWorld.mock.calls.find(([name]) => name === "omni")![1] as OmniApi;
  const onDeleted = vi.fn();
  const unsubscribe = api.worktrees.onDeleted(onDeleted);
  const workspace = { projectId: "project-a", path: "/worktrees/workspace-a" };

  ipc.emit("worktrees:deleted", {}, workspace);
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith(workspace);

  unsubscribe();
  ipc.emit("worktrees:deleted", {}, workspace);
  expect(onDeleted).toHaveBeenCalledTimes(1);
  expect(ipc.listenerCount("worktrees:deleted")).toBe(0);
});
