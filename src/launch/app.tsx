import { useCallback, useEffect, useState } from "react";
import { Warning } from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import { toast } from "@/components/ui/toast";
import { UnauthenticatedStage } from "./unauthenticated-stage";
import { AuthenticatedStage } from "./authenticated-stage";

export function LaunchApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [isLaunchingAuth, setIsLaunchingAuth] = useState(false);
  const [authUser, setAuthUser] = useState<{ name: string | null; email: string | null } | null>(
    null,
  );

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

  useEffect(() => {
    if (window.omni?.launch?.isReady) {
      window.omni.launch.isReady().then((ready) => {
        if (ready) setWorkspaceReady(true);
      });
    }

    if (!window.omni?.launch?.onWorkspaceReady) return;
    const cleanupReady = window.omni.launch.onWorkspaceReady(() => {
      setWorkspaceReady(true);
    });
    const cleanupError = window.omni.launch.onWorkspaceError((message) => {
      toast({
        title: "Workspace Setup Failed",
        description: message,
        icon: <Warning size={20} className="text-red-500" />,
        duration: 5000,
      });
    });
    const cleanupAuth = window.omni.launch.onAuthComplete
      ? window.omni.launch.onAuthComplete((user) => {
          setAuthUser(user);
        })
      : () => {};

    return () => {
      cleanupReady();
      cleanupError();
      cleanupAuth();
    };
  }, []);

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
      void handleOpen(project.id);
    },
    [handleOpen],
  );

  const handleAuthRedirect = useCallback(async (kind: "sign-in" | "sign-up") => {
    if (!window.omni?.shell?.openExternal) return;
    setIsLaunchingAuth(true);
    try {
      await window.omni.shell.openExternal(kind === "sign-in" ? "clerk:sign-in" : "clerk:sign-up");
    } catch (err) {
      console.error(`Failed to open Clerk ${kind}:`, err);
    } finally {
      setIsLaunchingAuth(false);
    }
  }, []);

  if (!authUser) {
    return (
      <UnauthenticatedStage isLaunchingAuth={isLaunchingAuth} onAuthRedirect={handleAuthRedirect} />
    );
  }

  return (
    <AuthenticatedStage
      authUser={authUser}
      projects={projects}
      selectedId={selectedId}
      isOpening={isOpening}
      isLoading={isLoading}
      loadError={loadError}
      workspaceReady={workspaceReady}
      handleOpen={handleOpen}
      handleProjectCreated={handleProjectCreated}
    />
  );
}
