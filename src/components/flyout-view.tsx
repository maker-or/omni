import { useEffect, useState } from "react";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { cn } from "@/lib/utils";

export function FlyoutView() {
  const { activeProject, loadActiveProject } = useProjectStore();
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadActiveProject();
    async function loadProjects() {
      if (window.omni?.projects?.list) {
        try {
          const list = await window.omni.projects.list();
          setProjects(list);
        } catch (err) {
          console.error("Failed to load projects in flyout:", err);
        } finally {
          setIsLoading(false);
        }
      }
    }
    void loadProjects();
  }, [loadActiveProject]);

  useEffect(() => {
    if (!window.omni?.projects?.onActiveChanged) return;
    const unsubscribe = window.omni.projects.onActiveChanged(() => {
      void loadActiveProject();
    });
    return unsubscribe;
  }, [loadActiveProject]);

  const handleSelectProject = async (projectId: string) => {
    if (window.omni?.projects?.setActive) {
      await window.omni.projects.setActive(projectId);
      await loadActiveProject();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-surface-1 text-foreground select-none overflow-hidden">
      {/* Frameless Drag Handle & Custom Header */}
      <header
        className="h-10 flex items-center justify-between px-4 border-b border-border/60  shrink-0"
        style={{ WebkitAppRegion: "none" } as React.CSSProperties}
      ></header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {/* Active Project Card */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Active Workspace
          </span>
          {activeProject ? (
            <div className="relative group overflow-hidden rounded-xl border border-border/80 bg-surface-2 p-4 shadow-sm hover:shadow-md transition-all duration-300">
              {/* Decorative background gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50 group-hover:scale-105 transition-transform duration-500 pointer-events-none" />
              <div className="relative flex items-start gap-3">
                <div className="p-2 rounded-lg bg-surface-3 border border-border/40 shadow-inner shrink-0">
                  <ProjectIcon name={activeProject.icon} className="size-5 text-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold tracking-tight text-foreground truncate">
                    {activeProject.name}
                  </h3>
                  <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                    {activeProject.path}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface-1/50 p-4 text-center text-xs text-muted-foreground">
              No active workspace selected
            </div>
          )}
        </div>

        {/* All Workspaces List */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Switch Workspace
          </span>
          {isLoading ? (
            <div className="text-xs text-muted-foreground p-2 font-mono">Loading workspaces…</div>
          ) : projects.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">No other workspaces found.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {projects.map((project) => {
                const isActive = activeProject?.id === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => handleSelectProject(project.id)}
                    className={cn(
                      "group flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border text-left transition-all duration-200",
                      isActive
                        ? "bg-accent/30 border-primary/30 shadow-sm"
                        : "bg-surface-2 hover:bg-accent/40 border-border/40 hover:border-border/80",
                    )}
                  >
                    <div
                      className={cn(
                        "p-1.5 rounded-md shrink-0 border transition-colors",
                        isActive
                          ? "bg-primary/10 border-primary/20"
                          : "bg-surface-3 border-border/40 group-hover:border-border/80",
                      )}
                    >
                      <ProjectIcon
                        name={project.icon}
                        className={cn(
                          "size-3.5",
                          isActive
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground truncate">
                          {project.name}
                        </span>
                        {isActive && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/10">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="block text-[10px] font-mono text-muted-foreground truncate mt-0.5">
                        {project.path}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
