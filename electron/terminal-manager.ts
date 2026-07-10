import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface TerminalCreateParams {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Array<{ name: string; value: string }> | Record<string, string>;
  outputByteLimit?: number;
}

export interface TerminalOutputResult {
  output: string;
  truncated: boolean;
  exitStatus: { exitCode: number | null; signal: string | null } | null;
}

export interface TerminalExitResult {
  exitCode: number | null;
  signal: string | null;
}

interface TerminalInstance {
  process: ChildProcessWithoutNullStreams;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  exitPromise: Promise<void>;
  exitResolve: () => void;
}

function formatEnv(
  env?: Array<{ name: string; value: string }> | Record<string, string>,
): Record<string, string> {
  if (!env) return {};
  if (Array.isArray(env)) {
    const out: Record<string, string> = {};
    for (const entry of env) {
      if (entry?.name) out[entry.name] = entry.value ?? "";
    }
    return out;
  }
  return { ...env };
}

/** Truncate from the start at a character boundary when byte limit exceeded. */
function truncateOutput(buffer: string, byteLimit: number): { text: string; truncated: boolean } {
  if (byteLimit <= 0) return { text: buffer, truncated: false };
  let bytes = Buffer.byteLength(buffer, "utf8");
  if (bytes <= byteLimit) return { text: buffer, truncated: false };
  // Drop from start until under limit
  let start = 0;
  while (bytes > byteLimit && start < buffer.length) {
    start += 1;
    // skip if mid-surrogate
    if (start < buffer.length) {
      const code = buffer.charCodeAt(start);
      if (code >= 0xdc00 && code <= 0xdfff) start += 1;
    }
    bytes = Buffer.byteLength(buffer.slice(start), "utf8");
  }
  return { text: buffer.slice(start), truncated: true };
}

export class TerminalManager {
  private readonly terminals = new Map<string, TerminalInstance>();
  private readonly onOutput?: (terminalId: string, chunk: string) => void;

  constructor(options?: { onOutput?: (terminalId: string, chunk: string) => void }) {
    this.onOutput = options?.onOutput;
  }

  create(params: TerminalCreateParams): string {
    const id = randomUUID();
    const outputByteLimit = params.outputByteLimit ?? 1024 * 1024;
    let exitResolve: () => void = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });

    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd,
      env: { ...process.env, ...formatEnv(params.env) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const instance: TerminalInstance = {
      process: child,
      output: "",
      truncated: false,
      outputByteLimit,
      exitCode: null,
      exitSignal: null,
      exited: false,
      exitPromise,
      exitResolve,
    };

    const append = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      instance.output += text;
      const truncated = truncateOutput(instance.output, instance.outputByteLimit);
      instance.output = truncated.text;
      instance.truncated = instance.truncated || truncated.truncated;
      this.onOutput?.(id, text);
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (err) => {
      append(`\n[terminal error] ${err.message}\n`);
    });
    child.on("close", (code, signal) => {
      instance.exitCode = code;
      instance.exitSignal = signal;
      instance.exited = true;
      instance.exitResolve();
    });

    this.terminals.set(id, instance);
    return id;
  }

  kill(id: string): void {
    const term = this.terminals.get(id);
    if (!term || term.exited) return;
    try {
      term.process.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  getOutput(id: string): TerminalOutputResult {
    const term = this.require(id);
    return {
      output: term.output,
      truncated: term.truncated,
      exitStatus: term.exited ? { exitCode: term.exitCode, signal: term.exitSignal } : null,
    };
  }

  async waitForExit(id: string): Promise<TerminalExitResult> {
    const term = this.require(id);
    await term.exitPromise;
    return { exitCode: term.exitCode, signal: term.exitSignal };
  }

  release(id: string): void {
    const term = this.terminals.get(id);
    if (!term) return;
    if (!term.exited) {
      try {
        term.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.terminals.delete(id);
  }

  killAll(): void {
    // Snapshot ids — release mutates the map.
    for (const id of Array.from(this.terminals.keys())) {
      this.release(id);
    }
  }

  /** Kill all running processes without releasing (ids stay valid for output). */
  killRunning(): void {
    for (const id of Array.from(this.terminals.keys())) {
      this.kill(id);
    }
  }

  private require(id: string): TerminalInstance {
    const term = this.terminals.get(id);
    if (!term) throw new Error(`Unknown terminal: ${id}`);
    return term;
  }
}
