import { describe, expect, it } from "vitest";
import { samplePid } from "./platform-sampler.ts";

describe("samplePid", () => {
  it("samples the current process", async () => {
    const sample = await samplePid(process.pid);
    expect(sample).not.toBeNull();
    expect(sample!.memoryBytes).toBeGreaterThan(0);
    expect(sample!.threadCount).toBeGreaterThan(0);
  });
});
