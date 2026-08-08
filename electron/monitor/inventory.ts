import type { MonitorProcessDescriptor } from "../../contracts/monitor.ts";
import type { AgentManager } from "../agent.ts";

export interface PtySessionLike {
  process: { pid: number };
}

export function buildMonitorInventory(input: {
  mainPid: number;
  rendererPid: number | null;
  agentManager: AgentManager | null;
  ptySessions: Map<string, PtySessionLike>;
}): MonitorProcessDescriptor[] {
  const entries: MonitorProcessDescriptor[] = [
    {
      pid: input.mainPid,
      role: "electron-main",
      label: "Main process",
    },
  ];

  if (input.rendererPid && input.rendererPid > 0) {
    entries.push({
      pid: input.rendererPid,
      role: "electron-renderer",
      label: "Renderer",
    });
  }

  if (input.agentManager) {
    entries.push(...input.agentManager.getMonitorProcessDescriptors());
  }

  for (const [sessionId, session] of input.ptySessions) {
    const pid = session.process.pid;
    if (!pid) continue;
    entries.push({
      pid,
      role: "pty",
      label: `PTY ${sessionId.slice(0, 8)}`,
      sessionId,
    });
  }

  return entries;
}
