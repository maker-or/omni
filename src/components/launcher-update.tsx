import React from "react";
import { Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLauncherUpdateStore } from "@/store/launcher-update-store";

function bytes(value: number): string {
  return value < 1024 ** 2
    ? `${(value / 1024).toFixed(0)} KB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function launcherInstallInstructions(platform: "darwin" | "win32" | "linux" | undefined): string {
  if (platform === "win32") {
    return "The installer will open and Pipper will quit. Complete the setup wizard, then reopen Pipper. Your projects and customizations are stored separately and will remain unchanged.";
  }
  return "The installer will open and Pipper will quit. Drag Pipper Code (Alpha) into Applications and choose Replace. Then reopen Pipper. Your projects and customizations are stored separately and will remain unchanged.";
}

function UpdateContent() {
  const store = useLauncherUpdateStore();
  const { state, progress } = store;
  if (!state?.manifest) return null;
  const version = state.manifest.version;
  const icon =
    state.phase === "failed" ? (
      <TriangleAlert className="size-4 text-destructive" />
    ) : (
      <Download className="size-4 text-primary" />
    );
  let title = `Pipper application update ${version} is available.`;
  let detail = "Your projects and customizations stay unchanged.";
  if (state.phase === "downloading") {
    title = `Downloading Pipper ${version}${progress?.percent != null ? `… ${Math.round(progress.percent)}%` : "…"}`;
    detail = progress
      ? `${bytes(progress.received_bytes)}${progress.total_bytes ? ` of ${bytes(progress.total_bytes)}` : ""}`
      : "Starting download…";
  } else if (state.phase === "downloaded") {
    title = `Pipper ${version} is ready to install.`;
    detail = "The installer will open and Pipper will quit.";
  } else if (state.phase === "failed") {
    title = "Application update failed.";
    detail = state.error ?? "Try the download again.";
  }
  return (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground truncate">{detail}</div>
        {state.phase === "downloading" && progress?.percent != null && (
          <div className="mt-1 h-1 rounded bg-border">
            <div className="h-full rounded bg-primary" style={{ width: `${progress.percent}%` }} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="tertiary" size="sm" onClick={() => store.setDiagnosticsOpen(true)}>
          Details
        </Button>
        {state.phase === "downloading" ? (
          <Button size="sm" onClick={() => void store.cancelDownload()}>
            Cancel
          </Button>
        ) : (
          <Button variant="tertiary" size="sm" onClick={() => void store.dismissForSession()}>
            Later
          </Button>
        )}
        {state.phase === "available" && (
          <Button size="sm" onClick={() => void store.download()}>
            Download update
          </Button>
        )}
        {state.phase === "failed" && state.downloaded_sha256 ? (
          <Button size="sm" onClick={() => void window.omni.launcherUpdate.openDownloadFolder()}>
            Open download folder
          </Button>
        ) : state.phase === "failed" ? (
          <Button size="sm" onClick={() => void store.retryDownload()}>
            Retry download
          </Button>
        ) : null}
        {state.phase === "downloaded" && (
          <Button size="sm" onClick={() => void store.installAndQuit()}>
            Install and quit
          </Button>
        )}
      </div>
    </>
  );
}

export function LauncherUpdateBanner() {
  const { state, dismissed } = useLauncherUpdateStore();
  if (
    !state?.manifest ||
    dismissed ||
    !["available", "downloading", "downloaded", "failed"].includes(state.phase)
  )
    return null;
  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm">
      <UpdateContent />
    </div>
  );
}

export function LauncherUpdateNotice() {
  const { state, dismissed } = useLauncherUpdateStore();
  if (
    !state?.manifest ||
    dismissed ||
    !["available", "downloading", "downloaded", "failed"].includes(state.phase)
  )
    return null;
  return (
    <div className="fixed left-4 right-4 bottom-4 z-[350] flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 p-3 shadow-xl text-sm">
      <UpdateContent />
    </div>
  );
}

export function LauncherUpdateDialog() {
  const store = useLauncherUpdateStore();
  const [confirm, setConfirm] = React.useState(false);
  if (!store.diagnosticsOpen) return null;
  const d = store.diagnostics;
  const entries = d
    ? [
        ["Current version", d.current_version],
        ["Available version", d.pending_version],
        ["Status", d.phase],
        ["Last checked", d.last_checked_at],
        ["Manifest URL", d.manifest_url],
        ["Download location", d.download_path],
        ["Expected SHA-256", d.expected_sha256],
        ["Downloaded SHA-256", d.actual_sha256],
        ["Last error", d.last_error],
      ]
    : [];
  return (
    <div className="fixed inset-0 z-[450] grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-[min(620px,calc(100vw-32px))] max-h-[90vh] overflow-auto rounded-xl border border-border bg-surface-1 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold">Application update details</h2>
        {(store.state?.phase === "downloaded" || store.state?.downloaded_sha256) && (
          <p className="mt-2 text-sm text-muted-foreground">
            {launcherInstallInstructions(d?.platform)}
          </p>
        )}
        <dl className="mt-4 grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
          {entries.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono break-all">{value ?? "—"}</dd>
            </React.Fragment>
          ))}
        </dl>
        {confirm && (
          <p className="mt-4 text-sm text-destructive">
            Delete the local installer? This cannot be undone.
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {d?.artifact_url && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => void window.omni.launcherUpdate.downloadInBrowser()}
            >
              Download in browser
            </Button>
          )}
          {d?.download_path && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => void window.omni.launcherUpdate.openDownloadFolder()}
            >
              Open download folder
            </Button>
          )}
          {d?.download_path && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() =>
                confirm
                  ? void store.clearDownloadedUpdate().then(() => setConfirm(false))
                  : setConfirm(true)
              }
            >
              {confirm ? "Confirm clear" : "Clear downloaded update"}
            </Button>
          )}
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => void window.omni.launcherUpdate.copyDiagnostics()}
          >
            Copy diagnostics
          </Button>
          <Button size="sm" onClick={() => store.setDiagnosticsOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
