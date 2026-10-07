import type {
  LaptopOwner,
  RemoteCatalog,
  RemoteCatalogAgent,
  RemoteConfig,
  RemoteDiagnostics,
  RemoteThreadModel,
} from "./types";

export const EMPTY_CATALOG: RemoteCatalog = {
  version: 1,
  updatedAt: "",
  defaultAgentId: "",
  projects: [],
  agents: [],
};

export function availableAgents(catalog: RemoteCatalog): RemoteCatalogAgent[] {
  return catalog.agents.filter((a) => a.available);
}

/**
 * Agent for a request that named none: the laptop's default when it is
 * installed, else the first available one.
 */
export function preferredAgent(catalog: RemoteCatalog): RemoteCatalogAgent | null {
  return (
    catalog.agents.find((a) => a.id === catalog.defaultAgentId && a.available) ??
    availableAgents(catalog)[0] ??
    null
  );
}

export function projectName(catalog: RemoteCatalog, id: string): string | null {
  return catalog.projects.find((p) => p.id === id)?.name ?? null;
}

export function ownerLabel(owner: LaptopOwner): string {
  return owner.email ?? owner.name ?? "a Pipper account";
}

/** "MacBook Pro · me@example.com": verified owner when there is one. */
export function configLabel(config: RemoteConfig): string {
  const name = config.laptopName ?? "Your Mac";
  return config.owner ? `${name} · ${ownerLabel(config.owner)}` : name;
}

/** Host (and port, when given) for display. */
export function configAddress(config: RemoteConfig): string {
  return config.baseURL.replace(/^[a-z]+:\/\//i, "");
}

export function currentModelName(model: RemoteThreadModel): string | null {
  if (model.current === null) return null;
  return model.options.find((m) => m.id === model.current)?.name ?? model.current;
}

export function diagnosticsReady(d: RemoteDiagnostics): boolean {
  return d.paired && d.agentReady && d.availableAgents > 0 && d.projects > 0;
}

export function diagnosticsGuidance(d: RemoteDiagnostics): string {
  if (!d.agentReady) return "Open Pipper on your Mac and wait for startup to finish.";
  if (d.availableAgents === 0) return "Install and select a coding agent in Pipper on your Mac.";
  if (d.projects === 0) return "Add a Git project in Pipper on your Mac.";
  return "Ready. Start a sample task to check the full connection.";
}
