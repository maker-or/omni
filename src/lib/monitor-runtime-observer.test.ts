// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonitorRendererTelemetry } from "../../contracts/monitor.ts";
import {
  createMonitorObserverId,
  startMonitorRuntimeObserver,
} from "./monitor-runtime-observer.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("monitor-runtime-observer", () => {
  it("creates an observer id", () => {
    const id = createMonitorObserverId();
    expect(id).toMatch(/^renderer-/);
  });

  it("runs the DOM census only on demand, plus a sparse background census", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
    document.body.innerHTML = '<div data-pipper-id="agent-panel"><span></span></div>';
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    let detailed = false;
    const telemetry: MonitorRendererTelemetry[] = [];
    const stop = startMonitorRuntimeObserver(
      {
        observerId: "test",
        getActiveThreadId: () => null,
        getRunningThreadIds: () => [],
        isDetailed: () => detailed,
      },
      (sample) => telemetry.push(sample),
    );
    // First sample takes a census at idle; no mutation tracking without demand.
    vi.advanceTimersByTime(0);
    expect(observe).not.toHaveBeenCalled();
    expect(telemetry[0].domAttributions.map((entry) => entry.id)).toEqual(["agent-panel"]);
    vi.advanceTimersByTime(5000 * 3);
    expect(telemetry.slice(1).every((sample) => sample.domAttributions.length === 0)).toBe(true);
    expect(telemetry.every((sample) => sample.domNodeCount > 0)).toBe(true);

    detailed = true;
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(1); // the census runs at idle, after the sample tick
    expect(observe).toHaveBeenCalledTimes(1);
    expect(telemetry.at(-1)!.domAttributions.map((entry) => entry.id)).toEqual(["agent-panel"]);
    stop();
  });
});
