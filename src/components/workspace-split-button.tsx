import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Elevated } from "@/lib/elevated";
import { WorkspaceStateAction, WorkspaceStateActionGroup } from "@/components/workspace-state";
import { type HeaderTone } from "@/lib/workspace-tone";

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
      {/* Fill + depth live on the wrapper so the inset shadow casts from the
          pill's outer edges only — applying it per segment drew a dark seam
          where the two segments meet. Segments stay transparent on top. */}
      <WorkspaceStateActionGroup tone={tone}>
        <WorkspaceStateAction
          tone={tone}
          appearance="segment"
          disabled={disabled}
          title={title}
          onClick={() => {
            setOpen(false);
            onPrimary();
          }}
          className="pl-3 pr-1 text-[12px] font-semibold disabled:opacity-50"
        >
          {label}
        </WorkspaceStateAction>
        <WorkspaceStateAction
          tone={tone}
          appearance="segment"
          aria-label="More options"
          aria-expanded={open}
          disabled={menuDisabled}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center pl-1 pr-2 disabled:opacity-50"
        >
          <CaretDown size={13} style={{ color: "var(--workspace-state-caret)" }} />
        </WorkspaceStateAction>
      </WorkspaceStateActionGroup>
      {open && (
        <Elevated
          offset={2}
          className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border p-1"
        >
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
        </Elevated>
      )}
    </div>
  );
}
