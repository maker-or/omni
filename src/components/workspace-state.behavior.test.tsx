// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WorkspaceStateAction } from "./workspace-state";
import { WorkspaceStateGallery } from "./workspace-state-gallery";
import { SplitButton } from "./workspace-split-button";
import { ShapeProvider } from "@/lib/shape-context";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.classList.remove("dark");
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((el) => el.textContent?.trim() === label)!;

test("state actions preserve native disabled and loading behavior", async () => {
  const action = vi.fn();
  await act(async () =>
    root.render(
      <>
        <WorkspaceStateAction tone="merged" onClick={action}>
          Delete
        </WorkspaceStateAction>
        <WorkspaceStateAction tone="ready" disabled onClick={action}>
          Disabled
        </WorkspaceStateAction>
        <WorkspaceStateAction tone="action" loading onClick={action}>
          Loading
        </WorkspaceStateAction>
      </>,
    ),
  );
  act(() => {
    button("Delete").click();
    button("Disabled").click();
    button("Loading").click();
  });
  expect(action).toHaveBeenCalledOnce();
  expect(button("Disabled").disabled).toBe(true);
  expect(button("Loading").disabled).toBe(true);
});

test("split controls dismiss the menu and run an action once", async () => {
  const action = vi.fn();
  await act(async () =>
    root.render(
      <SplitButton
        tone="action"
        label="Push"
        onPrimary={action}
        items={[{ label: "Commit", icon: <span />, onSelect: action }]}
      />,
    ),
  );
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="More options"]')!;
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  act(() => button("Commit").click());
  expect(action).toHaveBeenCalledOnce();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  act(() => toggle.click());
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

test("the gallery changes its preview without changing the app theme or calling Git", async () => {
  document.documentElement.classList.add("dark");
  await act(async () => root.render(<WorkspaceStateGallery />));
  expect(host.querySelectorAll("[data-state-sample]")).toHaveLength(10);
  const card = host.querySelector<HTMLButtonElement>('[aria-label="Merged workspace selection"]')!;
  act(() => card.click());
  expect(card.getAttribute("aria-pressed")).toBe("false");
  act(() => button("Light").click());
  expect(host.querySelectorAll("[data-state-sample]")).toHaveLength(5);
  expect(host.querySelector('[data-workspace-theme="dark"]')).toBeNull();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  act(() => button("Merge").click());
  expect(host.textContent).toContain("Preview only: Merge");
});

test("state actions follow the shared shape provider", async () => {
  await act(async () =>
    root.render(
      <ShapeProvider defaultShape="rounded">
        <WorkspaceStateAction tone="ready">Merge</WorkspaceStateAction>
      </ShapeProvider>,
    ),
  );
  expect(button("Merge").classList.contains("rounded-lg")).toBe(true);
});
