import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { getSelectedAgentIds } from "../db.ts";
import { getPipperLibraryPath, PIPPER_APP_GROUP_IDENTIFIER } from "../paths.ts";
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

/** Every location the Swift extension may read from (ad-hoc: ~/Library/pipper). */
export function getSiriLibraryDirs(): string[] {
  const dirs = [getPipperLibraryPath()];
  if (process.env.PIPPER_LIBRARY_PATH) return dirs;
  // Legacy Group Container fallback for users migrating from signed builds
  if (process.platform === "darwin") {
    const legacy = join(os.homedir(), "Library/Group Containers", PIPPER_APP_GROUP_IDENTIFIER);
    if (legacy !== dirs[0]) dirs.push(legacy);
    // Also probe Application Support/Pipper for future share
    const appSupport = join(os.homedir(), "Library/Application Support/Pipper");
    if (appSupport !== dirs[0]) dirs.push(appSupport);
  }
  return [...new Set(dirs)];
}
export function getSiriCatalogPath(): string {
  return join(getPipperLibraryPath(), "siri-catalog.json");
}

/** Directory where the Swift intent stages pending thread requests. */
export function getSiriRequestsDir(): string {
  return join(getPipperLibraryPath(), "siri-requests");
}

/** All request dirs the extension may stage into (dual-write targets). */
export function getSiriRequestsDirs(): string[] {
  return getSiriLibraryDirs().map((d) => join(d, "siri-requests"));
}

/** Snapshot the current projects and agents into the shared catalog shape. */
export function buildSiriCatalog(): SiriCatalog {
  const projects = listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
  }));
  const selectedAgentIds = new Set(getSelectedAgentIds());
  const selectedAgents = listRegisteredAgents().filter((a) => selectedAgentIds.has(a.id));
  const agents = selectedAgents.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    available: a.available ?? false,
  }));
  const configuredDefaultAgentId = getDefaultAgentId();
  const defaultAgentId = selectedAgents.some((a) => a.id === configuredDefaultAgentId)
    ? configuredDefaultAgentId
    : (selectedAgents[0]?.id ?? "");
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultAgentId,
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
  const payload = JSON.stringify(catalog, null, 2);
  // Dual-write so the ad-hoc-signed extension finds the catalog whether it
  // resolves the App Group container or falls back to ~/Library/pipper.
  for (const dir of getSiriLibraryDirs()) {
    try {
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, "siri-requests"), { recursive: true });
      const target = join(dir, "siri-catalog.json");
      const tmp = join(dirname(target), `.siri-catalog.${process.pid}.tmp`);
      writeFileSync(tmp, payload, "utf8");
      renameSync(tmp, target);
    } catch (err) {
      // Ad-hoc-signed builds cannot create the App Group container; the
      // legacy ~/Library/pipper location must still be updated.
      console.warn(`[Siri] Catalog write failed for ${dir}:`, err);
    }
  }
  return catalog;
}
