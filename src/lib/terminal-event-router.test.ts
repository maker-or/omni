import { describe, expect, it, vi } from "vitest";
import {
  createTerminalEventRouter,
  type TerminalDataPayload,
  type TerminalExitPayload,
} from "./terminal-event-router";

describe("terminal event router", () => {
  it("uses one IPC listener pair and routes events directly to their session", () => {
    let emitData: ((payload: TerminalDataPayload) => void) | null = null;
    let emitExit: ((payload: TerminalExitPayload) => void) | null = null;
    const stopData = vi.fn();
    const stopExit = vi.fn();
    const source = {
      onData: vi.fn((callback: (payload: TerminalDataPayload) => void) => {
        emitData = callback;
        return stopData;
      }),
      onExit: vi.fn((callback: (payload: TerminalExitPayload) => void) => {
        emitExit = callback;
        return stopExit;
      }),
    };
    const router = createTerminalEventRouter(source);
    const first = { onData: vi.fn(), onExit: vi.fn() };
    const second = { onData: vi.fn(), onExit: vi.fn() };

    const stopFirst = router.subscribe("first", first);
    const stopSecond = router.subscribe("second", second);
    emitData?.({ sessionId: "second", data: "ready" });
    emitExit?.({ sessionId: "first", exitCode: 0 });

    expect(source.onData).toHaveBeenCalledTimes(1);
    expect(source.onExit).toHaveBeenCalledTimes(1);
    expect(first.onData).not.toHaveBeenCalled();
    expect(first.onExit).toHaveBeenCalledWith({ sessionId: "first", exitCode: 0 });
    expect(second.onData).toHaveBeenCalledWith("ready");
    expect(second.onExit).not.toHaveBeenCalled();

    stopFirst();
    expect(stopData).not.toHaveBeenCalled();
    stopSecond();
    expect(stopData).toHaveBeenCalledOnce();
    expect(stopExit).toHaveBeenCalledOnce();
  });
});
