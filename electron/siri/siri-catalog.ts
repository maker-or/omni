import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** Absolute path of the shared catalog both Electron and Siri read. */
export function getSiriCatalogPath(): string {
  return join(getPipperLibraryPath(), "siri-catalog.json");
}

/** Directory where the Swift intent stages pending thread requests. */
export function getSiriRequestsDir(): string {
  return join(getPipperLibraryPath(), "siri-requests");
}

/** Snapshot the current projects and agents into the shared catalog shape. */
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

/**
 * Write the shared catalog atomically (temp file + rename) so Siri never
 * observes truncated JSON mid-refresh.
 */
export function refreshSiriCatalog(): SiriCatalog {
  const catalog = buildSiriCatalog();
  const dir = getPipperLibraryPath();
  mkdirSync(dir, { recursive: true });
  mkdirSync(getSiriRequestsDir(), { recursive: true });
  const target = getSiriCatalogPath();
  const tmp = join(dirname(target), `.siri-catalog.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(catalog, null, 2), "utf8");
  renameSync(tmp, target);
  return catalog;
}
