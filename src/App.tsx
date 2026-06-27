import { useEffect, useState, useRef, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { SelectionBackground } from "@phosphor-icons/react";
import { Bell, ChevronDown, FolderPlus } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/components/ui/toast";
import { AgentView } from "@/components/agent-view";
import { OthersView } from "@/components/others-view";
import { CompanionView } from "@/components/companion-view";
import { PipperOverlay } from "@/components/pipper-overlay";
import { usePipperStore } from "@/store/pipper-store";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { UpdateBanner } from "@/components/update-banner";
import { UpdateDialog } from "@/components/update-dialog";
import { useUpdateStore } from "@/store/update-store";
import { useLauncherUpdateStore } from "@/store/launcher-update-store";
import { LauncherUpdateBanner, LauncherUpdateDialog } from "@/components/launcher-update";

export default function App() {
  const [stage] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("stage");
    }
    return null;
  });

  const { activeProject, loadActiveProject, isLoading, error: projectError } = useProjectStore();
  const { syncFromBroadcast } = usePipperStore();
  const initializeUpdates = useUpdateStore((state) => state.initialize);
  const checkForUpdates = useUpdateStore((state) => state.check);
  const updateState = useUpdateStore((state) => state.state);
  const updateRun = useUpdateStore((state) => state.run);
  const initializeLauncherUpdates = useLauncherUpdateStore((state) => state.initialize);

  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const loadProjectsList = async () => {
    try {
      if (window.omni?.projects?.list) {
        const list = await window.omni.projects.list();
        setProjectsList(list);
      }
    } catch (err) {
      console.error("Failed to load projects list:", err);
    }
  };

  useEffect(() => {
    void loadProjectsList();
  }, [activeProject?.id]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initializeUpdates().then((dispose) => {
      cleanup = dispose;
    });
    return () => cleanup?.();
  }, [initializeUpdates]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initializeLauncherUpdates().then((dispose) => {
      cleanup = dispose;
    });
    return () => cleanup?.();
  }, [initializeLauncherUpdates]);

  useEffect(() => {
    if (updateState?.phase === "awaiting-health-check" && updateRun?.target_version) {
      void window.omni.update.markActiveHealthy(updateRun.target_version).then((success) => {
        if (!success) {
          toast({
            icon: <Bell className="size-5 text-red-500" />,
            title: "Update health check not accepted",
            description: "The updater is waiting for a matching active version.",
          });
        }
      });
    }
  }, [updateState?.phase, updateRun?.target_version]);

  const handleToggleDropdown = async () => {
    if (!isDropdownOpen) {
      await loadProjectsList();
    }
    setIsDropdownOpen((prev) => !prev);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        isDropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const checkedIndex = useMemo(() => {
    const idx = projectsList.findIndex((p) => p.id === activeProject?.id);
    return idx !== -1 ? idx : undefined;
  }, [activeProject?.id, projectsList]);

  // Subscribe to pipper cross-window state broadcasts
  useEffect(() => {
    if (!window.omni?.pipper?.onStateChanged) return;
    const unsub = window.omni.pipper.onStateChanged((payload) => {
      syncFromBroadcast(payload);
    });
    return unsub;
  }, [syncFromBroadcast]);

  useEffect(() => {
    void loadActiveProject();
  }, [loadActiveProject]);

  useEffect(() => {
    if (!window.omni?.projects?.onActiveChanged) return;
    const unsubscribe = window.omni.projects.onActiveChanged(() => {
      void loadActiveProject();
    });
    return unsubscribe;
  }, [loadActiveProject]);

  if (stage === "companion") {
    return <CompanionView />;
  }

  if (isLoading && !activeProject) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-1 text-muted-foreground text-sm font-mono">
        Loading project context…
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen flex flex-col bg-surface-1 text-foreground">
      {/* Pipper overlay — sits above everything in the main window */}
      <PipperOverlay />
      <UpdateDialog />
      <LauncherUpdateDialog />

      {/* Title Bar / Header */}
      <header
        className="h-8 flex items-center justify-between pl-20 pr-4 border-b border-border/60 bg-surface-1 select-none shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        data-pipper-id="header"
      >
        <div
          className="relative flex items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          data-pipper-id="Project Selector Wrapper"
        >
          {activeProject && (
            <button
              type="button"
              ref={buttonRef}
              onClick={handleToggleDropdown}
              className="flex items-center gap-1.5 px-2 py-0.5 -mx-2 rounded-md hover:bg-accent hover:text-foreground text-muted-foreground transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer select-none"
            >
              <ProjectIcon name={activeProject.icon} className="size-4 text-muted-foreground/80" />
              <span className="text-[13px] font-medium tracking-tight text-foreground">
                {activeProject.name}
              </span>
              <ChevronDown
                className="size-3 text-muted-foreground/60 transition-transform duration-200"
                style={{
                  transform: isDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </button>
          )}

          {isDropdownOpen && (
            <div ref={dropdownRef} className="absolute left-0 top-full mt-1 z-[200]">
              <Dropdown checkedIndex={checkedIndex} className="w-64 max-h-[300px]">
                {projectsList.map((project, idx) => {
                  const ProjectIconItem = ((props: { className?: string }) => (
                    <ProjectIcon name={project.icon} className={props.className} />
                  )) as any;
                  return (
                    <MenuItem
                      key={project.id}
                      index={idx}
                      label={project.name}
                      icon={ProjectIconItem}
                      checked={activeProject?.id === project.id}
                      onSelect={async () => {
                        setIsDropdownOpen(false);
                        if (window.omni?.projects?.setActive) {
                          try {
                            await window.omni.projects.setActive(project.id);
                          } catch (err) {
                            toast({
                              icon: <Bell className="size-5 text-red-500" />,
                              title: "Project switch failed",
                              description:
                                err instanceof Error
                                  ? err.message
                                  : "Could not activate that project.",
                            });
                          }
                        }
                      }}
                    />
                  );
                })}
                {projectsList.length > 0 && <DropdownSeparator />}
                <MenuItem
                  index={projectsList.length}
                  label="Add Project"
                  icon={FolderPlus}
                  onSelect={async () => {
                    setIsDropdownOpen(false);
                    if (window.omni?.launch?.show) {
                      await window.omni.launch.show("add");
                    }
                  }}
                />
              </Dropdown>
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          data-pipper-id="Theme and Flyout Controls"
        >
          <button
            type="button"
            onClick={() => {
              if (window.omni?.companion?.open) {
                window.omni.companion.open().catch((err) => {
                  toast({
                    icon: <Bell className="size-5 text-red-500" />,
                    title: "Could not open companion",
                    description:
                      err instanceof Error ? err.message : "Edit mode is not available right now.",
                  });
                });
              }
            }}
            aria-label="Open Companion"
            title="Open Companion"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <SelectionBackground className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              void Promise.allSettled([window.omni.launcherUpdate.check(), checkForUpdates()]);
              toast({
                icon: <Bell className="size-5 text-blue-500" />,
                title: "Checking for updates",
                description: "Pipper will notify you when a newer version is available.",
              });
            }}
            aria-label="Check for updates"
            title="Check for updates"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <Bell className="size-4" />
          </button>

          <ThemeToggle />
        </div>
      </header>

      <LauncherUpdateBanner />
      <UpdateBanner />
      {projectError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-500">
          {projectError}
        </div>
      )}

      <Toaster />

      {/* Workspace Panels */}
      <Group
        orientation="horizontal"
        defaultLayout={{ agent: 40, others: 60 }}
        className="flex-1 flex min-h-0"
        data-pipper-id="workspace panel"
      >
        <Panel
          data-pipper-id="agent panel"
          maxSize="40%"
          className="relative z-20 overflow-visible"
        >
          <AgentView />
        </Panel>
        <Separator className="group relative w-px bg-border data-[separator-state=hover]:bg-foreground/20 data-[separator-state=drag]:bg-foreground/30 transition-colors">
          <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
        </Separator>
        <Panel
          data-pipper-id="others panel"
          minSize="40%"
          className="relative z-10 overflow-hidden"
        >
          <OthersView />
        </Panel>
      </Group>
    </div>
  );
}
