import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import type { AcpAgentDescriptor } from "../../contracts/acp.ts";

interface RegistryFile {
  agents: AcpAgentDescriptor[];
  defaultAgentId?: string;
}

/** Directory of this module (avoid naming `__dirname` — electron-vite injects that). */
const registryDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Adapter is an app dependency, not an on-demand npx download. */
function bundledCodexAcpPath(): string | null {
  try {
    return require.resolve("@agentclientprotocol/codex-acp");
  } catch {
    return null;
  }
}

/** Built-in catalog — used when config.json is missing or incomplete. */
export const BUILTIN_ACP_AGENTS: AcpAgentDescriptor[] = [
  {
    id: "cursor-acp",
    name: "cursor",
    displayName: "Cursor",
    description: "Cursor CLI agent over ACP (stdio JSON-RPC).",
    command: "agent",
    args: ["acp"],
    icon: "cursor",
    docsUrl: "https://cursor.com/docs/cli/acp",
    authHint: "Run `agent login` in your terminal (or set CURSOR_API_KEY) before connecting.",
    installHint:
      "Install Cursor CLI, then ensure `agent` is on your PATH (often ~/.local/bin/agent).",
    installKind: "binary",
    detectCommands: ["agent"],
  },
  {
    id: "codex-acp",
    name: "codex-cli",
    displayName: "Codex",
    description: "OpenAI Codex via the official ACP adapter.",
    command: "codex-acp",
    args: [],
    icon: "openai-codex",
    docsUrl: "https://github.com/agentclientprotocol/codex-acp",
    authHint: "Sign in with ChatGPT or provide CODEX_API_KEY / OPENAI_API_KEY.",
    installHint: "Bundled with Pipper Code.",
    installKind: "binary",
    npmPackage: "@agentclientprotocol/codex-acp",
  },
  {
    id: "claude-agent-acp",
    name: "claude-code",
    displayName: "Claude",
    description: "Claude Agent SDK via the official ACP adapter.",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
    icon: "anthropic",
    docsUrl: "https://github.com/agentclientprotocol/claude-agent-acp",
    authHint: "Authenticate Claude Code / set ANTHROPIC_API_KEY before connecting.",
    installHint:
      "npm install -g @agentclientprotocol/claude-agent-acp  (or use npx on first launch)",
    installKind: "npx",
    npmPackage: "@agentclientprotocol/claude-agent-acp",
    detectCommands: ["claude-agent-acp"],
  },
  {
    id: "pipper-mock",
    name: "pipper-mock",
    displayName: "Pipper Mock",
    description: "Local mock ACP agent for development and tests.",
    command: "node",
    args: [],
    icon: "robot",
    installKind: "mock",
    installHint: "Bundled with Pipper — always available.",
  },
];

function loadRegistryFile(): RegistryFile {
  const candidates = [
    join(registryDir, "config.json"),
    join(process.cwd(), "electron/agents/config.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as RegistryFile;
      if (Array.isArray(parsed.agents) && parsed.agents.length > 0) {
        return parsed;
      }
    } catch {
      // try next
    }
  }
  return {
    agents: BUILTIN_ACP_AGENTS,
    defaultAgentId: "cursor-acp",
  };
}

function pathDirs(): string[] {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const parts = pathEnv.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  const extras = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".cursor", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  return [...new Set([...parts, ...extras])];
}

/** Resolve a binary on PATH (and common install locations). */
export function findExecutableOnPath(command: string): string | null {
  if (!command) return null;
  // Absolute path
  if (command.includes("/") || command.includes("\\")) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      if (existsSync(command)) return command;
      return null;
    }
  }

  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  for (const dir of pathDirs()) {
    for (const ext of exts) {
      const candidate = join(dir, ext ? `${command}${ext.toLowerCase()}` : command);
      const alt = join(dir, ext ? `${command}${ext}` : command);
      for (const path of [candidate, alt]) {
        if (!existsSync(path)) continue;
        try {
          accessSync(path, constants.X_OK);
          return path;
        } catch {
          // On Windows, existence may be enough for .cmd/.bat
          if (process.platform === "win32") return path;
        }
      }
    }
  }

  // `which` fallback
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(whichCmd, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && existsSync(out)) return out;
  } catch {
    // not found
  }
  return null;
}

function hasNpx(): boolean {
  return Boolean(findExecutableOnPath("npx") || findExecutableOnPath("npm"));
}

