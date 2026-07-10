import { describe, expect, test } from "vitest";
import { TerminalManager } from "./terminal-manager.ts";

describe("TerminalManager", () => {
  test("create, stream output, waitForExit, release", async () => {
    const chunks: Array<{ id: string; chunk: string }> = [];
    const manager = new TerminalManager({
      onOutput: (id, chunk) => chunks.push({ id, chunk }),
    });
    const id = manager.create({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello-acp'); process.exit(0);"],
      outputByteLimit: 1024,
    });
    expect(id).toBeTruthy();
    const exit = await manager.waitForExit(id);
    expect(exit.exitCode).toBe(0);
    const output = manager.getOutput(id);
    expect(output.output).toContain("hello-acp");
    expect(output.exitStatus?.exitCode).toBe(0);
    expect(chunks.some((c) => c.id === id && c.chunk.includes("hello-acp"))).toBe(true);
    manager.release(id);
    expect(() => manager.getOutput(id)).toThrow(/Unknown terminal/);
  });

  test("kill keeps terminalId for output query until release", async () => {
    const manager = new TerminalManager();
    const id = manager.create({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    manager.kill(id);
    await manager.waitForExit(id);
    const out = manager.getOutput(id);
    expect(out.exitStatus).not.toBeNull();
    manager.release(id);
  });

  test("killRunning terminates all active terminals without releasing", async () => {
    const manager = new TerminalManager();
    const id = manager.create({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    manager.killRunning();
    await manager.waitForExit(id);
    expect(manager.getOutput(id).exitStatus).not.toBeNull();
    manager.release(id);
  });
});
