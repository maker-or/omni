import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import type { OmniApi } from "./preload.ts";

const bridge = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));
const ipc = new EventEmitter();
vi.mock("electron", () => ({ contextBridge: bridge, ipcRenderer: ipc }));

test("routes the native new-terminal action once and removes its listener on cleanup", async () => {
  await import("./preload.ts");
  const api = bridge.exposeInMainWorld.mock.calls.find(([name]) => name === "omni")![1] as OmniApi;
  const openTerminal = vi.fn();
  const unsubscribe = api.tabs.onNewTerminal(openTerminal);

  ipc.emit("tabs:newTab");
  expect(openTerminal).not.toHaveBeenCalled();
  ipc.emit("tabs:newTerminal");
  expect(openTerminal).toHaveBeenCalledTimes(1);

  unsubscribe();
  ipc.emit("tabs:newTerminal");
  expect(openTerminal).toHaveBeenCalledTimes(1);
  expect(ipc.listenerCount("tabs:newTerminal")).toBe(0);
});
