import { EventEmitter } from "node:events";
import { beforeAll, expect, test, vi } from "vitest";
import type { OmniApi } from "./preload.ts";

const bridge = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));
const ipc = new EventEmitter();
vi.mock("electron", () => ({ contextBridge: bridge, ipcRenderer: ipc }));

let api: OmniApi;
beforeAll(async () => {
  await import("./preload.ts");
  api = bridge.exposeInMainWorld.mock.calls.find(([name]) => name === "omni")![1] as OmniApi;
});

test("routes the native new-terminal action once and removes its listener on cleanup", () => {
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

test("routes horizontal native swipes and removes its listener on cleanup", () => {
  const switchTab = vi.fn();
  const unsubscribe = api.tabs.onSwipe(switchTab);

  ipc.emit("tabs:swipe", {}, "left");
  ipc.emit("tabs:swipe", {}, "right");
  ipc.emit("tabs:swipe", {}, "up");
  ipc.emit("tabs:swipe", {}, "down");
  ipc.emit("tabs:swipe", {}, null);
  expect(switchTab.mock.calls).toEqual([["left"], ["right"]]);

  unsubscribe();
  ipc.emit("tabs:swipe", {}, "left");
  expect(switchTab).toHaveBeenCalledTimes(2);
  expect(ipc.listenerCount("tabs:swipe")).toBe(0);
});
