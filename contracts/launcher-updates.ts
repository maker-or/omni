export const LAUNCHER_UPDATE_PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "failed",
] as const;

export type LauncherUpdatePhase = (typeof LAUNCHER_UPDATE_PHASES)[number];

export interface LauncherUpdateManifest {
  schema_version: 1;
  version: string;
  url: string;
  sha256: string;
}

export interface LauncherUpdateState {
  phase: LauncherUpdatePhase;
  current_version: string;
  manifest: LauncherUpdateManifest | null;
  downloaded_path: string | null;
  downloaded_sha256: string | null;
  error: string | null;
  updated_at: string;
  last_checked_at: string | null;
}

export interface LauncherDownloadProgress {
  received_bytes: number;
  total_bytes: number | null;
  percent: number | null;
}

export interface LauncherUpdateDiagnostics {
  current_version: string;
  pending_version: string | null;
  phase: LauncherUpdatePhase;
  platform: "darwin" | "win32" | "linux";
  manifest_url: string | null;
  artifact_url: string | null;
  download_path: string | null;
  expected_sha256: string | null;
  actual_sha256: string | null;
  last_checked_at: string | null;
  updated_at: string;
  last_error: string | null;
}
