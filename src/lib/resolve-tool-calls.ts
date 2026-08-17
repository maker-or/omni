import type { AcpToolCallState } from "../../contracts/acp.ts";
import {
  hydrateStoredToolCalls,
  rememberHydratedToolCalls,
  toolCallsNeedHydration,
} from "../store/tool-payload-store";

export async function resolveToolCalls(
  threadId: string | null,
  toolCalls: Record<string, AcpToolCallState>,
): Promise<Record<string, AcpToolCallState>> {
  if (!threadId) return toolCalls;
  const local = hydrateStoredToolCalls(threadId, toolCalls);
  if (!toolCallsNeedHydration(local)) return local;
  const fetchToolCalls = window.omni?.agent?.getToolCalls;
  if (!fetchToolCalls) return local;
  try {
    const remote = await fetchToolCalls(threadId);
    rememberHydratedToolCalls(threadId, remote);
    return hydrateStoredToolCalls(threadId, toolCalls);
  } catch {
    return local;
  }
}
