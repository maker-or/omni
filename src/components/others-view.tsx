import { useEffect, useState, useRef } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { useProjectStore } from "@/store/project-store";
import { useTerminalStore } from "@/store/terminal-store";
import { TerminalSession } from "@/components/terminal-session";
import { BorderBeam } from "border-beam";

export function OthersView() {
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
    <BorderBeam colorVariant="mono">
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
            <TabsList className="p-1 gap-1 overflow-x-auto max-w-[calc(100%-40px)]">
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
                      <TerminalSession
                        sessionId={session.id}
                        cwd={session.cwd}
                      />
                    )}
                  </TabPanel>
                ))}
              </div>
            )}
          </div>
        </Tabs>
      </section>
    </BorderBeam>
  );
}
