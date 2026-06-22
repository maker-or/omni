import { Button } from "@/components/ui/button";
import { useUpdateStore } from "@/store/update-store";
import { UpdateProgressView } from "./update-progress";

export function UpdateDialog() {
  const { state, detailsOpen, setDetailsOpen, cancel } = useUpdateStore();
  if (!state || !detailsOpen) return null;
  const scheduledQuitStarting =
    state.phase === "scheduled" &&
    state.scheduled_for_quit &&
    state.progress_message === "Scheduled update will begin when Pipper quits.";
  const updateRunning = [
    "preparing",
    "fetching-upstream",
    "agent-running",
    "installing-dependencies",
    "validating",
    "ready-to-promote",
    "promoting",
    "awaiting-health-check",
    "rolling-back",
  ].includes(state.phase);
  const running = scheduledQuitStarting || updateRunning;
  return (
    <div
      className="fixed inset-0 z-[400] grid place-items-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[min(520px,calc(100vw-32px))] rounded-2xl border border-border bg-surface-2 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">
          {(scheduledQuitStarting || updateRunning) && state.scheduled_for_quit
            ? "Your personalized update is starting"
            : state.phase === "failed"
              ? "Update could not be completed"
              : state.phase === "completed"
                ? "Pipper is up to date"
                : "Preparing your personalized update…"}
        </h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          {(scheduledQuitStarting || updateRunning) && state.scheduled_for_quit
            ? "Please leave Pipper open and do not close your laptop. Pipper will quit automatically after the update finishes."
            : (state.error ?? state.progress_message ?? state.manifest?.description)}
        </p>
        {updateRunning && state.scheduled_for_quit && state.progress_message && (
          <p className="-mt-3 mb-5 text-xs text-muted-foreground">{state.progress_message}</p>
        )}
        {updateRunning && <UpdateProgressView phase={state.phase} />}
        {state.validation_results.length > 0 && (
          <details className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/20 p-3 text-xs">
            <summary className="cursor-pointer">Show details</summary>
            <pre className="mt-2 whitespace-pre-wrap">
              {state.validation_results
                .map(
                  (result) => `${result.success ? "✓" : "✗"} ${result.command}\n${result.output}`,
                )
                .join("\n\n")}
            </pre>
          </details>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {updateRunning && state.scheduled_for_quit && (
            <Button
              variant="tertiary"
              onClick={() => void window.omni.update.quitWithoutUpdating()}
            >
              Quit without updating
            </Button>
          )}
          {scheduledQuitStarting ? null : running ? (
            <Button variant="tertiary" onClick={() => void cancel()}>
              Cancel update and keep current version
            </Button>
          ) : (
            <Button onClick={() => setDetailsOpen(false)}>Close</Button>
          )}
        </div>
      </div>
    </div>
  );
}
