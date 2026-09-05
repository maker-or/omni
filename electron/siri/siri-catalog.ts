import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPipperLibraryPath } from "../paths.ts";
import { listProjects } from "../projects.ts";
import { listRegisteredAgents, getDefaultAgentId } from "../agents/registry.ts";

export interface SiriCatalogProject {
  id: string;
  name: string;
  path: string;
}

export interface SiriCatalogAgent {
  id: string;
  displayName: string;
  available: boolean;
}

export interface SiriCatalog {
  version: 1;
  updatedAt: string;
  defaultAgentId: string;
  projects: SiriCatalogProject[];
  agents: SiriCatalogAgent[];
}

export function getSiriCatalogPath(): string {
  return join(getPipperLibraryPath(), "siri-catalog.json");
}

export function getSiriRequestsDir(): string {
  return join(getPipperLibraryPath(), "siri-requests");
}

export function buildSiriCatalog(): SiriCatalog {
  const projects = listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
  }));
  const agents = listRegisteredAgents().map((a) => ({
    id: a.id,
    displayName: a.displayName,
    available: a.available ?? false,
  }));
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultAgentId: getDefaultAgentId(),
    projects,
    agents,
  };
}

/** Write the shared catalog both Electron and the Swift intents read. */
export function refreshSiriCatalog(): SiriCatalog {
  const catalog = buildSiriCatalog();
  const dir = getPipperLibraryPath();
  mkdirSync(dir, { recursive: true });
  mkdirSync(getSiriRequestsDir(), { recursive: true });
  writeFileSync(getSiriCatalogPath(), JSON.stringify(catalog, null, 2), "utf8");
  return catalog;
}
