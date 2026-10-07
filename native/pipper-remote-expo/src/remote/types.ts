// Wire shapes for the laptop's RemoteServer (electron/remote-server.ts).
// Shared with the desktop app through contracts/remote.ts; type-only, so
// Metro never bundles anything from outside this project.
import type {
  RemoteAgentModel,
  RemoteDevice,
  RemoteDiagnostics,
  RemoteLaptopIdentity,
  RemotePairResponse,
  RemotePermission,
  RemoteReport,
  RemoteRequestStatus,
  RemoteThreadModel,
  RemoteThreadSummary,
} from "../../../../contracts/remote.ts";

export type {
  RemoteAgentModel,
  RemoteDevice,
  RemoteDiagnostics,
  RemoteLaptopIdentity,
  RemotePairResponse,
  RemotePermission,
  RemoteReport,
  RemoteRequestStatus,
  RemoteThreadModel,
  RemoteThreadSummary,
};

export type RemoteMessage = RemoteReport["messages"][number];

// Same document as `SiriCatalog` in electron/siri/siri-catalog.ts (not
// imported: that module pulls in Node APIs). Served by GET /api/remote/catalog.
export interface RemoteCatalogProject {
  id: string;
  name: string;
  path: string;
}

export interface RemoteCatalogAgent {
  id: string;
  displayName: string;
  available: boolean;
}

export interface RemoteCatalog {
  version: number;
  updatedAt: string;
  defaultAgentId: string;
  projects: RemoteCatalogProject[];
  agents: RemoteCatalogAgent[];
}

/** Account that pipper.dev says owns a laptop (from its signed statement). */
export interface LaptopOwner {
  sub: string;
  email: string | null;
  name: string | null;
}

/**
 * The paired laptop: where its `/api/remote/*` lives and this phone's own
 * device token (issued by the laptop for a one-time pairing code).
 */
export interface RemoteConfig {
  /** Origin of the laptop's API, e.g. `https://lt-ab12….pipper.dev`. */
  baseURL: string;
  token: string;
  /** What the laptop calls itself (unverified). */
  laptopName: string | null;
  /** Owner verified at pairing time; null when unverified. */
  owner: LaptopOwner | null;
  /** The name this phone has in the laptop's device list. */
  deviceName: string | null;
}
