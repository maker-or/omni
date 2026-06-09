import { useEffect, useState, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { useTerminalStore } from "@/store/terminal-store";
import { TerminalSession } from "@/components/terminal-session";
import { AgentPanel } from "@/components/agent-panel";

export default function App() {
  const { activeProject, loadActiveProject, isLoading } = useProjectStore();

  useEffect(() => {
    void loadActiveProject();
  }, [loadActiveProject]);

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
              <ProjectIcon
                name={activeProject.icon}
                className="size-4 text-muted-foreground"
              />
              <span className="text-[13px] font-medium tracking-tight text-foreground">
                {activeProject.name}
              </span>
            </>
          )}
        </div>
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          data-pipper-id="Theme Toggle"
        >
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
          className="overflow-hidden"
        >
          <AgentView />
        </Panel>
        <Separator className="group relative w-px bg-border data-[separator-state=hover]:bg-foreground/20 data-[separator-state=drag]:bg-foreground/30 transition-colors">
          <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
        </Separator>
        <Panel
          data-pipper-id="others panel"
          minSize="40%"
          className="overflow-hidden"
        >
          <OthersView />
        </Panel>
      </Group>
    </div>
  );
}

function AgentView() {
  return <AgentPanel />;
}

function OthersView() {
  const { activeProject } = useProjectStore();
  const {
    sessions,
    activeSessionId,
    createSession,
    closeSession,
    setActiveSessionId,
  } = useTerminalStore();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Sync activeTabId when the active terminal session changes or when a terminal is closed
  useEffect(() => {
    if (activeSessionId) {
      setActiveTabId(activeSessionId);
    } else if (sessions.length > 0) {
      setActiveTabId(sessions[sessions.length - 1].id);
    } else {
      setActiveTabId(null);
    }
  }, [activeSessionId, sessions]);

  const handleTabChange = (val: string) => {
    setActiveTabId(val);
    setActiveSessionId(val);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isDropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  return (
    <section
      className="h-full w-full flex flex-col bg-surface-1"
      data-pipper-id="others-panel"
    >
      <Tabs
        value={activeTabId || ""}
        onValueChange={handleTabChange}
        className="flex-1 flex flex-col min-h-0"
      >
        {/* Tab Header bar - always shown */}
        <div
          className="h-11  flex items-center justify-between px-4  select-none shrink-0 bg-surface-1"
          data-pipper-id="others-tab-panel"
        >
          <TabsList className="p-0 gap-1 overflow-x-auto max-w-[calc(100%-40px)]">
            {sessions.map((session) => (
              <TabItem
                key={session.id}
                value={session.id}
                label={session.title}
                onClose={() => closeSession(session.id)}
              />
            ))}
          </TabsList>

          <div className="relative">
            <Button
              ref={buttonRef}
              variant="ghost"
              size="icon-sm"
              active={isDropdownOpen}
              onClick={() => setIsDropdownOpen((prev) => !prev)}
            >
              <PlusIcon size={16} />
            </Button>

            {isDropdownOpen && (
              <div
                ref={dropdownRef}
                className="absolute right-0 top-full mt-1.5 z-50 origin-top-right"
              >
                <Dropdown>
                  <MenuItem
                    index={0}
                    label="Terminal"
                    onSelect={() => {
                      setIsDropdownOpen(false);
                      createSession(activeProject?.path);
                    }}
                  />
                </Dropdown>
              </div>
            )}
          </div>
        </div>

        {/* Tab contents */}
        <div
          className="flex-1 overflow-hidden min-h-0 flex flex-col bg-surface-1 p-2"
          data-pipper-id="others-content-panel"
        >
          {sessions.length === 0 ? (
            <div
              className="h-full w-full flex flex-col items-center justify-center bg-surface-1 p-6 select-none"
              data-pipper-id="others-emptyView-panel"
            >
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <span className="text-[13px] font-medium tracking-tight">
                  Click the plus icon to add new views
                </span>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden min-h-0">
              {sessions.map((session) => (
                <TabPanel
                  key={session.id}
                  value={session.id}
                  className="h-full w-full outline-none"
                >
                  {activeTabId === session.id && (
                    <TerminalSession sessionId={session.id} cwd={session.cwd} />
                  )}
                </TabPanel>
              ))}
            </div>
          )}
        </div>
      </Tabs>
    </section>
  );
}
