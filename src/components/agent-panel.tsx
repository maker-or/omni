"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PlusIcon, FolderPlusIcon, PauseIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { InputMessage } from "@/components/ui/input-message";
import { ChatMessage } from "@/components/ui/chat-message";
import { useIcon } from "@/lib/icon-context";
import { useProjectStore } from "@/store/project-store";
import { useThreadStore } from "@/store/thread-store";
import { useAgentStore } from "@/store/agent-store";
import { Streamdown } from "streamdown";
import type { AgentUiRequest } from "../../contracts/agent.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

type MessageLike = AgentMessage & { role?: string };

function stringifyMessageContent(message: MessageLike): string {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: string; text?: string; thinking?: string };
      if (typed.type === "text" && typeof typed.text === "string") return typed.text;
      if (typed.type === "thinking" && typeof typed.thinking === "string") return typed.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getToolSummary(message: MessageLike): string | null {
  const content = (message as unknown as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const toolNames = content
    .map((part) => (part && typeof part === "object" && "type" in part && (part as { type?: string; name?: string }).type === "toolCall"
      ? (part as { name?: string }).name
      : null))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!toolNames.length) return null;
  return toolNames.join(", ");
}

function MessageBody({ message }: { message: MessageLike }) {
  const role = message.role;
  const body = stringifyMessageContent(message);
  const toolSummary = getToolSummary(message);

  if (role === "toolResult") {
    return (
      <div className="rounded-md border border-border/70 bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground">
        <div className="font-medium text-foreground/80">{(message as { toolName?: string }).toolName ?? "Tool result"}</div>
        <div className="mt-1 whitespace-pre-wrap break-words">
          {body || "Completed"}
        </div>
      </div>
    );
  }

  if (role === "assistant") {
    return (
      <div className="space-y-2">
        <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
          <Streamdown className="text-[14px] leading-6">{body || " "}</Streamdown>
        </div>
        {toolSummary && (
          <div className="text-[12px] text-muted-foreground font-mono">
            Tools: {toolSummary}
          </div>
        )}
      </div>
    );
  }

  return <div className="whitespace-pre-wrap break-words text-[14px] leading-6">{body}</div>;
}

