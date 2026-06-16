import { useState } from "react";
import { ArrowArcLeftIcon, CircleNotch, FolderIcon } from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import { Button } from "@/components/ui/button";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { cn } from "@/lib/utils";
import { AddProjectForm } from "./add-project-form";
import { AmbientPixelField } from "@/components/ambient-pixel-field";

interface AuthenticatedStageProps {
  authUser: { name: string | null; email: string | null };
  projects: Project[];
  selectedId: string | null;
  isOpening: boolean;
  isLoading: boolean;
  loadError: string | null;
  workspaceReady: boolean;
  handleOpen: (projectId: string) => void;
  handleProjectCreated: (project: Project) => void;
}

type LaunchStage = "list" | "add";

export function AuthenticatedStage({
  authUser,
  projects,
  selectedId,
  isOpening,
  isLoading,
  loadError,
  workspaceReady,
  handleOpen,
  handleProjectCreated,
}: AuthenticatedStageProps) {
  const [stage, setStage] = useState<LaunchStage>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const stageParam = params.get("stage");
      if (stageParam === "add") {
        return "add";
      }
    }
    return "list";
  });

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#171717] text-foreground flex items-center justify-center p-6">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <AmbientPixelField intensity={0.35} fadeStart={0.8} />
      </div>

      {/* Bounded Card */}
      <div className="w-full max-w-md z-10 rounded-2xl p-8 flex flex-col gap-6">
        {stage === "list" ? (
          <>
            <header className="flex flex-col gap-1 pb-2 border-b border-border">
              <h1 className="text-xl font-bold text-foreground tracking-tight truncate">
                Welcome, {authUser.name ?? authUser.email ?? "User"}!
              </h1>
              <p className="text-xs text-muted-foreground">Select a project to start</p>
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
                >
                  Add Project
                </Button>
              </div>

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
            <AddProjectForm onBack={() => setStage("list")} onCreated={handleProjectCreated} />
          </>
        )}
      </div>
    </div>
  );
}
