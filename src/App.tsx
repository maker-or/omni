import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { SelectionBackground } from "@phosphor-icons/react";
import { AgentView } from "@/components/agent-view";
import { OthersView } from "@/components/others-view";
import { FlyoutView } from "@/components/flyout-view";

export default function App() {
  const [stage] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("stage");
    }
    return null;
  });

  const { activeProject, loadActiveProject, isLoading } = useProjectStore();

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

  if (stage === "flyout") {
    return <FlyoutView />;
  }

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-1 text-muted-foreground text-sm font-mono">
        Loading project context…
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen flex flex-col bg-surface-1 text-foreground">
      {/* Title Bar / Header */}
      <header
        className="h-8 flex items-center justify-between pl-20 pr-4 border-b border-border/60 bg-surface-1 select-none shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        data-pipper-id="header"
      >
        <div className="flex items-center gap-2" data-pipper-id="Project Name">
          {activeProject && (
            <>
              <ProjectIcon name={activeProject.icon} className="size-4 text-muted-foreground" />
              <span className="text-[13px] font-medium tracking-tight text-foreground">
                {activeProject.name}
              </span>
            </>
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
              if (window.omni?.flyout?.open) {
                void window.omni.flyout.open();
              }
            }}
            aria-label="Open Flyout"
            title="Open Flyout"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <SelectionBackground className="size-4" />
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Workspace Panels */}
      <Group
        orientation="horizontal"
        defaultLayout={{ agent: 40, others: 60 }}
        className="flex-1 flex min-h-0"
        data-pipper-id="workspace panel"
      >
        <Panel
          data-pipper-id="agent panel"
          minSize="40%"
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
