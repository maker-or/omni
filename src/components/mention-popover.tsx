"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { createProviderLogoIcon } from "@/components/provider-logos";
import type { ComposerMentionKind } from "../../contracts/composer.ts";

export type MentionItem = {
  id: string;
  label: string;
  description?: string;
  /** Extra payload for model items (owning agent). */
  agentId?: string;
  /** Provider identity used by the model picker filter. */
  providerId?: string;
  /** Human-readable provider name shown in the model picker. */
  providerLabel?: string;
};

export type MentionProvider = {
  id: string;
  label: string;
};

export type MentionPopoverProps = {
  anchorRect: DOMRect | null;
  kind: ComposerMentionKind;
  items: MentionItem[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPick: (item: MentionItem) => void;
  onClose: () => void;
  /** Provider tabs shown above the model list. */
  providers?: MentionProvider[];
  selectedProviderId?: string | null;
  onProviderChange?: (providerId: string | null) => void;
};

const KIND_LABEL: Record<ComposerMentionKind, string> = {
  project: "Projects",
  agent: "Agents",
  model: "Models",
  file: "Files",
};

const KIND_CHIP: Record<ComposerMentionKind, string> = {
  project: "bg-teal-500/15 text-teal-800 dark:text-teal-200 ring-1 ring-inset ring-teal-500/25",
  agent:
    "bg-violet-500/15 text-violet-800 dark:text-violet-200 ring-1 ring-inset ring-violet-500/25",
  model:
    "bg-violet-500/15 text-violet-800 dark:text-violet-200 ring-1 ring-inset ring-violet-500/25",
  file: "bg-sky-500/15 text-sky-800 dark:text-sky-200 ring-1 ring-inset ring-sky-500/25",
};

export function mentionChipClass(kind: ComposerMentionKind): string {
  return KIND_CHIP[kind];
}

export function MentionPopover({
  anchorRect,
  kind,
  items,
  selectedIndex,
  onSelectedIndexChange,
  onPick,
  onClose,
  providers = [],
  selectedProviderId = null,
  onProviderChange,
}: MentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-proximity-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!anchorRect || typeof document === "undefined") return null;

  // Open above the composer so the list never covers the input while typing.
  const gap = 6;
  const width = 360;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8));
  const bottom = Math.max(gap, window.innerHeight - anchorRect.top + gap);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);

  return createPortal(
    <div
      className="fixed z-[250] w-[min(22.5rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-border/80 bg-surface-3 shadow-surface-4"
      style={{ bottom, left }}
      data-pipper-id="mention-popover"
      role="listbox"
      aria-label={`${KIND_LABEL[kind]} mentions`}
    >
      <div ref={listRef}>
        {kind === "model" && providers.length > 0 && onProviderChange ? (
          <div className="px-3 pb-2.5 pt-3" aria-label="Model providers">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                Provider
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {selectedProvider?.label ?? "All providers"}
              </span>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              {providers.map((provider) => {
                const ProviderIcon = createProviderLogoIcon(provider.id, provider.label);
                const isSelected = selectedProviderId === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    title={isSelected ? "Show all models" : `Filter models by ${provider.label}`}
                    aria-label={
                      isSelected ? "Show all models" : `Filter models by ${provider.label}`
                    }
                    aria-pressed={isSelected}
                    className={cn(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150",
                      isSelected
                        ? "bg-accent text-foreground shadow-sm"
                        : "hover:bg-hover hover:text-foreground",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onProviderChange(isSelected ? null : provider.id)}
                  >
                    <ProviderIcon size={16} />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="h-2" aria-hidden="true" />
        <Dropdown
          checkedIndex={selectedIndex}
          className="w-full max-h-64 overflow-y-auto rounded-none bg-transparent shadow-none"
          role="listbox"
          aria-label={`${KIND_LABEL[kind]} mentions`}
        >
          {items.length === 0 ? (
            <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">
              No {KIND_LABEL[kind].toLowerCase()} found
            </div>
          ) : (
            items.map((item, index) => {
              return (
                <MenuItem
                  key={item.agentId ? `${item.agentId}:${item.id}` : item.id}
                  label={item.label}
                  description={item.description}
                  index={index}
                  className="w-full px-3 py-2.5"
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onMouseEnter={() => onSelectedIndexChange(index)}
                  onSelect={() => onPick(item)}
                />
              );
            })
          )}
        </Dropdown>
      </div>
    </div>,
    document.body,
  );
}
