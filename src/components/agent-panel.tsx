"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PlusIcon, FolderPlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { InputMessage } from "@/components/ui/input-message";
import { ChatMessage } from "@/components/ui/chat-message";
import { useIcon } from "@/lib/icon-context";
import type { IconName } from "@/lib/icon-context";
import { useProjectStore } from "@/store/project-store";
import { useThreadStore } from "@/store/thread-store";
import { useAgentStore } from "@/store/agent-store";
import { Streamdown } from "streamdown";
import {
  ThinkingSteps,
  ThinkingStepsHeader,
  ThinkingStepsContent,
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingStepSources,
  ThinkingStepSource,
  ThinkingStepImage,
} from "@/components/ui/thinking-steps";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import { cn } from "@/lib/utils";
import type { AgentUiRequest } from "../../contracts/agent.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

type MessageLike = AgentMessage & { role?: string };

const iconButtonClass =
  "inline-flex size-6 items-center justify-center rounded-full border border-border/60 text-muted-foreground/60 hover:text-foreground hover:bg-hover transition-colors duration-100 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
    .map((part) =>
      part &&
      typeof part === "object" &&
      "type" in part &&
      (part as { type?: string; name?: string }).type === "toolCall"
        ? (part as { name?: string }).name
        : null,
    )
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!toolNames.length) return null;
  return toolNames.join(", ");
}

function getMessageKey(message: MessageLike, index: number): string {
  const meta = message as {
    id?: string;
    toolCallId?: string;
    timestamp?: number;
    created_at?: string;
  };
  const uniqueId = meta.id ?? meta.toolCallId;
  if (uniqueId) {
    return `${message.role ?? "message"}-${uniqueId}`;
  }
  const timePart = meta.timestamp ?? meta.created_at;
  if (timePart !== undefined) {
    return `${message.role ?? "message"}-${timePart}-${index}`;
  }
  return `${message.role ?? "message"}-${index}`;
}

function compactText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function getCommandSummary(command: string): {
  label: string;
  description: string;
} {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return {
      label: "Prepared an action",
      description: "Set up the next background step.",
    };
  }

  if (lower.startsWith("rg ") || lower.includes(" rg ") || lower.startsWith("grep ")) {
    return {
      label: "Searched the codebase",
      description: `Looked for matching code paths: ${compactText(normalized, 72)}`,
    };
  }

  if (
    lower.startsWith("sed ") ||
    lower.startsWith("nl ") ||
    lower.startsWith("cat ") ||
    lower.startsWith("head ") ||
    lower.startsWith("tail ")
  ) {
    return {
      label: "Read relevant files",
      description: `Opened source context to understand the current implementation.`,
    };
  }

  if (lower.startsWith("find ") || lower.startsWith("ls ") || lower.includes(" --files")) {
    return {
      label: "Inspected project structure",
      description: "Checked available files and folders before making changes.",
    };
  }

  if (lower.startsWith("npm run build") || lower.startsWith("bunx") || lower.includes(" build")) {
    return {
      label: "Validated the build",
      description: "Ran the project build to catch TypeScript or bundling issues.",
    };
  }

  if (lower.startsWith("cp ")) {
    return {
      label: "Synced the running app",
      description: "Copied the updated renderer file into the active Electron workspace.",
    };
  }

  if (lower.startsWith("git diff") || lower.startsWith("git status")) {
    return {
      label: "Reviewed local changes",
      description: "Checked the working tree to confirm the update.",
    };
  }

  return {
    label: "Ran a shell command",
    description: compactText(normalized, 96),
  };
}

function getToolActionCopy(
  toolName: string,
  args: Record<string, unknown>,
  resultText: string,
  isError?: boolean,
): { label: string; description: string; resultSummary?: string } {
  const name = toolName.toLowerCase();
  const command = typeof args.command === "string" ? args.command : "";

  let copy =
    name === "bash"
      ? getCommandSummary(command)
      : {
          label: toolName ? `Used ${toolName}` : "Ran an agent action",
          description: Object.keys(args).length
            ? compactText(
                Object.entries(args)
                  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                  .join(", "),
              )
            : "Completed a background step.",
        };

  if (name.includes("read") || name.includes("grep") || name.includes("search")) {
    copy = {
      label: "Gathered context",
      description: copy.description,
    };
  } else if (name.includes("write") || name.includes("replace") || name.includes("edit")) {
    copy = {
      label: "Updated files",
      description: "Applied the requested code changes.",
    };
  }

  if (!resultText) return copy;

  if (isError) {
    return {
      ...copy,
      resultSummary:
        "This action returned an error, so the agent used the output to adjust course.",
    };
  }

  if (resultText.includes("Success. Updated")) {
    return { ...copy, resultSummary: "Updated the target file successfully." };
  }

  if (resultText.includes("✓ built") || resultText.includes("built in")) {
    return { ...copy, resultSummary: "Build completed successfully." };
  }

  const outputLines = resultText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (outputLines.length > 0) {
    return {
      ...copy,
      resultSummary: `Returned ${outputLines.length} line${outputLines.length === 1 ? "" : "s"} of output for the agent to inspect.`,
    };
  }

  return { ...copy, resultSummary: "Completed successfully." };
}

