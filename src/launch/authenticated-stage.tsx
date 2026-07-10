import { useEffect, useState } from "react";
import { ArrowArcLeftIcon, CircleNotch, FolderIcon } from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import { Button } from "@/components/ui/button";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { cn } from "@/lib/utils";
import { AddProjectForm } from "./add-project-form";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import { AgentSelector } from "@/components/agent-selector";
import { useAgentRegistryStore } from "@/store/agent-registry-store";

interface AuthenticatedStageProps {
  authUser: { name: string | null; email: string | null };
  projects: Project[];
  selectedId: string | null;
  isOpening: boolean;
  isLoading: boolean;
  loadError: string | null;
  workspaceReady: boolean;
  workspaceError: string | null;
  handleOpen: (projectId: string) => void;
  handleProjectCreated: (project: Project) => void;
}

type LaunchStage = "agent" | "list" | "add";

const AGENT_PICK_STORAGE_KEY = "pipper.launch.agentPicked";

export function AuthenticatedStage({
  authUser,
  projects,
  selectedId,
  isOpening,
  isLoading,
  loadError,
  workspaceReady,
  workspaceError,
  handleOpen,
  handleProjectCreated,
}: AuthenticatedStageProps) {
  const selectedAgentIds = useAgentRegistryStore((s) => s.selectedAgentIds);
  const loadAgents = useAgentRegistryStore((s) => s.load);

  const [stage, setStage] = useState<LaunchStage>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const stageParam = params.get("stage");
      if (stageParam === "add") {
        return "add";
      }
      if (stageParam === "agent") {
        return "agent";
      }
      // First-run / explicit agent re-pick: show registry before projects.
      try {
        if (sessionStorage.getItem(AGENT_PICK_STORAGE_KEY) !== "1") {
          return "agent";
        }
      } catch {
        return "agent";
      }
    }
    return "list";
  });

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#171717] text-foreground flex items-center justify-center p-6">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <AmbientPixelField intensity={0.35} fadeStart={0.8} />
      </div>

      {/* Bounded Card */}
      <div className="w-full max-w-md z-10 rounded-2xl p-8 flex flex-col gap-6">
        {stage === "agent" ? (
          <>
            <header className="flex flex-col gap-1 pb-2 border-b border-border">
              <h1 className="text-xl font-bold text-foreground tracking-tight truncate">
                Choose your agent(s)
              </h1>
              <p className="text-xs text-muted-foreground">
                Select all ACP coding agents you want to use. Cursor, Codex, and Claude are
                supported. You can pick one per thread later.
              </p>
            </header>
            <AgentSelector
              showContinue
              onContinue={() => {
                try {
                  sessionStorage.setItem(AGENT_PICK_STORAGE_KEY, "1");
                } catch {
                  // ignore
                }
                setStage("list");
              }}
            />
          </>
        ) : stage === "list" ? (
          <>
            <header className="flex flex-col gap-1 pb-2 border-b border-border">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-foreground tracking-tight truncate">
                    Welcome, {authUser.name ?? authUser.email ?? "User"}!
                  </h1>
                  <p className="text-xs text-muted-foreground">Select a project to start</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-[11px]"
                  data-pipper-id="change-agent-button"
                  onClick={() => setStage("agent")}
                >
                  {selectedAgentIds.length > 0
                    ? `Change agents (${selectedAgentIds.length})`
                    : "Select agents"}
                </Button>
              </div>
            </header>

            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recent Projects
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStage("add")}
                  leadingIcon={FolderIcon}
                  className="h-8 text-xs"
                  disabled={!workspaceReady}
                >
                  Add Project
                </Button>
              </div>

              {!workspaceReady && (
                <p className="rounded-lg border border-border/50 bg-surface-1/50 px-3 py-2 text-xs text-muted-foreground">
                  {workspaceError ??
                    "Setting up the local runtime. Project actions will unlock when ready."}
                </p>
              )}

              <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto pr-1">
                {loadError != null && (
                  <p className="py-2 text-sm text-destructive" role="alert">
                    {loadError}
                  </p>
                )}

                {isLoading && loadError == null && (
                  <p className="py-4 text-sm text-muted-foreground flex items-center gap-2 justify-center">
                    <CircleNotch className="animate-spin text-primary" size={16} />
                    Loading projects…
                  </p>
                )}

                {!isLoading && loadError == null && projects.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-xl bg-surface-1/40">
                    No projects yet. Add one to get started.
                  </p>
                )}

                {!isLoading &&
                  loadError == null &&
                  projects.map((project) => {
                    const isActive = selectedId === project.id;
                    const isWorkspacePending = !workspaceReady;

                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => !isWorkspacePending && handleOpen(project.id)}
                        disabled={isOpening || isWorkspacePending}
                        className={cn(
                          "group flex items-center gap-3 w-full",
                          "px-3 py-2.5 rounded-xl text-left text-sm",
                          "text-foreground bg-surface-1/40 border border-border/40",
                          "hover:bg-accent hover:border-accent",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          "disabled:opacity-60 disabled:cursor-not-allowed",
                          "transition-all duration-200",
                          isActive && "bg-accent border-accent",
                        )}
                      >
                        <ProjectIcon
                          name={project.icon}
                          className="size-4 text-muted-foreground group-hover:text-foreground shrink-0"
                        />
                        <span className="flex-1 truncate font-medium">{project.name}</span>
                        {isWorkspacePending ? (
                          <CircleNotch
                            className="animate-spin text-muted-foreground shrink-0"
                            size={14}
                          />
                        ) : (
                          <ArrowArcLeftIcon
                            className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                            strokeWidth={1.75}
                          />
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          </>
        ) : (
          <>
            <AddProjectForm
              onBack={() => setStage("list")}
              onCreated={handleProjectCreated}
              disabled={!workspaceReady}
              disabledReason={
                workspaceError ??
                "Setting up the local runtime. Project creation will unlock when ready."
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
