"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
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
          className="absolute inset-x-5 bottom-[calc(100%-12px)] z-0 overflow-hidden rounded-t-xl border border-border bg-surface-2 px-2 pb-5 pt-2 shadow-lg"
        >
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {commands.slice(0, 8).map((command, index) => (
              <Button
                key={command.name}
                variant="ghost"
                size="sm"
                active={selectedIndex === index}
                className="w-full justify-start"
                onClick={() => onSelect(command.name)}
              >
                {command.name}
              </Button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
