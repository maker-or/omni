import { useEffect, useRef, useState } from "react";
import { MoonStars, WarningCircle } from "@phosphor-icons/react";
import type { SleeplessStatus } from "../../contracts/sleepless.ts";
import { cn } from "@/lib/utils";

function statusLabel(status: SleeplessStatus): string {
  if (status.error && status.phase === "error") return "Setup needs attention";
  if (!status.preferences.enabled) return "Off";
  if (status.serviceStatus === "requires-approval") return "Permission required";
  if (status.serviceStatus === "not-registered") return "Setup required";
  if (status.serviceStatus === "not-found") return "Unavailable in this build";
  if (status.phase === "armed") {
    return status.runningTaskCount === 1
      ? "Keeping Mac awake for 1 agent"
      : `Keeping Mac awake for ${status.runningTaskCount} agents`;
  }
  if (status.phase === "connecting") return "Connecting to sleep helper…";
  if (status.phase === "error") return "Needs attention";
  return "Ready for the next agent run";
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-[#6B97FF]" : "bg-accent",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function SleeplessControl() {
  const [status, setStatus] = useState<SleeplessStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    void window.omni.sleepless.getStatus().then((value) => {
      if (mounted && value) setStatus(value);
    });
    const off = window.omni.sleepless.onStatusChanged((value) => {
      if (mounted) setStatus(value);
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (!status?.supported) return null;

  const update = async (action: () => Promise<SleeplessStatus | null>) => {
    setBusy(true);
    try {
      const next = await action();
      if (next) setStatus(next);
    } finally {
      setBusy(false);
    }
  };
  const armed = status.phase === "armed";
  const needsApproval = status.serviceStatus === "requires-approval";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Lid-closed agent execution"
        title={statusLabel(status)}
        className={cn(
          "relative inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open || armed
            ? "bg-accent text-foreground"
            : status.phase === "error" || needsApproval
              ? "text-amber-500 hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <MoonStars weight={armed ? "fill" : "duotone"} className="size-4" />
        {armed && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[300] mt-2 w-80 rounded-xl border border-border bg-surface-1 p-3 shadow-surface-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Lid-closed execution</div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                Agents keep running after you close the lid. Normal sleep is restored when they
                finish.
              </div>
            </div>
            <Toggle
              label="Enable lid-closed execution"
              checked={status.preferences.enabled}
              disabled={busy}
              onChange={() =>
                void update(() => window.omni.sleepless.setEnabled(!status.preferences.enabled))
              }
            />
          </div>

          <div
            className={cn(
              "mt-3 rounded-lg border px-3 py-2 text-[11px]",
              armed
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : status.phase === "error" || needsApproval
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                  : "border-border bg-surface-2 text-muted-foreground",
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              {(status.phase === "error" || needsApproval) && (
                <WarningCircle weight="fill" className="size-3.5" />
              )}
              {statusLabel(status)}
            </div>
            {status.error && <div className="mt-1 leading-4 opacity-90">{status.error}</div>}
            {status.batteryPercent != null && (
              <div className="mt-1 opacity-80">
                Battery {Math.round(status.batteryPercent)}% ·{" "}
                {status.lidClosed ? "lid closed" : "lid open"}
              </div>
            )}
          </div>

          {status.preferences.enabled && (
            <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium">Power adapter only</div>
                  <div className="text-[10px] text-muted-foreground">
                    Safer default for bags and travel
                  </div>
                </div>
                <Toggle
                  label="Require power adapter"
                  checked={status.preferences.acOnly}
                  disabled={busy}
                  onChange={() =>
                    void update(() =>
                      window.omni.sleepless.setPreferences({
                        acOnly: !status.preferences.acOnly,
                      }),
                    )
                  }
                />
              </div>

              <label className="flex items-center justify-between gap-3 text-[12px]">
                <span>
                  Battery floor
                  <span className="ml-1 text-[10px] text-muted-foreground">sleep below</span>
                </span>
                <select
                  value={status.preferences.batteryFloor}
                  disabled={busy || status.preferences.acOnly}
                  onChange={(event) =>
                    void update(() =>
                      window.omni.sleepless.setPreferences({
                        batteryFloor: Number(event.target.value),
                      }),
                    )
                  }
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] outline-none disabled:opacity-50"
                >
                  {[15, 20, 25, 30].map((value) => (
                    <option key={value} value={value}>
                      {value}%
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center justify-between gap-3 text-[12px]">
                <span>Maximum run</span>
                <select
                  value={status.preferences.maxDurationMinutes}
                  disabled={busy}
                  onChange={(event) =>
                    void update(() =>
                      window.omni.sleepless.setPreferences({
                        maxDurationMinutes: Number(event.target.value),
                      }),
                    )
                  }
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] outline-none disabled:opacity-50"
                >
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={240}>4 hours</option>
                  <option value={480}>8 hours</option>
                </select>
              </label>
            </div>
          )}

          {needsApproval && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void window.omni.sleepless.openSystemSettings()}
                className="flex-1 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background"
              >
                Open Login Items
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void update(() => window.omni.sleepless.refresh())}
                className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
