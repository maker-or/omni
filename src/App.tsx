import { useEffect, useState, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { useProjectStore } from "@/store/project-store";
import { Plus, FolderPlus, Ghost } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useThreadStore } from "@/store/thread-store";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { InputMessage } from "@/components/ui/input-message";
import { useIcon } from "@/lib/icon-context";
import { ChatMessage } from "@/components/ui/chat-message";

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
        className="h-11 flex items-center justify-between pl-[80px] pr-4 border-b border-border/60 bg-surface-1 select-none shrink-0"
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
  const { activeProject, loadActiveProject } = useProjectStore();
  const {
    threads,
    activeThreadId,
    loadThreads,
    setActiveThreadId,
    createThread,
  } = useThreadStore();
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ChevronDownIcon = useIcon("chevron-down");

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    async function loadProjects() {
      if (window.omni?.projects?.list) {
        const list = await window.omni.projects.list();
        setProjectsList(list);
      }
    }
    void loadProjects();
  }, []);

  // Sync active project with active thread's project on active tab switch
  useEffect(() => {
    if (activeThreadId && threads.length > 0) {
      const activeThread = threads.find((t) => t.id === activeThreadId);
      if (activeThread && activeThread.project_id !== activeProject?.id) {
        window.omni.projects.setActive(activeThread.project_id).then(() => {
          void loadActiveProject();
        });
      }
    }
  }, [activeThreadId, threads, activeProject, loadActiveProject]);

  // Load messages for the active thread
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    let active = true;
    window.omni.messages.list(activeThreadId).then((msgs) => {
      if (!active) return;
      setMessages(msgs);
    });
    return () => {
      active = false;
    };
  }, [activeThreadId]);

  const handleSelectThread = async (threadId: string) => {
    setActiveThreadId(threadId);
    const selectedThread = threads.find((t) => t.id === threadId);
    if (selectedThread && selectedThread.project_id !== activeProject?.id) {
      if (window.omni?.projects?.setActive) {
        await window.omni.projects.setActive(selectedThread.project_id);
        await loadActiveProject();
      }
    }
  };

  const handleSend = async (text: string) => {
    if (!text.trim() || !activeProject) return;

    let targetThreadId = activeThreadId;

    if (!targetThreadId) {
      const projName = activeProject.name;
      const projectThreads = threads.filter(
        (t) => t.project_id === activeProject.id,
      );
      const title = `${projName} #${projectThreads.length + 1}`;

      if (createThread) {
        const thread = await createThread(activeProject.id, title);
        if (thread) {
          targetThreadId = thread.id;
          setActiveThreadId(thread.id);
        }
      }
    }

    if (!targetThreadId) return;

    const userMsg = await window.omni.messages.create({
      thread_id: targetThreadId,
      role: "user",
      content: text.trim(),
    });

    if (targetThreadId === activeThreadId) {
      setMessages((current) => [...current, userMsg]);
    }

    setInputValue("");

    setTimeout(async () => {
      const assistantMsg = await window.omni.messages.create({
        thread_id: targetThreadId!,
        role: "assistant",
        content: `I received your message: "${text.trim()}". I am ready to help you with the project "${activeProject.name}".`,
      });

      // Get latest activeThreadId from store state to avoid stale closure
      const currentActiveId = useThreadStore.getState().activeThreadId;
      if (targetThreadId === currentActiveId) {
        setMessages((current) => [...current, assistantMsg]);
      }
    }, 1000);
  };

  const handleAddProject = async () => {
    setIsDropdownOpen(false);
    if (window.omni?.launch?.show) {
      await window.omni.launch.show("add");
    }
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

  const projectItems = projectsList.map((project, idx) => {
    const ProjectIconWrapper = (props: { className?: string }) => (
      <ProjectIcon name={project.icon} className={props.className} />
    );
    return {
      id: project.id,
      name: project.name,
      icon: ProjectIconWrapper,
      index: idx,
    };
  });

  const activeIdx = projectItems.findIndex((p) => p.id === activeProject?.id);
  const checkedIndex = activeIdx !== -1 ? activeIdx : undefined;
  const addProjectIdx = projectItems.length;

  const getProjectIcon = (projectId: string) => {
    const p = projectsList.find((proj) => proj.id === projectId);
    return p ? p.icon : null;
  };

  return (
    <section className="h-full w-full flex flex-col bg-surface-1">
      <Tabs
        value={activeThreadId || undefined}
        onValueChange={handleSelectThread}
        className="flex-1 flex flex-col min-h-0"
        data-pipper-id="threads panel"
      >
        {/* Tab Header bar - always shown */}
        <div className="h-11 border-b border-border/60 flex items-center justify-between px-4 select-none shrink-0 bg-surface-1">
          <TabsList className="bg-transparent p-0 gap-1 overflow-x-auto max-w-[calc(100%-40px)]">
            {threads.map((thread) => {
              const projIcon = getProjectIcon(thread.project_id);
              const ProjectIconComp = (props: { className?: string }) => (
                <ProjectIcon name={projIcon} className={props.className} />
              );
              return (
                <TabItem
                  key={thread.id}
                  value={thread.id}
                  label={thread.title}
                  icon={ProjectIconComp}
                />
              );
            })}
          </TabsList>

          {/* Trigger container */}
          <div className="relative">
            <Button
              ref={buttonRef}
              variant="ghost"
              size="icon-sm"
              active={isDropdownOpen}
              onClick={() => setIsDropdownOpen((prev) => !prev)}
            >
              <Plus size={16} />
            </Button>

            {isDropdownOpen && (
              <div
                ref={dropdownRef}
                className="absolute right-0 top-full mt-1.5 z-50 origin-top-right"
              >
                <Dropdown checkedIndex={checkedIndex}>
                  {projectItems.map((item) => (
                    <MenuItem
                      key={item.id}
                      index={item.index}
                      label={item.name}
                      icon={item.icon}
                      checked={activeProject?.id === item.id}
                      onSelect={async () => {
                        setIsDropdownOpen(false);
                        const projName = item.name;
                        const projectThreads = threads.filter(
                          (t) => t.project_id === item.id,
                        );
                        const title = `${projName} #${projectThreads.length + 1}`;
                        if (createThread) {
                          const thread = await createThread(item.id, title);
                          if (thread) {
                            setActiveThreadId(thread.id);
                            if (window.omni?.projects?.setActive) {
                              await window.omni.projects.setActive(item.id);
                              await loadActiveProject();
                            }
                          }
                        }
                      }}
                    />
                  ))}
                  {projectItems.length > 0 && <DropdownSeparator />}
                  <MenuItem
                    index={addProjectIdx}
                    label="Add Project"
                    icon={FolderPlus}
                    onSelect={handleAddProject}
                  />
                </Dropdown>
              </div>
            )}
          </div>
        </div>

        {/* Tab contents / Empty state */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col bg-surface-1">
          {/* Centered Area: either chat messages or the select selector */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {messages.length === 0 ? (
              /* Centered selector area */
              <div className="h-full flex flex-col items-center justify-center gap-6 p-6">
                <h2 className="text-xl font-semibold tracking-tight text-foreground/60 flex items-center gap-2 flex-wrap justify-center select-none">
                  <span>What should we cook in</span>
                  <Select
                    value={activeProject?.id || ""}
                    onValueChange={async (val) => {
                      if (window.omni?.projects?.setActive) {
                        await window.omni.projects.setActive(val);
                        await loadActiveProject();
                      }
                    }}
                  >
                    <SelectTrigger
                      className={cn(
                        "min-w-0 h-auto p-0 border-0 bg-transparent hover:bg-transparent shadow-none rounded-none",
                        "text-xl font-semibold text-foreground tracking-tight",
                        "underline underline-offset-4 decoration-border/60 hover:decoration-[#6B97FF]/60",
                        "[&>svg]:hidden",
                      )}
                      placeholder="Select project"
                    />
                    <SelectContent>
                      {projectsList.map((project, idx) => (
                        <SelectItem
                          key={project.id}
                          value={project.id}
                          index={idx}
                        >
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>?</span>
                </h2>
              </div>
            ) : (
              /* Chat Messages */
              <div className="flex flex-col gap-3 p-4">
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    from={msg.role === "user" ? "user" : "assistant"}
                  >
                    {msg.content}
                  </ChatMessage>
                ))}
              </div>
            )}
          </div>

          {/* Bottom message input field */}
          <div
            className={cn(
              "p-3 shrink-0 bg-surface-1",
              messages.length > 0 && "border-t border-border/60",
            )}
          >
            <div className="w-full max-w-2xl mx-auto">
              <InputMessage
                value={inputValue}
                onValueChange={setInputValue}
                placeholder="Ask me anything to start a thread..."
                rightSlot={
                  <Button
                    variant="ghost"
                    size="sm"
                    trailingIcon={ChevronDownIcon}
                  >
                    Sonnet 4.6
                  </Button>
                }
                onSend={handleSend}
              />
            </div>
          </div>
        </div>
      </Tabs>
    </section>
  );
}

function OthersView() {
  return (
    <section className="h-full w-full flex items-center justify-center">
      <span className="text-muted-foreground text-sm font-mono">
        Others view
      </span>
    </section>
  );
}
