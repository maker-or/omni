import { beforeEach, expect, test, vi } from "vitest";
const stored = vi.hoisted(() => new Map<string, string>());
vi.mock("./db.ts", () => ({
  getAppSetting: (key: string) => stored.get(key) ?? null,
  setAppSetting: (key: string, value: string) => stored.set(key, value),
}));
import { getWorktreeAutoInstall, setWorktreeAutoInstall } from "./worktree-preferences.ts";
beforeEach(() => stored.clear());
test("preserves automatic installation by default and persists an opt-out", () => {
  expect(getWorktreeAutoInstall()).toBe(true);
  setWorktreeAutoInstall(false);
  expect(getWorktreeAutoInstall()).toBe(false);
  setWorktreeAutoInstall(true);
  expect(getWorktreeAutoInstall()).toBe(true);
});
test("rejects untyped IPC input", () => {
  expect(() => setWorktreeAutoInstall("false" as unknown as boolean)).toThrow("boolean");
  expect(getWorktreeAutoInstall()).toBe(true);
});
