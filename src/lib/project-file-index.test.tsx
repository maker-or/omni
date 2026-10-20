// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ThreadComposer } from "@/components/thread-composer";
import { buildContent } from "@/lib/composer-tokens";
import {
  invalidateProjectFiles,
  requestProjectFiles,
  resetProjectFileIndex,
  useProjectFileIndex,
  type ProjectFileSource,
} from "./project-file-index";

let root: Root;
let host: HTMLDivElement;
let listFiles: ReturnType<typeof vi.fn>;
let cancelListFiles: ReturnType<typeof vi.fn>;
let pending: Array<{ requestId: string; resolve: (paths: string[]) => void }>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  pending = [];
  listFiles = vi.fn(
    (_projectId: string | undefined, _path: string | null, requestId: string) =>
      new Promise<string[]>((resolve) => pending.push({ requestId, resolve })),
  );
  cancelListFiles = vi.fn();
  (window as unknown as { omni: unknown }).omni = {
    projects: { listFiles, cancelListFiles },
  };
  resetProjectFileIndex();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as unknown as { omni?: unknown }).omni;
  vi.unstubAllGlobals();
});

let setWorkspace: (path: string) => void = () => {};

function Harness({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath);
  setWorkspace = setPath;
  const [content, setContent] = useState(buildContent([], ""));
  const { items, request } = useProjectFileIndex({ projectId: "p1", worktreePath: path });
  return (
    <ThreadComposer
      mode="live"
      content={content}
      onContentChange={setContent}
      projectFiles={items}
      onFileMentionOpen={request}
      onSend={() => {}}
    />
  );
}

async function typeText(text: string) {
  await act(async () => {
    const editor = host.querySelector<HTMLElement>("[data-inline-text]")!;
    editor.textContent = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
}

async function resolveScan(index: number, paths: string[]) {
  await act(async () => pending[index]!.resolve(paths));
}

test("does not scan workspace files until the file mention menu opens", async () => {
  await act(async () => root.render(<Harness initialPath="/repo/a" />));
  await typeText("hello there");
  await act(async () => setWorkspace("/repo/b"));
  expect(listFiles).not.toHaveBeenCalled();

  await typeText("hello @");
  expect(listFiles).toHaveBeenCalledTimes(1);
  expect(listFiles).toHaveBeenCalledWith(undefined, "/repo/b", expect.any(String));
  await resolveScan(0, ["src/index.ts"]);
  expect(document.querySelector('[data-pipper-id="mention-popover"]')?.textContent).toContain(
    "index.ts",
  );
});

test("reuses a loaded list until it is invalidated", async () => {
  await act(async () => root.render(<Harness initialPath="/repo/a" />));
  await typeText("@");
  await resolveScan(0, ["a.ts"]);
  await typeText("");
  await typeText("@");
  expect(listFiles).toHaveBeenCalledTimes(1);

  invalidateProjectFiles({ projectId: "p1", worktreePath: "/repo/a" });
  await typeText("");
  await typeText("@");
  expect(listFiles).toHaveBeenCalledTimes(2);
});

test("cancels the abandoned scan when the workspace changes mid-request", async () => {
  await act(async () => root.render(<Harness initialPath="/repo/a" />));
  await typeText("@");
  const firstRequest = listFiles.mock.calls[0]![2];
  await act(async () => setWorkspace("/repo/b"));
  expect(cancelListFiles).toHaveBeenCalledWith(firstRequest);
  // The menu is still open, so the new workspace is listed instead.
  expect(listFiles).toHaveBeenCalledTimes(2);
  expect(listFiles.mock.calls[1]![1]).toBe("/repo/b");
});

test("coalesces concurrent requests for the same workspace", () => {
  const source: ProjectFileSource = { projectId: "p1", worktreePath: "/repo/a" };
  const releaseA = requestProjectFiles(source);
  const releaseB = requestProjectFiles(source);
  expect(listFiles).toHaveBeenCalledTimes(1);
  releaseA();
  expect(cancelListFiles).not.toHaveBeenCalled();
  releaseB();
  expect(cancelListFiles).toHaveBeenCalledTimes(1);
});

test("refreshes a list that has aged past the reuse window", async () => {
  const source: ProjectFileSource = { projectId: "p1", worktreePath: "/repo/a" };
  requestProjectFiles(source, 0);
  await act(async () => pending[0]!.resolve(["a.ts"]));
  requestProjectFiles(source, Date.now() + 1_000);
  expect(listFiles).toHaveBeenCalledTimes(1);
  requestProjectFiles(source, Date.now() + 60_000);
  expect(listFiles).toHaveBeenCalledTimes(2);
});