/** Probe availability for one catalog entry. */
export function probeAgentAvailability(agent: AcpAgentDescriptor): AcpAgentDescriptor {
  const base: AcpAgentDescriptor = {
    ...agent,
    args: agent.args ?? [],
  };

  if (base.installKind === "mock" || base.id === "pipper-mock") {
    return {
      ...base,
      available: true,
      resolvedCommand: "node",
      statusMessage: null,
    };
  }

  if (base.id === "codex-acp") {
    const bundledPath = bundledCodexAcpPath();
    return bundledPath
      ? {
          ...base,
          available: true,
          resolvedCommand: bundledPath,
          statusMessage: null,
        }
      : {
          ...base,
          available: false,
          resolvedCommand: null,
          statusMessage: "Pipper's bundled Codex ACP adapter is missing. Reinstall Pipper.",
        };
  }

  // Prefer a globally installed binary when listed in detectCommands
  const detectList = base.detectCommands?.length ? base.detectCommands : [base.command];
  for (const cmd of detectList) {
    if (cmd === "npx" || cmd === "npm") continue;
    const found = findExecutableOnPath(cmd);
    if (found) {
      // Cursor uses `agent acp`; global codex-acp / claude-agent-acp run with no extra args
      if (base.id === "cursor-acp") {
        return {
          ...base,
          available: true,
          command: found,
          args: ["acp"],
          resolvedCommand: found,
          statusMessage: null,
        };
      }
      if (base.id === "codex-acp" || base.id === "claude-agent-acp") {
        return {
          ...base,
          available: true,
          command: found,
          args: [],
          resolvedCommand: found,
          statusMessage: null,
        };
      }
      return {
        ...base,
        available: true,
        command: found,
        resolvedCommand: found,
        statusMessage: null,
      };
    }
  }

  // npx-backed agents: available if npx exists (package fetched on demand)
  if (base.installKind === "npx" || base.command === "npx") {
    if (hasNpx()) {
      const npx = findExecutableOnPath("npx") ?? "npx";
      const pkg = base.npmPackage ?? base.args.find((a) => a.startsWith("@")) ?? "";
      return {
        ...base,
        available: true,
        command: npx,
        args: pkg ? ["-y", pkg] : (base.args ?? []),
        resolvedCommand: npx,
        statusMessage: pkg
          ? `Will launch via npx (${pkg}). First run may download the package.`
          : null,
      };
    }
    return {
      ...base,
      available: false,
      resolvedCommand: null,
      statusMessage: base.installHint ?? "Install Node.js / npm so npx is available.",
    };
  }

  // binary not found
  return {
    ...base,
    available: false,
    resolvedCommand: null,
    statusMessage: base.installHint ?? `Install ${base.displayName} and ensure it is on PATH.`,
  };
}

export function listRegisteredAgents(): AcpAgentDescriptor[] {
  const file = loadRegistryFile();
  // Merge config with builtins for any missing metadata fields
  const byId = new Map(BUILTIN_ACP_AGENTS.map((a) => [a.id, a]));
  const agents = file.agents.map((agent) => {
    const builtin = byId.get(agent.id);
    return {
      ...builtin,
      ...agent,
      args: agent.args ?? builtin?.args ?? [],
      detectCommands: agent.detectCommands ?? builtin?.detectCommands,
      docsUrl: agent.docsUrl ?? builtin?.docsUrl,
      authHint: agent.authHint ?? builtin?.authHint,
      installHint: agent.installHint ?? builtin?.installHint,
      installKind: agent.installKind ?? builtin?.installKind,
      npmPackage: agent.npmPackage ?? builtin?.npmPackage,
      description: agent.description ?? builtin?.description,
    } as AcpAgentDescriptor;
  });
  return agents.map(probeAgentAvailability);
}

export function getAgentDescriptor(agentId: string): AcpAgentDescriptor | null {
  return listRegisteredAgents().find((a) => a.id === agentId) ?? null;
}

export function getDefaultAgentId(): string {
  const file = loadRegistryFile();
  const agents = listRegisteredAgents();
  if (file.defaultAgentId && agents.some((a) => a.id === file.defaultAgentId && a.available)) {
    return file.defaultAgentId;
  }
  // Prefer first available non-mock agent
  const preferred =
    agents.find((a) => a.available && a.installKind !== "mock") ??
    agents.find((a) => a.available) ??
    agents[0];
  return preferred?.id ?? "pipper-mock";
}

/** Resolve spawn command/args for process launch. */
export function resolveAgentSpawn(agent: AcpAgentDescriptor): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const env = { ...process.env, ...agent.env } as Record<string, string>;

  if (agent.id === "pipper-mock" || agent.installKind === "mock") {
    const mockPath = join(registryDir, "mock-agent.mjs");
    const alt = join(process.cwd(), "electron/agents/mock-agent.mjs");
    const script = existsSync(mockPath) ? mockPath : alt;
    return {
      command: process.execPath.includes("Electron") ? "node" : process.execPath,
      args: [script],
      env,
    };
  }

  if (agent.id === "codex-acp") {
    const adapterPath = bundledCodexAcpPath();
    if (!adapterPath) {
      throw new Error("Pipper's bundled Codex ACP adapter is missing. Reinstall Pipper.");
    }
    return {
      // Electron runs this Node ESM entrypoint directly. The adapter brings
      // its compatible Codex CLI dependency with it.
      command: process.execPath,
      args: [adapterPath],
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  // Re-probe so spawn uses latest PATH resolution
  const probed = probeAgentAvailability(agent);
  if (!probed.available) {
    throw new Error(
      probed.statusMessage ??
        `${agent.displayName} is not installed. ${agent.installHint ?? ""}`.trim(),
    );
  }

  return {
    command: probed.resolvedCommand ?? probed.command,
    args: probed.args ?? [],
    env,
  };
}
