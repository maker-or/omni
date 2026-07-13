/**
 * Confirms an ACP agent actually works, rather than just trusting that a
 * binary was found on PATH: spawns it, performs a real `initialize`
 * handshake, classifies the result, then tears the process down.
 *
 * `probeAgentAvailability` (registry.ts) only proves a command *exists* — it
 * can still be the wrong binary (see the cursor-acp PATH collision fix) or
 * one that never responds. This is the signal onboarding and the agent panel
 * use to decide whether an agent needs an install/auth step before use.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AcpAgentDescriptor, AgentProbeResult } from "../../contracts/acp.ts";
import { getAgentDescriptor, resolveAgentSpawn } from "./registry.ts";

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

export interface ProbeOptions {
  timeoutMs?: number;
}

/** Spawns `descriptor`, runs a real ACP `initialize`, and always kills the process afterward. */
export async function probeAgentHandshake(
  descriptor: AcpAgentDescriptor,
  options: ProbeOptions = {},
): Promise<AgentProbeResult> {
  if (descriptor.available === false) {
    return {
      agentId: descriptor.id,
      status: "needs-install",
      message:
        descriptor.installHint ?? `Install ${descriptor.displayName} and ensure it is on PATH.`,
    };
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    const { command, args, env } = resolveAgentSpawn(descriptor);
    child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    }) as ChildProcessWithoutNullStreams;
  } catch (err) {
    return {
      agentId: descriptor.id,
      status: "needs-install",
      message: err instanceof Error ? err.message : `Unable to launch ${descriptor.displayName}.`,
    };
  }

  let stderrText = "";
  child.stderr.on("data", (buf: Buffer) => {
    stderrText += buf.toString("utf8");
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);
    const connection = acp.client({ name: "pipper" }).connect(stream);

    const exitedEarly = new Promise<never>((_, reject) => {
      child.once("error", (err) => reject(err));
      child.once("exit", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              stderrText.trim() ||
                `${descriptor.displayName} exited (code ${code}) before responding.`,
            ),
          );
        }
      });
    });

    const timedOut = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("__pipper_probe_timeout__"));
      }, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    });

    await Promise.race([
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "pipper", title: "Pipper", version: "0.0.20" },
      }),
      exitedEarly,
      timedOut,
    ]);

    // `authMethods` advertises the authentication flows an agent supports; it
    // does not indicate whether the user is currently signed in. A successful
    // initialize response therefore proves the agent is ready for onboarding.
    return { agentId: descriptor.id, status: "ready" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "__pipper_probe_timeout__") {
      return {
        agentId: descriptor.id,
        status: "error",
        message: `${descriptor.displayName} did not respond in time. It may be misconfigured.`,
      };
    }
    return { agentId: descriptor.id, status: "error", message };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!child.killed) child.kill();
  }
}

/** Looks up `agentId` in the registry, then probes it. */
export async function probeAgentById(
  agentId: string,
  options: ProbeOptions = {},
): Promise<AgentProbeResult> {
  const descriptor = getAgentDescriptor(agentId);
  if (!descriptor) {
    return { agentId, status: "error", message: "Unknown agent." };
  }
  return probeAgentHandshake(descriptor, options);
}
