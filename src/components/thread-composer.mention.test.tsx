// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ThreadComposer } from "./thread-composer";
import { buildContent, getFreeText } from "@/lib/composer-tokens";

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
const send = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Harness() {
  const [content, setContent] = useState(buildContent([], ""));
  return (
    <ThreadComposer
      mode="live"
      content={content}
      onContentChange={setContent}
      projectFiles={[{ id: "src/thread.ts", label: "src/thread.ts" }]}
      onSend={(next) => {
        send(getFreeText(next));
        setContent(buildContent([], ""));
      }}
    />
  );
}

async function typeText(text: string) {
  await act(async () => {
    const editor = host.querySelector<HTMLElement>("[data-inline-text]")!;
    editor.textContent = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flushFrames() {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
}

test.each([
  ["send button with matching files", "@thread", "button", false],
  ["send button with no matching files", "@missing", "button", false],
  ["Enter with no matching files", "@missing", "enter", false],
  ["Enter while the latest mention update is pending", "@missing", "enter", true],
] as const)("closes the file dropdown: %s", async (_name, text, method, pendingUpdate) => {
  await act(async () => root.render(<Harness />));
  await typeText(text);
  await flushFrames();
  const popover = () => document.querySelector('[data-pipper-id="mention-popover"]');
  expect(popover()).not.toBeNull();
  const sentText = pendingUpdate ? `${text}c` : text;
  if (pendingUpdate) await typeText(sentText);
  await act(async () => {
    if (method === "button") {
      host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click();
    } else {
      host
        .querySelector<HTMLElement>("[data-inline-text]")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
    }
  });
  expect(send).toHaveBeenCalledWith(sentText);
  expect(send).toHaveBeenCalledTimes(1);
  expect(host.querySelector("[data-inline-text]")!.textContent).toBe("");
  expect(popover()).toBeNull();
  await flushFrames();
  expect(popover()).toBeNull();
});
