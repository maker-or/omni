import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { HeaderTone } from "@/components/workspace-control-panel";

export interface SplitMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
}

/**
 * Primary action + caret menu, the one control shape shared by every git
 * state that needs an action (the ready-to-merge state uses a plain button).
 */
export function SplitButton({
  label,
  title,
  disabled,
  onPrimary,
  items,
  menuDisabled,
  tone,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  onPrimary: () => void;
  items: SplitMenuItem[];
  menuDisabled?: boolean;
  tone: HeaderTone;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <div className="flex overflow-hidden rounded-full">
        <button
          type="button"
          disabled={disabled}
          title={title}
          onClick={() => {
            setOpen(false);
            onPrimary();
          }}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
            tone === "action"
              ? "bg-black/40 text-amber-100 hover:bg-black/60"
              : "bg-neutral-900 text-white hover:bg-neutral-700",
          )}
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="More options"
          aria-expanded={open}
          disabled={menuDisabled}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "px-2 py-1.5 transition-colors disabled:opacity-50",
            tone === "action"
              ? "bg-black/25 text-amber-100 hover:bg-black/45"
              : "bg-white text-neutral-900 hover:bg-zinc-200",
          )}
        >
          <CaretDown size={13} />
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-surface-1 p-1 shadow-surface-5">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              title={item.title}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-50"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
