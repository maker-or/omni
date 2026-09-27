import type { AcpAgentDescriptor } from "../../contracts/acp.ts";

/**
 * True when a descriptor is a driver's default instance (id === driver id).
 * Onboarding operates at this level: users pick providers, then add extra
 * accounts later from Settings.
 */
export function isDefaultInstance(agent: AcpAgentDescriptor): boolean {
  return (agent.driverId ?? agent.id) === agent.id;
}

/**
 * An agent (possibly a non-default account) counts as selected when either its
 * own instance id or its provider's driver id is in the selected set. This
 * keeps onboarding's provider-level selection meaningful for accounts the user
 * adds afterward.
 */
export function isInstanceSelected(
  agent: AcpAgentDescriptor,
  selectedIds: readonly string[],
): boolean {
  if (selectedIds.includes(agent.id)) return true;
  return agent.driverId != null && selectedIds.includes(agent.driverId);
}
