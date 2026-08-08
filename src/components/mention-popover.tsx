"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Elevated } from "@/lib/elevated";
import { cn } from "@/lib/utils";
import type { ComposerMentionKind } from "../../contracts/composer.ts";

export type MentionItem = {
  id: string;
  label: string;
  description?: string;
  /** Extra payload for model items (owning agent). */
  agentId?: string;
};

export type MentionPopoverProps = {
  anchorRect: DOMRect | null;
  kind: ComposerMentionKind;
  query: string;
  items: MentionItem[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPick: (item: MentionItem) => void;
  onClose: () => void;
  /** Optional kind switcher for draft (project | agent). */
  kinds?: ComposerMentionKind[];
  onKindChange?: (kind: ComposerMentionKind) => void;
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
  query,
  items,
  selectedIndex,
  onSelectedIndexChange,
  onPick,
  onClose,
  kinds,
  onKindChange,
}: MentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-mention-index="${selectedIndex}"]`,
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
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 320));
  const bottom = Math.max(gap, window.innerHeight - anchorRect.top + gap);

  return createPortal(
    <div
      className="fixed z-[250]"
      style={{ bottom, left }}
      data-pipper-id="mention-popover"
      role="listbox"
      aria-label={`${KIND_LABEL[kind]} mentions`}
    >
      <Elevated
        offset={2}
        className="w-72 max-h-64 overflow-hidden rounded-xl border border-border"
      >
        {kinds && kinds.length > 1 && onKindChange ? (
          <div className="flex gap-1 border-b border-border/60 p-1.5">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                  k === kind
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onKindChange(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        ) : (
          <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {KIND_LABEL[kind]}
            {query ? ` · ${query}` : ""}
          </div>
        )}
        <div ref={listRef} className="max-h-52 overflow-y-auto p-1">
          {items.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-muted-foreground">No matches</div>
          ) : (
            items.map((item, index) => {
              const active = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-mention-index={index}
                  className={cn(
                    "flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-accent text-foreground" : "text-foreground hover:bg-hover",
                  )}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before pick.
                    e.preventDefault();
                  }}
                  onMouseEnter={() => onSelectedIndexChange(index)}
                  onClick={() => onPick(item)}
                >
                  <span className="truncate text-[13px] font-medium">{item.label}</span>
                  {item.description ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </Elevated>
    </div>,
    document.body,
  );
}
