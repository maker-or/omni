"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Dropdown } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Elevated } from "@/lib/elevated";
import { useAnchoredPopoverPosition } from "@/lib/anchored-popover";
import type { AgentCommand } from "@/lib/agent-commands";

interface AgentSlashCommandMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  commands: AgentCommand[];
  selectedIndex: number;
  onSelect: (commandName: string) => void;
}

export function AgentSlashCommandMenu({
  anchorRef,
  commands,
  selectedIndex,
  onSelect,
}: AgentSlashCommandMenuProps) {
  const prefersReducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPopoverPosition(anchorRef, commands.length > 0, "anchor", 320);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-proximity-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!position || typeof document === "undefined") return null;

  const movement = position.placement === "top" ? 12 : -12;

  return createPortal(
    <AnimatePresence initial={false}>
      {commands.length > 0 && (
        <motion.div
          key="slash-commands"
          initial={{
            opacity: 0,
            y: prefersReducedMotion ? 0 : movement,
            scale: prefersReducedMotion ? 1 : 0.98,
          }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            prefersReducedMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  y: movement,
                  scale: 0.99,
                  transition: { duration: 0.15, ease: "easeIn" },
                }
          }
          transition={
            prefersReducedMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }
          }
          style={{
            left: position.left,
            width: position.width,
            top: position.top,
            bottom: position.bottom,
            transformOrigin: `${position.placement} center`,
          }}
          className="fixed z-[250]"
        >
          <Elevated
            offset={2}
            shadowLevel={4}
            className="overflow-hidden rounded-2xl border border-border/80"
            style={{ maxHeight: position.maxHeight }}
            data-pipper-id="slash-commands"
            data-placement={position.placement}
          >
            <div className="h-2" aria-hidden="true" />
            <div ref={listRef}>
              <Dropdown
                checkedIndex={selectedIndex}
                className="w-full max-h-64 overflow-y-auto rounded-none bg-transparent shadow-none"
                style={{ maxHeight: Math.max(0, Math.min(256, position.maxHeight - 8)) }}
                role="listbox"
                aria-label="Slash commands"
              >
                {commands.map((command, index) => (
                  <MenuItem
                    key={command.name}
                    label={`/${command.name}`}
                    description={command.description || undefined}
                    index={index}
                    className="w-full px-3 py-2.5"
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onSelect={() => onSelect(command.name)}
                  />
                ))}
              </Dropdown>
            </div>
          </Elevated>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
