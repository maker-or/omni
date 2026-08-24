"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Dropdown } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import type { AgentCommand } from "@/lib/agent-commands";

interface AgentSlashCommandMenuProps {
  commands: AgentCommand[];
  selectedIndex: number;
  onSelect: (commandName: string) => void;
}

export function AgentSlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
}: AgentSlashCommandMenuProps) {
  const prefersReducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-proximity-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <AnimatePresence initial={false}>
      {commands.length > 0 && (
        <motion.div
          key="slash-commands"
          data-pipper-id="slash-commands"
          initial={{
            opacity: 0,
            y: prefersReducedMotion ? 0 : 24,
            scale: prefersReducedMotion ? 1 : 0.98,
          }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            prefersReducedMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  y: 12,
                  scale: 0.99,
                  transition: { duration: 0.15, ease: "easeIn" },
                }
          }
          transition={
            prefersReducedMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }
          }
          style={{ transformOrigin: "bottom center" }}
          className="absolute inset-x-5 bottom-[calc(100%-12px)] z-0 overflow-hidden rounded-2xl border border-border/80 bg-surface-3 shadow-surface-4"
        >
          <div className="h-2" aria-hidden="true" />
          <div ref={listRef}>
            <Dropdown
              checkedIndex={selectedIndex}
              className="w-full max-h-64 overflow-y-auto rounded-none bg-transparent shadow-none"
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
