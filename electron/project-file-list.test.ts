import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { listProjectFiles, ProjectFileLister } from "./project-file-list.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "pipper-files-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src", "nested"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "");
  writeFileSync(join(dir, "src", "nested", "deep.ts"), "");
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "");
  writeFileSync(join(dir, ".env"), "");
  writeFileSync(join(dir, ".hidden"), "");
  return dir;
}

test("lists files of an uninitialized folder through the async walk", async () => {
  const dir = fixture();
  expect(await listProjectFiles(dir)).toEqual([".env", "src/index.ts", "src/nested/deep.ts"]);
});

test("an aborted listing rejects instead of finishing the walk", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(listProjectFiles(fixture(), controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

function deferredLister() {
  const started: Array<{ path: string; signal: AbortSignal; resolve: (p: string[]) => void }> = [];
  const lister = new ProjectFileLister(
    (path, signal) =>
      new Promise<string[]>((resolve, reject) => {
        started.push({ path, signal, resolve });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  return { lister, started };
}

test("concurrent requests for one workspace share a single scan", async () => {
  const { lister, started } = deferredLister();
  const a = lister.list("/repo");
  const b = lister.list("/repo/");
  expect(started).toHaveLength(1);
  started[0]!.resolve(["x.ts"]);
  expect(await a).toEqual(["x.ts"]);
  expect(await b).toEqual(["x.ts"]);
  expect(lister.activeJobs).toBe(0);
});

test("the shared scan is aborted only after every requester cancels", async () => {
  const { lister, started } = deferredLister();
  const first = lister.listForRequest("/repo", "r1");
  const second = lister.listForRequest("/repo", "r2");
  lister.cancel("r1");
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(started[0]!.signal.aborted).toBe(false);
  lister.cancel("r2");
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  expect(started[0]!.signal.aborted).toBe(true);
  expect(lister.activeJobs).toBe(0);
});

test("rapid workspace switches cancelled by the caller leave no backlog", async () => {
  const { lister, started } = deferredLister();
  const results = [];
  for (let index = 0; index < 10; index += 1) {
    if (index > 0) lister.cancel(`r${index - 1}`);
    results.push(lister.listForRequest(`/repo/${index}`, `r${index}`).catch(() => null));
  }
  expect(started.filter((job) => !job.signal.aborted)).toHaveLength(1);
  expect(lister.activeJobs).toBe(1);
  started.at(-1)!.resolve(["last.ts"]);
  expect((await Promise.all(results)).at(-1)).toEqual(["last.ts"]);
});
