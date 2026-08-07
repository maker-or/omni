import { useCallback, useEffect, useState } from "react";
import { Warning, CircleNotch } from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import { toast } from "@/components/ui/toast";
import { UnauthenticatedStage } from "./unauthenticated-stage";
import { AuthenticatedStage } from "./authenticated-stage";
import { useLauncherUpdateStore } from "@/store/launcher-update-store";
import { LauncherUpdateDialog, LauncherUpdateNotice } from "@/components/launcher-update";

export function LaunchApp() {
  const initializeLauncherUpdates = useLauncherUpdateStore((state) => state.initialize);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLaunchingAuth, setIsLaunchingAuth] = useState(false);
  const [authUser, setAuthUser] = useState<{ name: string | null; email: string | null } | null>(
    null,
  );
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

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
    async function checkAuth() {
      try {
        if (window.omni?.launch?.getUser) {
          const user = await window.omni.launch.getUser();
          setAuthUser(user);
          return;
        }
        setAuthUser(null);
      } catch (err) {
        console.error("Failed to check auth user:", err);
        setAuthUser(null);
      } finally {
        setIsCheckingAuth(false);
      }
    }
    void checkAuth();
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initializeLauncherUpdates().then((dispose) => {
      cleanup = dispose;
    });
    return () => cleanup?.();
  }, [initializeLauncherUpdates]);

  useEffect(() => {
    const cleanupAuth = window.omni.launch.onAuthComplete
      ? window.omni.launch.onAuthComplete((user) => {
          setAuthUser(user);
        })
      : () => {};

    return () => {
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
      if (err instanceof Error && err.message.includes("Sign in is required")) {
        setAuthUser(null);
      }
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
      toast({
        title: `Could not open ${kind}`,
        description: err instanceof Error ? err.message : "The browser link was blocked.",
        icon: <Warning size={20} className="text-red-500" />,
        duration: 5000,
      });
    } finally {
      setIsLaunchingAuth(false);
    }
  }, []);

  if (isCheckingAuth) {
    return (
      <>
        <div className="h-screen w-screen bg-[#171717] flex flex-col items-center justify-center text-muted-foreground gap-3 pb-28">
          <CircleNotch className="animate-spin text-primary" size={32} />
          <span className="text-sm font-medium tracking-tight">Checking authorization…</span>
        </div>
        <LauncherUpdateNotice />
        <LauncherUpdateDialog />
      </>
    );
  }

  if (!authUser) {
    return (
      <>
        <UnauthenticatedStage
          isLaunchingAuth={isLaunchingAuth}
          onAuthRedirect={handleAuthRedirect}
        />
        <LauncherUpdateNotice />
        <LauncherUpdateDialog />
      </>
    );
  }

  return (
    <>
      <AuthenticatedStage
        authUser={authUser}
        projects={projects}
        selectedId={selectedId}
        isOpening={isOpening}
        isLoading={isLoading}
        loadError={loadError}
        handleOpen={handleOpen}
        handleProjectCreated={handleProjectCreated}
      />
      <LauncherUpdateNotice />
      <LauncherUpdateDialog />
    </>
  );
}
