import type { AcpToolCallState } from "../../contracts/acp.ts";
import {
  hydrateStoredToolCalls,
  rememberHydratedToolCalls,
  toolCallsNeedHydration,
} from "../store/tool-payload-store";

export async function resolveToolCalls(
  threadId: string | null,
  toolCalls: Record<string, AcpToolCallState>,
  requestedIds: readonly string[] = Object.keys(toolCalls),
): Promise<Record<string, AcpToolCallState>> {
  if (!threadId) return toolCalls;
  const local = hydrateStoredToolCalls(threadId, toolCalls);
  const unresolvedIds = requestedIds.filter((id) => {
    const toolCall = local[id];
    return Boolean(
      toolCall &&
      (toolCall.hasPayload || toolCall.hasDiff) &&
      toolCall.content === undefined &&
      toolCall.rawOutput === undefined,
    );
  });
  if (unresolvedIds.length === 0 || !toolCallsNeedHydration(local)) return local;
  const fetchToolCalls = window.omni?.agent?.getToolCalls;
  if (!fetchToolCalls) return local;
  try {
    const remote = await fetchToolCalls(threadId, unresolvedIds);
    rememberHydratedToolCalls(threadId, remote);
    return hydrateStoredToolCalls(threadId, toolCalls);
  } catch {
    return local;
  }
}
