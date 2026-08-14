import { describe, expect, it } from "vitest";
import { createMonitorObserverId } from "./monitor-runtime-observer.ts";

describe("monitor-runtime-observer", () => {
  it("creates an observer id", () => {
    const id = createMonitorObserverId();
    expect(id).toMatch(/^renderer-/);
  });
});
