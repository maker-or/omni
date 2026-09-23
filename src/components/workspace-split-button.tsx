import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { type HeaderTone, HEADER_TONE_FILL } from "@/lib/workspace-tone";

export interface SplitMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
}

/**
 * Label ink per state. The flat fill comes from `HEADER_TONE_FILL` (applied
 * inline); only the text colour is class-driven. Hover brightens the fill
 * rather than swapping a colour.
 */
const TONE_TEXT: Record<HeaderTone, string> = {
  neutral: "text-zinc-900",
  action: "text-[#4a2c05]",
  ready: "text-emerald-950",
  merged: "text-violet-950",
  stale: "text-[#08243f]",
};

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
      {/* Fill + depth live on the wrapper so the inset shadow casts from the
          pill's outer edges only — applying it per segment drew a dark seam
          where the two segments meet. Segments stay transparent on top. */}
      <div
        className="flex h-7 overflow-hidden rounded-full transition-[filter] hover:brightness-105"
        style={{ backgroundColor: HEADER_TONE_FILL[tone] }}
      >
        <button
          type="button"
          disabled={disabled}
          title={title}
          onClick={() => {
            setOpen(false);
            onPrimary();
          }}
          className={cn("pl-3 pr-1 text-[12px] font-semibold disabled:opacity-50", TONE_TEXT[tone])}
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="More options"
          aria-expanded={open}
          disabled={menuDisabled}
          onClick={() => setOpen((value) => !value)}
          className={cn("flex items-center pl-1 pr-2 disabled:opacity-50", TONE_TEXT[tone])}
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
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-50"
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
