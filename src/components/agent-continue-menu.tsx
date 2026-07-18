"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Elevated } from "@/lib/elevated";
import type { AcpAgentDescriptor } from "../../contracts/acp.ts";

interface AgentContinueMenuProps {
  agents: AcpAgentDescriptor[];
  selectedIndex: number;
  onSelect: (agentId: string) => void;
}

/**
 * Agent picker shown when the user runs `/continue` — mirrors the slash-command
 * menu so switching agents to fork a conversation feels like the same surface.
 */
export function AgentContinueMenu({ agents, selectedIndex, onSelect }: AgentContinueMenuProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {agents.length > 0 && (
        <motion.div
          key="continue-agents"
          data-pipper-id="continue-agents"
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
          className="absolute inset-x-5 bottom-[calc(100%-12px)] z-0"
        >
          <Elevated
            offset={2}
            className="overflow-hidden rounded-t-xl border border-border px-2 pb-5 pt-2 shadow-lg"
          >
            <div className="px-2 pb-1.5 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Continue with
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {agents.map((agent, index) => (
                <Button
                  key={agent.id}
                  variant="ghost"
                  size="sm"
                  active={selectedIndex === index}
                  className="w-full justify-start"
                  onClick={() => onSelect(agent.id)}
                >
                  {agent.displayName}
                </Button>
              ))}
            </div>
          </Elevated>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
