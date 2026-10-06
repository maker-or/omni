// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useTerminalStore } from "@/store/terminal-store";

const terminal = vi.hoisted(() => ({
  input: (_data: string) => {},
  output: vi.fn(),
  focus: vi.fn(),
}));
const bridge = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(async () => {}),
  resize: vi.fn(async () => {}),
  onData: vi.fn(),
  onExit: vi.fn(),
}));

vi.mock("@/lib/ghostty-core", () => ({ loadGhosttyCore: async () => ({}) }));
vi.mock("@wterm/react", async () => {
  const { forwardRef, useEffect, useImperativeHandle, useRef } = await import("react");
  return {
    useTerminal: () => ({ ref: useRef(null), write: terminal.output }),
    Terminal: forwardRef(function MockTerminal(props: any, ref) {
      const element = useRef<HTMLDivElement>(null);
      terminal.input = props.onData;
      useImperativeHandle(ref, () => ({
        focus: terminal.focus,
        instance: { element: element.current },
      }));
      useEffect(() => {
        props.onReady();
      }, [props.onReady]);
      return <div ref={element}>Terminal emulator</div>;
    }),
  };
});

let root: Root | null = null;
let container: HTMLDivElement;
let resolveCreate: () => void;
let emitData: (payload: { sessionId: string; data: string }) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.tagName === "SPAN" ? new DOMRect(0, 0, 8, 18) : new DOMRect(0, 0, 800, 600);
    },
  );
  bridge.create.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
  );
  bridge.onData.mockImplementation((handler) => {
    emitData = handler;
    return () => {};
  });
  bridge.onExit.mockImplementation(() => () => {});
  window.omni = { terminal: bridge } as unknown as typeof window.omni;
  useTerminalStore.setState({
    sessions: [
      {
        id: "test-terminal",
        title: "Terminal",
        cwd: "/workspace",
        status: "starting",
        history: "",
      },
    ],
    stashByWorkspace: {},
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("terminal keyboard input lifecycle", () => {
  test("Strict Mode forwards queued and subsequent input once the shell starts", async () => {
    const { TerminalSession } = await import("./terminal-session");
    await act(async () => {
      root!.render(
        <StrictMode>
          <TerminalSession sessionId="test-terminal" cwd="/workspace" isActive />
        </StrictMode>,
      );
    });
    expect(bridge.create).toHaveBeenCalledTimes(1);
    act(() => terminal.input("pwd"));
    expect(bridge.write).not.toHaveBeenCalled();

    await act(async () => resolveCreate());
    expect(bridge.write).toHaveBeenCalledWith("test-terminal", "pwd");
    expect(useTerminalStore.getState().sessions[0].status).toBe("running");

    act(() => terminal.input("\r"));
    expect(bridge.write).toHaveBeenCalledWith("test-terminal", "\r");
    act(() => emitData({ sessionId: "test-terminal", data: "pwd\r\n/workspace\r\n" }));
    expect(terminal.output).toHaveBeenCalledWith("pwd\r\n/workspace\r\n");
  });

  test("a genuinely unmounted terminal does not flush input when a late spawn resolves", async () => {
    const { TerminalSession } = await import("./terminal-session");
    await act(async () =>
      root!.render(<TerminalSession sessionId="test-terminal" cwd="/workspace" isActive />),
    );
    expect(bridge.create).toHaveBeenCalledTimes(1);
    act(() => terminal.input("pwd"));
    await act(async () => root!.unmount());
    root = null;
    await act(async () => resolveCreate());
    expect(bridge.write).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessions[0].status).toBe("starting");
  });
});