function getTraceSummary(traceParts: any[], activeMessages: MessageLike[], isStreaming: boolean) {
  const labels: string[] = [];

  for (const part of traceParts) {
    if (part?.type === "thinking") {
      labels.push("Reasoning through the task");
      continue;
    }

    if (part?.type !== "toolCall") continue;

    const toolCallId = part.id;
    const resultMsg = activeMessages.find(
      (m) => m.role === "toolResult" && m.toolCallId === toolCallId,
    );
    const actionCopy = getToolActionCopy(
      part.name || "",
      part.arguments ?? part.args ?? {},
      resultMsg ? stringifyMessageContent(resultMsg) : "",
      resultMsg?.isError,
    );
    labels.push(actionCopy.label);
  }

  const uniqueLabels = Array.from(new Set(labels)).slice(0, 3);
  if (!uniqueLabels.length) {
    return isStreaming ? "Working in the background" : "Completed background work";
  }

  const suffix =
    labels.length > uniqueLabels.length ? ` +${labels.length - uniqueLabels.length} more` : "";
  return `${uniqueLabels.join(", ")}${suffix}`;
}

function AssistantTraceDeck({
  traceParts,
  isStreaming,
  activeMessages,
}: {
  traceParts: any[];
  isStreaming: boolean;
  activeMessages: MessageLike[];
}) {
  const [open, setOpen] = useState(isStreaming);

  useEffect(() => {
    setOpen(isStreaming);
  }, [isStreaming]);

  const traceSummary = getTraceSummary(traceParts, activeMessages, isStreaming);

  const getToolIcon = (toolName: string): IconName => {
    const name = toolName.toLowerCase();
    if (name.includes("search") || name.includes("web") || name.includes("globe")) {
      return "globe";
    }
    if (
      name.includes("file") ||
      name.includes("replace") ||
      name.includes("write") ||
      name.includes("read") ||
      name.includes("grep")
    ) {
      return "brain";
    }
    if (name.includes("check") || name.includes("complete")) {
      return "check";
    }
    return "dot";
  };

  const extractSources = (text: string): string[] => {
    const domains: string[] = [];
    const regex = /https?:\/\/([a-zA-Z0-9.-]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      let domain = match[1];
      if (domain.startsWith("www.")) {
        domain = domain.slice(4);
      }
      if (domains.length < 5 && !domains.includes(domain)) {
        domains.push(domain);
      }
    }
    return domains;
  };

  return (
    <ThinkingSteps open={open} onOpenChange={setOpen}>
      <ThinkingStepsHeader>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>Research Agent</span>
          <span className="max-w-72 truncate text-[11px] font-normal leading-tight text-muted-foreground">
            {traceSummary}
          </span>
        </span>
      </ThinkingStepsHeader>
      <ThinkingStepsContent>
        {traceParts.map((part, index) => {
          const isLast = index === traceParts.length - 1;

          if (part.type === "thinking") {
            const isPartStreaming = isStreaming && isLast;
            return (
              <ThinkingStep
                key={`thinking-${index}`}
                index={index}
                icon="brain"
                label="Thinking"
                description={part.thinking}
                status={isPartStreaming ? "active" : "complete"}
                isLast={isLast}
              >
                {isPartStreaming && <ThinkingIndicator className="mt-1" />}
              </ThinkingStep>
            );
          }

          if (part.type === "toolCall") {
            const toolCallId = part.id;
            const toolName = part.name || "";
            const args = part.arguments ?? part.args ?? {};

            const resultMsg = activeMessages.find(
              (m) => m.role === "toolResult" && m.toolCallId === toolCallId,
            );

            const isPartStreaming = isStreaming && isLast && !resultMsg;

            let status: "active" | "complete" | "pending" = "complete";
            if (isPartStreaming) {
              status = "active";
            } else if (!resultMsg && !isStreaming) {
              status = "complete";
            }

            const stepLabel = toolName;
            let stepDescription = "";
            if (toolName === "bash") {
              stepDescription = args.command || "";
            } else {
              const keys = Object.keys(args);
              if (keys.length > 0) {
                stepDescription = keys.map((k) => `${k}: ${JSON.stringify(args[k])}`).join(", ");
              }
            }

            const iconName = getToolIcon(toolName);

            let sources: string[] = [];
            let imageSrc = "";
            let imageCaption = "";
            let detailsSummary = "";
            let detailsLinesArray: string[] = [];
            let resultText = "";
            let isError = false;

            if (resultMsg) {
              resultText = stringifyMessageContent(resultMsg);
              isError = Boolean(resultMsg.isError);

              if (
                toolName.includes("search") ||
                toolName.includes("web") ||
                toolName.includes("globe")
              ) {
                sources = extractSources(resultText);
              }

              if (
                toolName.includes("screenshot") ||
                toolName.includes("image") ||
                toolName.includes("layout")
              ) {
                const imageMatch = resultText.match(/data:image\/[a-zA-Z]+;base64,[^\s]+/);
                if (imageMatch) {
                  imageSrc = imageMatch[0];
                  imageCaption = "Screenshot output";
                } else {
                  const pathMatch = resultText.match(
                    /(?:[a-zA-Z]:)?[\w/.-]+\.(?:png|jpg|jpeg|gif)/,
                  );
                  if (pathMatch) {
                    imageSrc = pathMatch[0];
                    imageCaption = "Preview Image";
                  }
                }
              }

              if (
                toolName.includes("file") ||
                toolName.includes("replace") ||
                toolName.includes("write") ||
                toolName.includes("read") ||
                toolName.includes("grep")
              ) {
                detailsSummary = `${toolName} execution details`;
                detailsLinesArray = resultText
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .slice(0, 10);
              }
            }

            const actionCopy = getToolActionCopy(toolName, args, resultText, isError);
            const actionDescription = [actionCopy.description, actionCopy.resultSummary]
              .filter(Boolean)
              .join(" ");

            return (
              <ThinkingStep
                key={`tool-${toolCallId || index}`}
                index={index}
                icon={iconName}
                label={actionCopy.label || stepLabel}
                description={actionDescription || stepDescription}
                status={status}
                isLast={isLast}
              >
                {sources.length > 0 && (
                  <ThinkingStepSources>
                    {sources.map((src, sIdx) => (
                      <ThinkingStepSource key={sIdx}>{src}</ThinkingStepSource>
                    ))}
                  </ThinkingStepSources>
                )}

                {imageSrc && <ThinkingStepImage src={imageSrc} caption={imageCaption} />}

                {detailsLinesArray.length > 0 && (
                  <ThinkingStepDetails
                    summary={detailsSummary || "Details"}
                    details={detailsLinesArray}
                  />
                )}

                {resultMsg && toolName === "bash" && (
                  <div className="mt-1.5 rounded bg-black/95 p-2 font-mono text-[11px] text-zinc-100 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {resultText}
                  </div>
                )}

                {resultMsg?.isError && (
                  <div className="mt-1.5 text-red-500 text-[12px] font-medium leading-snug">
                    Error: {resultText}
                  </div>
                )}

                {isPartStreaming && <ThinkingIndicator className="mt-1" />}
              </ThinkingStep>
            );
          }

          return null;
        })}
      </ThinkingStepsContent>
    </ThinkingSteps>
  );
}

