import { createContext, useContext, type ReactNode } from "react";
import type { HeaderTone } from "@/lib/workspace-tone";

/**
 * The active workspace's git-state tone, exposed to surfaces that want to
 * mirror it (e.g. the composer's turn marker). `null` means "no workspace
 * tone in scope" — consumers fall back to their own default.
 */
const WorkspaceToneContext = createContext<HeaderTone | null>(null);

export function WorkspaceToneProvider({
  tone,
  children,
}: {
  tone: HeaderTone | null;
  children: ReactNode;
}) {
  return <WorkspaceToneContext.Provider value={tone}>{children}</WorkspaceToneContext.Provider>;
}

export function useWorkspaceTone(): HeaderTone | null {
  return useContext(WorkspaceToneContext);
}
