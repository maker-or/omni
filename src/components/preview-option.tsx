import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * A selectable card in a visual picker: a preview wrapped in the shared
 * selection chrome (blue border + check badge) with a label underneath.
 */
export function PreviewOption({
  name,
  value,
  label,
  selected,
  onSelect,
  children,
  className,
}: {
  name: string;
  value: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "group/option flex cursor-pointer flex-col items-center gap-1.5 outline-none",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          "relative block w-full rounded-[11px] border-2 p-[2px] transition-colors duration-80",
          selected
            ? "border-[#3b82f6]"
            : "border-transparent peer-focus-visible:border-[color:var(--focus-ring,#6B97FF)]",
        )}
      >
        <span className="block w-full overflow-hidden rounded-[9px] border border-black/10 dark:border-white/10">
          {children}
        </span>
        {selected && (
          <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-[#3b82f6] text-white shadow-sm">
            <Check size={12} weight="bold" />
          </span>
        )}
      </span>
      <span
        className={cn(
          "text-[12px] leading-none transition-colors duration-80",
          selected
            ? "font-medium text-foreground"
            : "text-muted-foreground group-hover/option:text-foreground",
        )}
      >
        {label}
      </span>
    </label>
  );
}