function MessageBody({
  message,
  isStreaming = false,
  activeMessages = [],
}: {
  message: MessageLike;
  isStreaming?: boolean;
  activeMessages?: MessageLike[];
}) {
  const role = message.role;
  const body = stringifyMessageContent(message);

  if (role === "toolResult") {
    return (
      <div className="rounded-md border border-border/70 bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground">
        <div className="font-medium text-foreground/80">
          {(message as { toolName?: string }).toolName ?? "Tool result"}
        </div>
        <div className="mt-1 whitespace-pre-wrap break-words">{body || "Completed"}</div>
      </div>
    );
  }

  if (role === "assistant") {
    const content = (message as unknown as { content?: unknown }).content;

    if (typeof content === "string") {
      return (
        <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
          {body ? <Streamdown mode={isStreaming ? "streaming" : "static"}>{body}</Streamdown> : " "}
        </div>
      );
    }

    if (Array.isArray(content)) {
      const textParts = content.filter((part) => part && part.type === "text");
      const traceParts = content.filter(
        (part) => part && (part.type === "thinking" || part.type === "toolCall"),
      );

      const textBody = textParts
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n");

      return (
        <div className="space-y-3">
          {traceParts.length > 0 && (
            <AssistantTraceDeck
              traceParts={traceParts}
              isStreaming={isStreaming}
              activeMessages={activeMessages}
            />
          )}

          {textBody.trim() && (
            <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
              <Streamdown mode={isStreaming ? "streaming" : "static"}>{textBody}</Streamdown>
            </div>
          )}
        </div>
      );
    }
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
  const [text, setText] = useState(() => ("prefill" in request ? (request.prefill ?? "") : ""));
  useEffect(() => {
    setText("prefill" in request ? (request.prefill ?? "") : "");
  }, [request]);

  if (request.kind === "select") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-4 shadow-surface-6">
          <div className="text-sm font-medium text-foreground">{request.title}</div>
          {request.message && (
            <div className="mt-2 text-sm text-muted-foreground">{request.message}</div>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {request.options.map((option) => (
              <Button
                key={option}
                variant="secondary"
                className={`justify-start `}
                onClick={() => onClose(option)}
              >
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
  const { threads, pagesByProject, loadProjectThreads, renameThread } = useThreadStore();
  const {
    snapshot,
    error,
    uiRequest,
    connect,
    refresh,
    sendPrompt,
    switchThread,
    createThread,
    respondToUiRequest,
    setModel,
    cycleThinkingLevel,
    setThinkingLevel,
  } = useAgentStore();
  const [projectsList, setProjectsList] = useState<
    Array<{ id: string; name: string; icon: string }>
  >([]);
  const [inputValue, setInputValue] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [editingThreadOriginalTitle, setEditingThreadOriginalTitle] = useState("");
  const [openThreadIds, setOpenThreadIds] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const threadPaneRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [threadPaneStyle, setThreadPaneStyle] = useState<CSSProperties | null>(null);
  const ChevronDownIcon = useIcon("chevron-down");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const CopyIcon = useIcon("copy");
  const CheckIcon = useIcon("check");
  const PencilIcon = useIcon("pencil");
  const RotateCcwIcon = useIcon("rotate-ccw");
  const hasInitializedOpenThreadTabs = useRef(false);

  function CopyButton({ msgId, bodyText }: { msgId: string; bodyText: string }) {
    const isCopied = copiedMessageId === msgId;
    return (
      <button
        type="button"
        aria-label="Copy message"
        className={iconButtonClass}
        onClick={() => handleCopy(msgId, bodyText)}
      >
        {isCopied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
    );
  }

  const formatMessageTime = (message: MessageLike): string | undefined => {
    const meta = message as { timestamp?: number; created_at?: string };
    const timeVal = meta.timestamp ?? (meta.created_at ? Date.parse(meta.created_at) : null);
    if (!timeVal) return undefined;
    const date = new Date(timeVal);
    if (isNaN(date.getTime())) return undefined;
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const handleCopy = (msgId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(msgId);
    setTimeout(() => {
      setCopiedMessageId((prev) => (prev === msgId ? null : prev));
    }, 2000);
  };

  const handleRegenerate = async (currentIndex: number) => {
    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = activeMessages[i] as MessageLike;
      if (msg.role === "user") {
        const promptText = stringifyMessageContent(msg);
        if (promptText) {
          await sendPrompt({
            threadId: snapshot?.threadId ?? undefined,
            message: promptText,
          });
        }
        break;
      }
    }
  };

  const startRenameThread = (threadId: string, title: string) => {
    setEditingThreadId(threadId);
    setEditingThreadTitle(title);
    setEditingThreadOriginalTitle(title);
  };

  const cancelRenameThread = () => {
    setEditingThreadId(null);
    setEditingThreadTitle("");
    setEditingThreadOriginalTitle("");
  };

  const commitRenameThread = async () => {
    if (!editingThreadId) return false;

    const nextTitle = editingThreadTitle.trim();
    const originalTitle = editingThreadOriginalTitle.trim();

    if (!nextTitle || nextTitle === originalTitle) {
      cancelRenameThread();
      return true;
    }

    const renamedThread = await renameThread(editingThreadId, nextTitle);
    if (!renamedThread) {
      return false;
    }

    cancelRenameThread();
    return true;
  };

  useEffect(() => {
    void connect();
  }, [connect]);

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
    if (isDropdownOpen) {
      setIsModelDropdownOpen(false);
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
    if (!activeProject?.id) return;
    void loadProjectThreads(activeProject.id, { reset: true });
  }, [activeProject?.id, loadProjectThreads]);

  useEffect(() => {
    if (!hoveredProjectId) return;
    if (pagesByProject[hoveredProjectId]) return;
    void loadProjectThreads(hoveredProjectId, { reset: true });
  }, [hoveredProjectId, loadProjectThreads, pagesByProject]);

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
    if (requestedThreadId && snapshot?.threadId === requestedThreadId) {
      setRequestedThreadId(null);
    }
  }, [requestedThreadId, snapshot?.threadId]);

  useEffect(() => {
    if (requestedThreadId && error) {
      setRequestedThreadId(null);
    }
  }, [error, requestedThreadId]);

  useEffect(() => {
    if (!editingThreadId) return;
    if (threads.some((thread) => thread.id === editingThreadId)) return;
    cancelRenameThread();
  }, [editingThreadId, threads]);

  useEffect(() => {
    const threadIds = new Set(threads.map((thread) => thread.id));
    setOpenThreadIds((current) => {
      const filtered = current.filter((id) => threadIds.has(id));
      return filtered.length === current.length ? current : filtered;
    });
  }, [threads]);

  useEffect(() => {
    if (hasInitializedOpenThreadTabs.current) return;
    const currentThreadId = snapshot?.threadId;
    if (!currentThreadId) return;
    if (!threads.some((thread) => thread.id === currentThreadId)) return;
    hasInitializedOpenThreadTabs.current = true;
    setOpenThreadIds([currentThreadId]);
  }, [snapshot?.threadId, threads]);

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
        if (threadPaneRef.current?.contains(target)) return;
        setIsDropdownOpen(false);
      }
      if (
        isModelDropdownOpen &&
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(target)
      ) {
        setIsModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen, isModelDropdownOpen]);

  const commands = snapshot?.commands ?? [];
  const modelName = snapshot?.model?.name ?? "No model";
  const models = snapshot?.models ?? [];
  const snapshotThreadId = snapshot?.threadId ?? "";
  const threadId = snapshotThreadId;
  const isSwitchingThread = Boolean(requestedThreadId && requestedThreadId !== snapshotThreadId);
  const activeMessages = snapshot?.messages ?? [];
  const isStreaming = snapshot?.isStreaming ?? false;
  const streamingMessage = isStreaming ? (snapshot?.streamingMessage ?? null) : null;
  const queueCount =
    (snapshot?.queue.steering.length ?? 0) + (snapshot?.queue.followUp.length ?? 0);
  const slashMatches = useMemo(() => {
    const trimmed = inputValue.trimStart();
    if (!trimmed.startsWith("/")) return [];
    const query = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
    return commands.filter((command) => command.name.toLowerCase().includes(query));
  }, [commands, inputValue]);

  const allMessages = useMemo(() => {
    const entries = activeMessages
      .map((message, index) => ({
        message: message as MessageLike,
        originalIndex: index,
        isStreaming: false,
      }))
      .filter(({ message }) => message.role === "user" || message.role === "assistant");
    if (streamingMessage) {
      entries.push({
        message: streamingMessage as MessageLike,
        originalIndex: activeMessages.length,
        isStreaming: true,
      });
    }
    return entries;
  }, [activeMessages, streamingMessage]);

  const latestConversationScrollKey = useMemo(() => {
    const latest = allMessages[allMessages.length - 1];
    if (!latest) return `${threadId}:empty:${isStreaming}`;

    return [
      threadId,
      allMessages.length,
      isStreaming ? "streaming" : "settled",
      latest.message.role ?? "unknown",
      stringifyMessageContent(latest.message).length,
    ].join(":");
  }, [allMessages, isStreaming, threadId]);

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;

    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [latestConversationScrollKey]);

  const visibleThreads = useMemo(
    () => threads.filter((thread) => openThreadIds.includes(thread.id)),
    [openThreadIds, threads],
  );

  const openThreadTab = (threadId: string) => {
    setOpenThreadIds((current) => (current.includes(threadId) ? current : [...current, threadId]));
  };

  const closeThreadTab = (threadId: string) => {
    const currentVisibleThreads = visibleThreads;
    const currentIndex = currentVisibleThreads.findIndex((thread) => thread.id === threadId);
    const currentOpenIds = openThreadIds;
    const nextOpenIds = currentOpenIds.filter((id) => id !== threadId);

    setOpenThreadIds(nextOpenIds);

    if (currentIndex === -1) return;

    if (threadId === snapshot?.threadId) {
      const nextVisibleThreads = threads.filter((thread) => nextOpenIds.includes(thread.id));
      const fallbackThread =
        nextVisibleThreads[currentIndex] ??
        nextVisibleThreads[currentIndex - 1] ??
        nextVisibleThreads[nextVisibleThreads.length - 1] ??
        null;

      if (fallbackThread && fallbackThread.id !== snapshot?.threadId) {
        setRequestedThreadId(fallbackThread.id);
        void switchThread(fallbackThread.id);
      }
    }
  };

  const handleSelectThread = (id: string) => {
    openThreadTab(id);
    if (id === threadId && !isSwitchingThread) return;
    setRequestedThreadId(id);
    void switchThread(id);
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

  const formatThreadRecency = (timestamp: number) => {
    const time = typeof timestamp === "number" ? timestamp : Number(timestamp);
    if (Number.isNaN(time)) return "Unknown";

    const diffMs = Math.max(0, Date.now() - time);
    if (diffMs < 60 * 60 * 1000) return "Recently opened";

    const days = Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
    if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;

    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;

    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? "year" : "years"} ago`;
  };

  const getThreadRecencyTime = (
    thread: {
      id: string;
      last_used_at?: number | null;
      created_at?: number | null;
    },
    index: number,
  ) => {
    const lastUsed = Number(thread.last_used_at);
    if (Number.isFinite(lastUsed) && lastUsed > 0) return lastUsed;

    const created = Number(thread.created_at);
    if (Number.isFinite(created) && created > 0) return created;

    const idSeed = Array.from(thread.id).reduce((total, char) => total + char.charCodeAt(0), 0);
    const fallbackDaysAgo = ((idSeed + index) % 6) + 1;
    return Date.now() - fallbackDaysAgo * 24 * 60 * 60 * 1000;
  };

  const handleCreateThread = async () => {
    const projectId = hoveredProjectId ?? activeProject?.id;
    if (!projectId) return;
    const project = projectsList.find((item) => item.id === projectId);
    const thread = await createThread(
      projectId,
      project?.name ?? "Thread",
      snapshot?.threadId ?? null,
    );
    openThreadTab(thread.id);
    setRequestedThreadId(thread.id);
    await loadProjectThreads(projectId, { reset: true });
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
    ? threads
        .filter((thread) => thread.project_id === hoveredProjectId)
        .sort((a, b) => b.last_used_at - a.last_used_at || b.created_at - a.created_at)
    : [];
  const hoveredThreadPage = hoveredProjectId ? pagesByProject[hoveredProjectId] : undefined;
  const activeModelIndex = models.findIndex(
    (model) =>
      model.provider === snapshot?.model?.provider && model.modelId === snapshot?.model?.modelId,
  );
  const activeThread = threads.find((thread) => thread.id === threadId) ?? null;
  const emptyStateSubject = activeProject?.name ?? "your project";

  return (
    <section
      data-pipper-id="agent-panel"
      className="relative z-20 h-full w-full flex flex-col bg-surface-1  overflow-visible"
    >
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

      <Tabs
        value={threadId}
        onValueChange={handleSelectThread}
        className="flex-1 flex flex-col min-h-0"
      >
        <div
          className="h-11 flex items-center justify-between px-4 select-none shrink-0 bg-surface-1"
          data-pipper-id="thread-tabs-container"
        >
          <TabsList
            data-pipper-id="thread-tabs"
            className="p-1 gap-1 overflow-x-auto max-w-[calc(100%-40px)]"
          >
            {visibleThreads.map((thread) => {
              const project = projectsList.find((item) => item.id === thread.project_id);
              const Icon = project
                ? (((props: { className?: string }) => (
                    <ProjectIcon name={project.icon} className={props.className} />
                  )) as any)
                : undefined;
              const isEditing = editingThreadId === thread.id;
              return (
                <TabItem
                  key={thread.id}
                  value={thread.id}
                  label={thread.title}
                  icon={Icon}
                  onClose={() => closeThreadTab(thread.id)}
                  editing={isEditing}
                  editValue={isEditing ? editingThreadTitle : thread.title}
                  onEditValueChange={setEditingThreadTitle}
                  onEditCommit={commitRenameThread}
                  onEditCancel={cancelRenameThread}
                  onDoubleClick={() => startRenameThread(thread.id, thread.title)}
                />
              );
            })}
          </TabsList>

          <div className="relative">
            <Button
              data-pipper-id="add-thread-button"
              ref={buttonRef}
              variant="ghost"
              size="icon-sm"
              active={isDropdownOpen}
              onClick={() =>
                setIsDropdownOpen((prev) => {
                  const next = !prev;
                  if (next) {
                    setHoveredProjectId(null);
                    setIsModelDropdownOpen(false);
                  }
                  return next;
                })
              }
            >
              <PlusIcon size={16} />
            </Button>

            {isDropdownOpen && (
              <div
                data-pipper-id="project-dropdown"
                ref={dropdownRef}
                className="absolute right-0 top-full mt-1.5 z-[200]"
              >
                <div ref={projectListRef} className="relative">
                  <Dropdown checkedIndex={checkedIndex} className="w-72 max-h-[300px]">
                    {projectItems.map((item) => {
                      const project = projectsList.find((p) => p.id === item.id);
                      const ProjectIconItem = project
                        ? (((props: { className?: string }) => (
                            <ProjectIcon name={project.icon} className={props.className} />
                          )) as any)
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
                        data-pipper-id="thread-pane"
                        className="w-80 rounded-xl border border-border bg-surface-1 shadow-surface-5 p-2"
                        ref={threadPaneRef}
                        style={threadPaneStyle}
                      >
                        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Threads
                        </div>
                        <div className="flex flex-col gap-1">
                          {hoveredProjectThreads.length > 0 ? (
                            hoveredProjectThreads.map((thread, index) => {
                              const isActive = thread.id === threadId;
                              const recencyLabel = formatThreadRecency(
                                getThreadRecencyTime(thread, index),
                              );
                              return (
                                <button
                                  key={thread.id}
                                  type="button"
                                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                                  onClick={async () => {
                                    setIsDropdownOpen(false);
                                    await handleSelectThread(thread.id);
                                  }}
                                >
                                  <span
                                    className={
                                      isActive
                                        ? "min-w-0 flex-1 truncate text-[13px] text-foreground font-medium"
                                        : "min-w-0 flex-1 truncate text-[13px] text-muted-foreground hover:text-foreground"
                                    }
                                  >
                                    {thread.title}
                                  </span>
                                  <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] leading-tight text-muted-foreground/75 max-sm:hidden">
                                    {recencyLabel}
                                  </span>
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-2 py-3 text-[13px] text-muted-foreground">
                              {hoveredThreadPage?.isLoading
                                ? "Loading threads..."
                                : "No threads yet."}
                            </div>
                          )}
                        </div>
                        {hoveredProjectId && hoveredThreadPage?.hasMore ? (
                          <button
                            type="button"
                            className="mt-2 w-full rounded-lg px-2 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            disabled={hoveredThreadPage.isLoading}
                            onClick={() => {
                              void loadProjectThreads(hoveredProjectId);
                            }}
                          >
                            {hoveredThreadPage.isLoading ? "Loading..." : "Load more"}
                          </button>
                        ) : null}
                        <div className="mt-2 pt-2 border-t border-border/60">
                          <Button
                            type="button"
                            variant="ghost"
                            className="w-full justify-center"
                            leadingIcon={PlusIcon}
                            onClick={async () => {
                              setIsDropdownOpen(false);
                              await handleCreateThread();
                            }}
                          >
                            Create new thread
                          </Button>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}
              </div>
            )}
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden min-h-0 flex flex-col">
          {allMessages.length === 0 && (
            <AmbientPixelField
              pixelSize={6}
              gap={4}
              intensity={0.65}
              fadeStart={0.5}
              animated={true}
              className="absolute inset-0 z-0 pointer-events-none"
            />
          )}
          <div
            ref={messagesScrollRef}
            className="relative flex-1 overflow-y-auto min-h-0 z-10"
            aria-busy={isSwitchingThread}
          >
            <div className="min-h-full">
              {allMessages.length === 0 ? (
                <div
                  data-pipper-id="empty-state"
                  className="h-full min-h-[280px] flex items-center justify-center p-6 select-none"
                >
                  <h2 className="relative z-10 flex flex-wrap items-center justify-center gap-2 text-center text-foreground/65 pointer-events-none">
                    <span className="text-2xl font-semibold tracking-tight text-foreground/55">
                      What should we cook in
                    </span>
                    <span className="text-2xl font-semibold tracking-tight text-foreground underline underline-offset-4 decoration-border/60">
                      {emptyStateSubject}
                    </span>
                  </h2>
                </div>
              ) : (
                <div data-pipper-id="messages-list" className="flex flex-col gap-3 p-4">
                  {allMessages.map(({ message, originalIndex, isStreaming }) => {
                    const msg = message as MessageLike;
                    const from = msg.role === "user" ? "user" : "assistant";
                    const msgId = isStreaming ? "streaming" : getMessageKey(msg, originalIndex);
                    const bodyText = stringifyMessageContent(msg);
                    const timeStr = isStreaming ? undefined : formatMessageTime(msg);
                    const hasContent =
                      bodyText.trim() !== "" ||
                      (from === "assistant" && getToolSummary(msg) !== null);

                    const actions =
                      from === "user" ? (
                        <div data-pipper-id="user-actions-buttons">
                          <CopyButton msgId={msgId} bodyText={bodyText} />
                          <button
                            type="button"
                            aria-label="Edit message"
                            className={iconButtonClass}
                            onClick={() => {
                              setInputValue(bodyText);
                              if (composerTextareaRef.current) {
                                composerTextareaRef.current.focus();
                              }
                            }}
                          >
                            <PencilIcon size={13} />
                          </button>
                        </div>
                      ) : (
                        <div data-pipper-id="agent-actions-buttons">
                          <CopyButton msgId={msgId} bodyText={bodyText} />
                          {!isStreaming && (
                            <button
                              type="button"
                              aria-label="Regenerate response"
                              className={iconButtonClass}
                              onClick={() => handleRegenerate(originalIndex)}
                            >
                              <RotateCcwIcon size={13} />
                            </button>
                          )}
                        </div>
                      );

                    return (
                      <ChatMessage key={msgId} from={from} time={timeStr} actions={actions}>
                        {hasContent ? (
                          <MessageBody
                            message={msg}
                            isStreaming={isStreaming}
                            activeMessages={activeMessages}
                          />
                        ) : undefined}
                      </ChatMessage>
                    );
                  })}

                  {isStreaming && !streamingMessage && (
                    <div
                      className="flex justify-start px-4 py-2"
                      data-pipper-id="Thinking-indicator"
                    >
                      <ThinkingIndicator />
                    </div>
                  )}
                  <div ref={messagesEndRef} aria-hidden="true" />
                </div>
              )}
            </div>
          </div>

          <div
            data-pipper-id="input-area"
            className={cn(
              "relative z-10 p-3 transition-colors duration-300",
              allMessages.length === 0 ? "bg-transparent" : "bg-surface-1",
            )}
          >
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
              {slashMatches.length > 0 && (
                <div
                  data-pipper-id="slash-commands"
                  className="rounded-lg border border-border bg-surface-2 p-2"
                >
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
                textareaRef={composerTextareaRef}
                value={inputValue}
                onValueChange={setInputValue}
                placeholder="Type here"
                onSend={handleSend}
                disabled={isSwitchingThread}
                textareaProps={{
                  onKeyDown: (event) => {
                    if (event.key === "Escape") {
                      setInputValue("");
                    }
                  },
                }}
                rightSlot={
                  <div ref={modelDropdownRef} className="relative flex items-center gap-1.5">
                    {snapshot?.thinkingLevel !== undefined && snapshot?.thinkingLevel !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await cycleThinkingLevel();
                        }}
                      >
                        Reasoning: {snapshot.thinkingLevel}
                      </Button>
                    )}
                    <Button
                      data-pipper-id="model-selector"
                      variant="ghost"
                      size="sm"
                      trailingIcon={ChevronDownIcon}
                      active={isModelDropdownOpen}
                      disabled={models.length === 0}
                      onClick={() => {
                        setIsDropdownOpen(false);
                        setIsModelDropdownOpen((prev) => !prev);
                      }}
                    >
                      {modelName}
                    </Button>
                    {isModelDropdownOpen && models.length > 0 && (
                      <div
                        data-pipper-id="model-dropdown"
                        className="absolute right-0 bottom-full mb-1.5 z-[250]"
                      >
                        <Dropdown
                          checkedIndex={activeModelIndex >= 0 ? activeModelIndex : undefined}
                          className="w-72 max-h-[300px]"
                        >
                          {models.map((model, index) => (
                            <MenuItem
                              key={`${model.provider}:${model.modelId}`}
                              index={index}
                              label={model.name}
                              checked={
                                model.provider === snapshot?.model?.provider &&
                                model.modelId === snapshot?.model?.modelId
                              }
                              onSelect={async () => {
                                const success = await setModel({
                                  provider: model.provider,
                                  modelId: model.modelId,
                                });
                                if (success) {
                                  setIsModelDropdownOpen(false);
                                }
                              }}
                            />
                          ))}
                        </Dropdown>
                      </div>
                    )}
                  </div>
                }
              />

              <div
                data-pipper-id="stats-bar"
                className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
              >
                <div className="flex flex-wrap items-center gap-2"></div>
                <div className="flex flex-wrap items-center gap-2">
                  {snapshot?.stats && (
                    <div className="flex items-center gap-2">
                      <span>{snapshot.stats.tokens.total} tks</span>
                      {snapshot.stats.cost > 0 && (
                        <span className="opacity-70">(${snapshot.stats.cost.toFixed(4)})</span>
                      )}
                    </div>
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
