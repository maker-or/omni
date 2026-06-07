import { useCallback, useEffect, useState } from "react";
import { FolderIcon, ArrowArcLeftIcon } from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import { Button } from "@/components/ui/button";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { cn } from "@/lib/utils";
import { AddProjectForm } from "./add-project-form";

type LaunchStage = "list" | "add";

export function LaunchApp() {
  const [stage, setStage] = useState<LaunchStage>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("stage") === "add") return "add";
    }
    return "list";
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    if (!window.omni?.projects?.list) {
      setLoadError("Database is unavailable.");
      setIsLoading(false);
      return;
    }

    setLoadError(null);
    setIsLoading(true);
    try {
      const rows = await window.omni.projects.list();
      setProjects(rows);
    } catch (err) {
      console.error("Failed to load projects:", err);
      setLoadError("Could not load projects.");
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleOpen = useCallback(async (projectId: string) => {
    if (!window.omni?.launch?.complete) return;
    setSelectedId(projectId);
    setIsOpening(true);
    try {
      await window.omni.launch.complete(projectId);
    } catch (err) {
      console.error("Failed to complete launch:", err);
      setIsOpening(false);
      setSelectedId(null);
    }
  }, []);

  const handleProjectCreated = useCallback(
    (project: Project) => {
      setProjects((current) => [...current, project].sort((a, b) => a.name.localeCompare(b.name)));
      setStage("list");
      void handleOpen(project.id);
    },
    [handleOpen],
  );

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-1 p-8">
      <div className="w-full max-w-xl rounded-xl p-8 flex flex-col gap-6">
        {stage === "list" ? (
          <>
            <header>
              <h1 className="text-2xl font-semibold text-foreground tracking-tight">
                Welcome to Pipper
              </h1>
            </header>

            <div className="flex justify-start">
              <Button
                variant="ghost"
                onClick={() => setStage("add")}
                leadingIcon={FolderIcon}
                className="-ml-3"
              >
                Add Project
              </Button>
            </div>

            <div className="h-px bg-border" />

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground px-1 pb-1">Recent projects</span>

              {loadError != null && (
                <p className="px-1 py-2 text-sm text-destructive" role="alert">
                  {loadError}
                </p>
              )}

              {isLoading && loadError == null && (
                <p className="px-1 py-2 text-sm text-muted-foreground">Loading…</p>
              )}

              {!isLoading && loadError == null && projects.length === 0 && (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  No projects yet. Add one to get started.
                </p>
              )}

              {projects.map((project) => {
                const isActive = selectedId === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => handleOpen(project.id)}
                    disabled={isOpening}
                    className={cn(
                      "group flex items-center gap-3 w-full",
                      "px-3 py-2 rounded-md text-left text-sm",
                      "text-foreground",
                      "hover:bg-accent",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:pointer-events-none",
                      "transition-colors",
                      isActive && "bg-accent",
                    )}
                  >
                    <ProjectIcon
                      name={project.icon}
                      className="size-4 text-muted-foreground group-hover:text-foreground shrink-0"
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                    <ArrowArcLeftIcon
                      className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      strokeWidth={1.75}
                    />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <AddProjectForm onBack={() => setStage("list")} onCreated={handleProjectCreated} />
        )}
      </div>
    </div>
  );
}
