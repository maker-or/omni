import { Button } from "@/components/ui/button";
import { useUpdateStore } from "@/store/update-store";

export function UpdateBanner() {
  const { state, dismiss, scheduleForQuit } = useUpdateStore();
  if (
    !state?.manifest ||
    state.dismissed_for_session ||
    !["available", "scheduled"].includes(state.phase)
  )
    return null;
  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-medium">Pipper {state.manifest.version} is available.</span>{" "}
        <span className="text-muted-foreground">{state.manifest.description}</span>
      </div>
      <Button variant="tertiary" size="sm" onClick={() => void dismiss()}>
        Later
      </Button>
      <Button variant="tertiary" size="sm" onClick={() => void scheduleForQuit()}>
        {state.scheduled_for_quit ? "Scheduled" : "Update when I quit"}
      </Button>
    </div>
  );
}
