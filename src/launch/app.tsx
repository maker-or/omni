import { useCallback, useEffect, useState } from "react";
import {
  FolderIcon,
  ArrowArcLeftIcon,
  Warning,
  CheckCircle,
  CircleNotch,
  ArrowClockwise,
} from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import { Button } from "@/components/ui/button";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { cn } from "@/lib/utils";
import { AddProjectForm } from "./add-project-form";
import { Elevated } from "@/lib/elevated";

type LaunchStage = "list" | "add" | "onboarding";

export function LaunchApp() {
  const [stage, setStage] = useState<LaunchStage>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("stage");
      if (s === "add") return "add";
      if (s === "onboarding") return "onboarding";
    }
    return "list";
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Onboarding states
  const [gitInstalled, setGitInstalled] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState("Checking toolchain...");
  const [onboardingStatus, setOnboardingStatus] = useState<
    "pending" | "running" | "complete" | "failed"
  >("running");
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [isVerifyingGit, setIsVerifyingGit] = useState(false);

  useEffect(() => {
    if (stage !== "onboarding") return;

    if (!window.omni?.onboarding) {
      setOnboardingStatus("failed");
      setOnboardingError("Onboarding API is unavailable.");
      return;
    }

    const unsub = window.omni.onboarding.onProgress((data) => {
      setOnboardingStep(data.step);
      setOnboardingStatus(data.status);
      if (data.error) setOnboardingError(data.error);
      if (data.gitInstalled !== undefined) setGitInstalled(data.gitInstalled);

      if (data.status === "complete") {
        setTimeout(() => {
          setStage("list");
        }, 1000);
      }
    });

    window.omni.onboarding.startSetup().catch((err) => {
      setOnboardingStatus("failed");
      setOnboardingError(err instanceof Error ? err.message : String(err));
    });

    return unsub;
  }, [stage]);

  const handleVerifyGit = async () => {
    if (!window.omni?.onboarding?.verifyGit) return;
    setIsVerifyingGit(true);
    setOnboardingError(null);
    try {
      const success = await window.omni.onboarding.verifyGit();
      if (success) {
        setGitInstalled(true);
        setOnboardingStatus("running");
        await window.omni.onboarding.startSetup();
      } else {
        setOnboardingError("Git was not detected. Please make sure it's installed.");
      }
    } catch (err) {
      setOnboardingError("Failed to verify Git installation.");
    } finally {
      setIsVerifyingGit(false);
    }
  };

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

  if (stage === "onboarding") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-1 p-8">
        <Elevated
          offset={2}
          className="w-full max-w-md rounded-xl border border-border p-8 shadow-surface-6 flex flex-col gap-6"
        >
          <header className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-foreground tracking-tight">Setting up Pipper</h1>
            <p className="text-xs text-muted-foreground">
              Preparing your local environment and workspace files
            </p>
          </header>

          <div className="h-px bg-border" />

          {!gitInstalled ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 text-destructive text-sm leading-relaxed">
                <Warning size={20} className="shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Git Required</span>
                  Pipper needs Git for tracking versions and rolling back changes.
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground pl-1">
                  Install via Homebrew:
                </span>
                <pre className="rounded bg-black/95 p-3 font-mono text-[11px] text-zinc-100 select-all border border-zinc-800">
                  brew install git
                </pre>
              </div>

              {onboardingError && (
                <p className="text-xs text-red-500 font-medium pl-1">{onboardingError}</p>
              )}

              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleVerifyGit}
                disabled={isVerifyingGit}
                className="w-full mt-2"
                leadingIcon={isVerifyingGit ? CircleNotch : ArrowClockwise}
              >
                {isVerifyingGit ? "Verifying..." : "Verify Installation"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex items-center gap-3">
                {onboardingStatus === "running" && (
                  <CircleNotch size={18} className="text-primary animate-spin shrink-0" />
                )}
                {onboardingStatus === "complete" && (
                  <CheckCircle size={18} className="text-green-500 shrink-0" />
                )}
                {onboardingStatus === "failed" && (
                  <Warning size={18} className="text-red-500 shrink-0" />
                )}
                <span className="text-sm font-medium text-foreground">{onboardingStep}</span>
              </div>

              {onboardingStatus === "failed" && onboardingError && (
                <div className="mt-2 flex flex-col gap-3">
                  <p className="text-xs text-red-500 font-medium whitespace-pre-wrap">
                    Error: {onboardingError}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setOnboardingStatus("running");
                      setOnboardingError(null);
                      window.omni.onboarding.startSetup().catch((err: unknown) => {
                        setOnboardingStatus("failed");
                        setOnboardingError(err instanceof Error ? err.message : String(err));
                      });
                    }}
                  >
                    Retry Setup
                  </Button>
                </div>
              )}

              {onboardingStatus === "running" && (
                <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full animate-pulse"
                    style={{ width: "60%" }}
                  />
                </div>
              )}
            </div>
          )}
        </Elevated>
      </div>
    );
  }

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