function UiRequestDialog({
  request,
  onClose,
}: {
  request: AgentUiRequest;
  onClose: (value: string | boolean | undefined) => void;
}) {
  const [text, setText] = useState(() => ("prefill" in request ? request.prefill ?? "" : ""));
  useEffect(() => {
    setText("prefill" in request ? request.prefill ?? "" : "");
  }, [request]);

  if (request.kind === "select") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-4 shadow-surface-6">
          <div className="text-sm font-medium text-foreground">{request.title}</div>
          {request.message && <div className="mt-2 text-sm text-muted-foreground">{request.message}</div>}
          <div className="mt-4 flex flex-col gap-2">
            {request.options.map((option) => (
              <Button key={option} variant="secondary" className="justify-start" onClick={() => onClose(option)}>
                {option}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (request.kind === "confirm") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-4 shadow-surface-6">
          <div className="text-sm font-medium text-foreground">{request.title}</div>
          <div className="mt-2 text-sm text-muted-foreground">{request.message}</div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onClose(false)}>
              No
            </Button>
            <Button onClick={() => onClose(true)}>Yes</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-4 shadow-surface-6">
        <div className="text-sm font-medium text-foreground">{request.title}</div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={request.placeholder}
          className="mt-3 min-h-28 w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onClose(undefined)}>
            Cancel
          </Button>
          <Button onClick={() => onClose(text.trim() || undefined)}>Submit</Button>
        </div>
      </div>
    </div>
  );
}

export function AgentPanel() {
  const { activeProject, loadActiveProject } = useProjectStore();
  const { threads, loadThreads } = useThreadStore();
  const {
    snapshot,
    uiRequest,
    connect,
    refresh,
    sendPrompt,
    switchThread,
    respondToUiRequest,
    abort,
  } = useAgentStore();
  const [projectsList, setProjectsList] = useState<Array<{ id: string; name: string; icon: string }>>([]);
  const [inputValue, setInputValue] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const threadPaneRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [threadPaneStyle, setThreadPaneStyle] = useState<CSSProperties | null>(null);
  const ChevronDownIcon = useIcon("chevron-down");

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    async function loadProjects() {
      const list = await window.omni.projects.list();
      setProjectsList(list);
    }
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) {
      setHoveredProjectId(null);
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!hoveredProjectId) return;
    const exists = projectsList.some((project) => project.id === hoveredProjectId);
    if (!exists) {
      setHoveredProjectId(projectsList[0]?.id ?? null);
    }
  }, [hoveredProjectId, projectsList]);

  useEffect(() => {
    if (!isDropdownOpen || !hoveredProjectId) {
      setThreadPaneStyle(null);
      return;
    }

    const updatePosition = () => {
      const rect = projectListRef.current?.getBoundingClientRect();
      if (!rect) return;
      setThreadPaneStyle({
        position: "fixed",
        top: `${Math.round(rect.top)}px`,
        left: `${Math.round(rect.right + 8)}px`,
        zIndex: 3000,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isDropdownOpen, hoveredProjectId]);

  useEffect(() => {
    if (activeProject?.id) {
      void refresh();
    }
  }, [activeProject?.id, refresh]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isDropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        if (threadPaneRef.current?.contains(event.target as Node)) return;
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const commands = snapshot?.commands ?? [];
  const modelName = snapshot?.model?.name ?? "No model";
  const threadId = snapshot?.threadId ?? "";
  const activeThread = threads.find((thread) => thread.id === threadId) ?? null;
  const activeMessages = snapshot?.messages ?? [];
  const streamingMessage = snapshot?.streamingMessage ?? null;
  const queueCount = (snapshot?.queue.steering.length ?? 0) + (snapshot?.queue.followUp.length ?? 0);
  const slashMatches = useMemo(() => {
    const trimmed = inputValue.trimStart();
    if (!trimmed.startsWith("/")) return [];
    const query = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
    return commands.filter((command) =>
      command.name.toLowerCase().includes(query),
    );
  }, [commands, inputValue]);

  const handleSelectThread = async (id: string) => {
    await switchThread(id);
    await loadActiveProject();
    await loadThreads();
    await refresh();
  };

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await sendPrompt({
      threadId: snapshot?.threadId ?? undefined,
      message: trimmed,
    });
    setInputValue("");
  };

  const applyCommand = (commandName: string) => {
    setInputValue(`/${commandName} `);
  };

  const projectItems = projectsList.map((project, idx) => ({
    id: project.id,
    name: project.name,
    icon: project.icon,
    index: idx,
  }));

  const checkedIndex = projectItems.findIndex((item) => item.id === activeProject?.id);
  const addProjectIndex = projectItems.length;
  const hoveredProjectThreads = hoveredProjectId
    ? threads.filter((thread) => thread.project_id === hoveredProjectId)
    : [];

  return (
    <section className="relative z-20 h-full w-full flex flex-col bg-surface-1 overflow-visible">
      {uiRequest && (
        <UiRequestDialog
          request={uiRequest}
          onClose={(value) => {
            void respondToUiRequest({
              requestId: uiRequest.id,
              value,
            });
          }}
        />
      )}

      <Tabs value={threadId} onValueChange={handleSelectThread} className="flex-1 flex flex-col min-h-0">
        <div className="h-11 flex items-center justify-between px-4 select-none shrink-0 bg-surface-1 border-b border-border/60">
          <TabsList className="p-0 gap-1 overflow-x-auto max-w-[calc(100%-40px)]">
            {threads.map((thread) => {
              const project = projectsList.find((item) => item.id === thread.project_id);
              const Icon = project
                ? ((props: { className?: string }) => (
                    <ProjectIcon name={project.icon} className={props.className} />
                  )) as any
                : undefined;
              return (
                <TabItem
                  key={thread.id}
                  value={thread.id}
                  label={thread.title}
                  icon={Icon}
                />
              );
            })}
          </TabsList>

            <div className="relative">
              <Button
                ref={buttonRef}
                variant="ghost"
                size="icon-sm"
                active={isDropdownOpen}
                onClick={() => setIsDropdownOpen((prev) => {
                  const next = !prev;
                  if (next) setHoveredProjectId(null);
                  return next;
                })}
              >
                <PlusIcon size={16} />
              </Button>

            {isDropdownOpen && (
              <div ref={dropdownRef} className="absolute right-0 top-full mt-1.5 z-[200]">
                <div ref={projectListRef} className="relative">
                  <Dropdown checkedIndex={checkedIndex} className="w-72">
                  {projectItems.map((item) => {
                    const project = projectsList.find((p) => p.id === item.id);
                    const ProjectIconItem = project
                      ? ((props: { className?: string }) => (
                          <ProjectIcon name={project.icon} className={props.className} />
                        )) as any
                      : undefined;
                    return (
                      <MenuItem
                        key={item.id}
                        index={item.index}
                        label={item.name}
                        icon={ProjectIconItem}
                        checked={activeProject?.id === item.id}
                        onMouseEnter={() => setHoveredProjectId(item.id)}
                        onFocus={() => setHoveredProjectId(item.id)}
                        onSelect={() => setHoveredProjectId(item.id)}
                      />
                    );
                  })}
                  {projectItems.length > 0 && <DropdownSeparator />}
                  <MenuItem
                    index={addProjectIndex}
                    label="Add Project"
                    icon={FolderPlusIcon}
                    onSelect={async () => {
                      setIsDropdownOpen(false);
                      await window.omni.launch.show("add");
                    }}
                  />
                  </Dropdown>
                </div>
                {hoveredProjectId && threadPaneStyle && typeof document !== "undefined"
                  ? createPortal(
                      <div
                        className="w-72 rounded-xl border border-border bg-surface-1 shadow-surface-5 p-2"
                        ref={threadPaneRef}
                        style={threadPaneStyle}
                      >
                        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Projects
                        </div>
                        <div className="flex flex-col gap-1">
                          {hoveredProjectThreads.length > 0 ? (
                            hoveredProjectThreads.map((thread) => (
                              <button
                                key={thread.id}
                                type="button"
                                className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                onClick={async () => {
                                  setIsDropdownOpen(false);
                                  await handleSelectThread(thread.id);
                                }}
                              >
                                <span className="size-4 shrink-0 rounded-full border border-border/70" />
                                <span className="min-w-0 truncate">{thread.title}</span>
                              </button>
                            ))
                          ) : (
                            <div className="px-2 py-3 text-[13px] text-muted-foreground">
                              No threads yet.
                            </div>
                          )}
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto min-h-0">
            {activeMessages.length === 0 && !streamingMessage ? (
              <div className="h-full flex items-center justify-center p-6">
                <h2 className="flex flex-wrap items-center justify-center gap-2 text-center text-foreground/65">
                  <span className="text-2xl font-semibold tracking-tight text-foreground/55">
                    What should we cook in
                  </span>
                  <span className="text-2xl font-semibold tracking-tight text-foreground underline underline-offset-4 decoration-border/60">
                    {activeProject?.name ?? "your project"}
                  </span>
                  <span className="text-2xl font-semibold tracking-tight text-foreground/55">?</span>
                </h2>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {activeMessages.map((message, index) => {
                  const msg = message as MessageLike;
                  const from = msg.role === "user" ? "user" : "assistant";
                  return (
                    <ChatMessage
                      key={`${from}-${index}-${(msg as { timestamp?: number }).timestamp ?? index}`}
                      from={from}
                    >
                      <MessageBody message={msg} />
                    </ChatMessage>
                  );
                })}
                {streamingMessage && (
                  <ChatMessage from="assistant">
                    <MessageBody message={streamingMessage as MessageLike} />
                  </ChatMessage>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/60 bg-surface-1 p-3">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
              {slashMatches.length > 0 && (
                <div className="rounded-lg border border-border bg-surface-2 p-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground px-1 pb-2">
                    Slash commands
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {slashMatches.slice(0, 8).map((command) => (
                      <Button
                        key={command.name}
                        variant="secondary"
                        size="sm"
                        onClick={() => applyCommand(command.name)}
                      >
                        /{command.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <InputMessage
                value={inputValue}
                onValueChange={setInputValue}
                placeholder={activeThread ? `Message ${activeThread.title}` : "Ask the agent something…"}
                onSend={handleSend}
                textareaProps={{
                  onKeyDown: (event) => {
                    if (event.key === "Escape") {
                      setInputValue("");
                    }
                  },
                }}
                leftSlot={
                  <Button variant="ghost" size="sm" onClick={abort} disabled={!snapshot?.isStreaming}>
                    <PauseIcon size={14} />
                    Stop
                  </Button>
                }
                rightSlot={
                  <Button variant="ghost" size="sm" trailingIcon={ChevronDownIcon}>
                    {modelName}
                  </Button>
                }
              />

              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{snapshot?.sessionName ?? activeThread?.title ?? "No active session"}</span>
                  <span>•</span>
                  <span>{queueCount} queued</span>
                  <span>•</span>
                  <span>{snapshot?.isStreaming ? "streaming" : "idle"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {snapshot?.stats && (
                    <>
                      <span>{snapshot.stats.userMessages} user</span>
                      <span>{snapshot.stats.assistantMessages} assistant</span>
                      <span>{snapshot.stats.tokens.total} tokens</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Tabs>
    </section>
  );
}
