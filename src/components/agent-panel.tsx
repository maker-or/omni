"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckIcon as ModelCheckIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PaperclipIcon,
  StopIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
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
import { AssistantTraceDeck } from "@/components/ui/assistant-trace-deck";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import { AgentSlashCommandMenu } from "@/components/agent-slash-command-menu";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { AgentUiRequest } from "../../contracts/agent.ts";
import { stringifyMessageContent, type MessageLike } from "@/lib/message-utils";
import {
  extractGroupedMessageImages,
  fileToPromptImage,
  partitionValidImageFiles,
  type ChatImageAttachment,
} from "@/lib/agent-message-images";
import { matchAgentCommands, mergeAgentCommands } from "@/lib/agent-commands";
import {
  OPEN_TABS_QUERY_KEY,
  useMergedProjectThreads,
  useOpenTabsQuery,
  usePrefetchRecentProjects,
  useProjectThreadsQuery,
  useRecentProjectsQuery,
} from "@/lib/thread-queries";
import type { Thread } from "../../contracts/threads.ts";
const iconButtonClass =
  "inline-flex size-6 items-center justify-center rounded-full  text-muted-foreground/60 hover:text-foreground hover:bg-hover transition-colors duration-100 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring";

function formatProviderName(provider: string): string {
  return provider
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTokenCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(0))}K`;
  return String(value);
}

function formatModelPrice(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  return `$${Number(value.toFixed(2))}/M`;
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

function MessageBody({
  messages,
  isStreaming = false,
  activeMessages = [],
}: {
  messages: MessageLike[];
  isStreaming?: boolean;
  activeMessages?: MessageLike[];
}) {
  const role = messages[0]?.role;

  if (role === "toolResult") {
    const body = messages
      .map((m) => stringifyMessageContent(m))
      .filter(Boolean)
      .join("\n\n");
    return (
      <div className="rounded-md border border-border/70 bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground">
        <div className="font-medium text-foreground/80">
          {(messages[0] as { toolName?: string }).toolName ?? "Tool result"}
        </div>
        <div className="mt-1 whitespace-pre-wrap break-words">{body || "Completed"}</div>
      </div>
    );
  }

  if (role === "assistant") {
    const allTraceParts: any[] = [];
    const allTextParts: string[] = [];

    for (const msg of messages) {
      const content = (msg as unknown as { content?: unknown }).content;
      if (typeof content === "string") {
        const body = stringifyMessageContent(msg);
        if (body.trim()) {
          allTextParts.push(body);
        }
      } else if (Array.isArray(content)) {
        const textParts = content.filter((part) => part && part.type === "text");
        const traceParts = content.filter(
          (part) => part && (part.type === "thinking" || part.type === "toolCall"),
        );

        allTraceParts.push(...traceParts);
        const textBody = textParts
          .map((part) => part.text)
          .filter(Boolean)
          .join("\n");
        if (textBody.trim()) {
          allTextParts.push(textBody);
        }
      }
    }

    const textBodyCombined = allTextParts.join("\n\n");

    return (
      <div className="space-y-3">
        {allTraceParts.length > 0 && (
          <AssistantTraceDeck
            traceParts={allTraceParts}
            isStreaming={isStreaming}
            activeMessages={activeMessages}
          />
        )}

        {textBodyCombined.trim() && (
          <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
            <Streamdown mode={isStreaming ? "streaming" : "static"}>{textBodyCombined}</Streamdown>
          </div>
        )}
      </div>
    );
  }

  const combinedBody = messages
    .map((m) => stringifyMessageContent(m))
    .filter(Boolean)
    .join("\n\n");
  return (
    <div className="whitespace-pre-wrap break-words text-[14px] leading-6">{combinedBody}</div>
  );
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
  "use no memo";
  const queryClient = useQueryClient();
  const { activeProject, loadActiveProject } = useProjectStore();
  const { threads, pagesByProject, loadProjectThreads, renameThread, addThread, deleteThread } =
    useThreadStore();
  const {
    snapshot,
    error,
    uiRequest,
    connect,
    refresh,
    sendPrompt,
    replacePrompt,
    abort,
    compact,
    switchThread,
    createThread,
    respondToUiRequest,
    setModel,
    cycleThinkingLevel,
  } = useAgentStore();
  const [projectsList, setProjectsList] = useState<
    Array<{ id: string; name: string; icon: string }>
  >([]);
  const [inputValue, setInputValue] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [streamingBehavior, setStreamingBehavior] = useState<"followUp" | "steer">("followUp");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [editState, setEditState] = useState<{
    targetEntryId: string;
    images: ChatImageAttachment[];
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<ChatImageAttachment | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [selectedModelProvider, setSelectedModelProvider] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [mountTime] = useState(() => Date.now());
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [editingThreadOriginalTitle, setEditingThreadOriginalTitle] = useState("");
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const threadPaneRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [threadPaneStyle, setThreadPaneStyle] = useState<CSSProperties | null>(null);
  const ChevronDownIcon = useIcon("chevron-down");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const CopyIcon = useIcon("copy");
  const CheckIcon = useIcon("check");
  const PencilIcon = useIcon("pencil");
  const RotateCcwIcon = useIcon("rotate-ccw");
  const openTabsQuery = useOpenTabsQuery();
  const openTabsState = openTabsQuery.data;
  const openThreads = openTabsState?.openThreads ?? [];
  const activeThreadId = openTabsState?.activeThreadId ?? null;
  const threadSwitchHistory = openTabsState?.threadSwitchHistory ?? [];
  const hoveredProjectThreadsQuery = useProjectThreadsQuery(hoveredProjectId);
  const commands = useMemo(
    () => mergeAgentCommands(snapshot?.commands ?? []),
    [snapshot?.commands],
  );
  const modelName = snapshot?.model?.name ?? "No model";
  const models = snapshot?.models ?? [];
  const recentProjectsQuery = useRecentProjectsQuery(
    activeProject?.id,
    threadSwitchHistory,
    openThreads,
  );
  usePrefetchRecentProjects(recentProjectsQuery.data ?? []);

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
        const entryId = snapshot?.messageEntryRefs[i]?.entryId;
        if (entryId && snapshot?.threadId)
          await replacePrompt({
            threadId: snapshot.threadId,
            targetUserEntryId: entryId,
            message: promptText,
            images: extractGroupedMessageImages([msg]).map(({ type, data, mimeType }) => ({
              type,
              data,
              mimeType,
            })),
          });
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

    queryClient.setQueryData<
      | {
          openThreads: Thread[];
        }
      | undefined
    >(OPEN_TABS_QUERY_KEY, (current) =>
      current
        ? {
            ...current,
            openThreads: current.openThreads.map((thread) =>
              thread.id === renamedThread.id ? renamedThread : thread,
            ),
          }
        : current,
    );
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
    if (!isModelDropdownOpen) return;
    setSelectedModelProvider(snapshot?.model?.provider ?? models[0]?.provider ?? null);
    setModelSearch("");
  }, [isModelDropdownOpen, models, snapshot?.model?.provider]);

  useEffect(() => {
    if (!hoveredProjectId) return;
    const exists = projectsList.some((project) => project.id === hoveredProjectId);
    if (!exists) {
      setHoveredProjectId(projectsList[0]?.id ?? null);
    }
  }, [hoveredProjectId, projectsList]);

  useEffect(() => {
    if (!hoveredProjectId) return;
    if (pagesByProject[hoveredProjectId]) return;
    void loadProjectThreads(hoveredProjectId, { reset: true });
  }, [hoveredProjectId, loadProjectThreads, pagesByProject]);

  useEffect(() => {
    for (const projectId of recentProjectsQuery.data ?? []) {
      if (!pagesByProject[projectId]) {
        void loadProjectThreads(projectId, { reset: true });
      }
    }
  }, [loadProjectThreads, pagesByProject, recentProjectsQuery.data]);

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
    const currentThreadId = snapshot?.threadId;
    if (currentThreadId) {
      setActiveTabId(currentThreadId);
      void window.omni.tabs.open(currentThreadId).then(() => {
        void queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      });
    } else if (activeThreadId) {
      setActiveTabId(activeThreadId);
    } else {
      setActiveTabId(null);
    }
  }, [activeThreadId, queryClient, snapshot?.threadId]);

  // Revert activeTabId if thread switching fails
  useEffect(() => {
    if (error && snapshot?.threadId) {
      setActiveTabId(snapshot.threadId);
    }
  }, [error, snapshot?.threadId]);

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
    if (openThreads.some((thread) => thread.id === editingThreadId)) return;
    cancelRenameThread();
  }, [editingThreadId, openThreads]);

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

  const snapshotThreadId = snapshot?.threadId ?? "";
  const threadId = activeTabId || snapshotThreadId;
  const isSwitchingThread = Boolean(activeTabId && activeTabId !== snapshotThreadId);
  const activeMessages = snapshot?.messages ?? [];
  const isStreaming = snapshot?.isStreaming ?? false;
  const streamingMessage = isStreaming ? (snapshot?.streamingMessage ?? null) : null;
  const slashMatches = useMemo(() => {
    const trimmed = inputValue.trimStart();
    if (!trimmed.startsWith("/")) return [];
    const query = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
    return matchAgentCommands(commands, query);
  }, [commands, inputValue]);

  interface GroupedMessageEntry {
    key: string;
    role: "user" | "assistant";
    messages: MessageLike[];
    originalIndex: number;
    isStreaming: boolean;
  }

  const allMessages = useMemo(() => {
    const rawEntries = activeMessages
      .map((message, index) => ({
        message: message as MessageLike,
        originalIndex: index,
        isStreaming: false,
      }))
      .filter(({ message }) => message.role === "user" || message.role === "assistant");

    if (streamingMessage) {
      rawEntries.push({
        message: streamingMessage as MessageLike,
        originalIndex: activeMessages.length,
        isStreaming: true,
      });
    }

    const grouped: GroupedMessageEntry[] = [];

    for (const entry of rawEntries) {
      const lastGroup = grouped[grouped.length - 1];
      const role = entry.message.role === "user" ? "user" : "assistant";

      if (lastGroup && lastGroup.role === role) {
        lastGroup.messages.push(entry.message);
        if (entry.isStreaming) {
          lastGroup.isStreaming = true;
        }
      } else {
        grouped.push({
          key: entry.isStreaming ? "streaming" : `${role}-${entry.originalIndex}`,
          role,
          messages: [entry.message],
          originalIndex: entry.originalIndex,
          isStreaming: entry.isStreaming,
        });
      }
    }

    return grouped;
  }, [activeMessages, streamingMessage]);

  const conversationVirtualizer = useVirtualizer({
    count: allMessages.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: (index) => (allMessages[index]?.role === "user" ? 96 : 180),
    getItemKey: (index) => allMessages[index]?.key ?? index,
    overscan: 6,
  });

  const latestConversationScrollKey = useMemo(() => {
    const latest = allMessages[allMessages.length - 1];
    if (!latest) return `${threadId}:empty:${isStreaming}`;

    const lastMessage = latest.messages[latest.messages.length - 1];
    return [
      threadId,
      allMessages.length,
      isStreaming ? "streaming" : "settled",
      latest.role ?? "unknown",
      stringifyMessageContent(lastMessage).length,
    ].join(":");
  }, [allMessages, isStreaming, threadId]);

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;

    const threshold = 120;
    const isNearBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <=
      threshold;

    const shouldScroll = !isStreaming || isNearBottom || allMessages.length === 0;
    if (!shouldScroll) return;

    // Cancel any in-flight animation
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }

    if (!isStreaming) {
      // Instant jump when not streaming (e.g. switching threads)
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      return;
    }

    // Spring-based smooth scroll to bottom
    const target = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    let current = scrollContainer.scrollTop;
    const stiffness = 0.12; // spring strength — higher = snappier

    function tick() {
      const el = messagesScrollRef.current;
      if (!el) return;
      const dest = el.scrollHeight - el.clientHeight;
      current += (dest - current) * stiffness;
      el.scrollTop = current;
      if (Math.abs(dest - current) > 0.5) {
        scrollRafRef.current = requestAnimationFrame(tick);
      } else {
        el.scrollTop = dest;
        scrollRafRef.current = null;
      }
    }

    // Suppress unused-variable warning from initial target calc
    void target;
    scrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [latestConversationScrollKey, isStreaming, allMessages.length]);

  const handleSelectThread = async (id: string) => {
    setActiveTabId(id);
    await window.omni.tabs.open(id);
    await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
    if (id === snapshot?.threadId) return;
    setRequestedThreadId(id);
    await switchThread(id);
    await loadActiveProject();
  };

  const handleCloseThreadTab = async (id: string) => {
    const sortedThreads = [...openThreads].sort((a, b) => a.created_at - b.created_at);
    const currentIndex = sortedThreads.findIndex((t) => t.id === id);
    const nextState = await window.omni.tabs.close(id);
    await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });

    if (id === activeTabId) {
      const remainingThreads = sortedThreads.filter((t) => t.id !== id);
      const fallbackThread =
        remainingThreads.find((thread) => thread.id === nextState.activeThreadId) ??
        remainingThreads[currentIndex] ??
        remainingThreads[currentIndex - 1] ??
        remainingThreads[remainingThreads.length - 1] ??
        null;

      if (fallbackThread) {
        await handleSelectThread(fallbackThread.id);
      } else {
        setActiveTabId(null);
        await window.omni.tabs.setActive(null);
        await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      }
    }
  };

  const handleSend = async (text: string, files: File[]) => {
    const trimmed = text.trim();
    if (!trimmed && !files.length && !editState?.images.length) return;
    const [token, ...args] = trimmed.split(/\s+/);
    if (token === "/abort" && args.length === 0) {
      await abort();
      setInputValue("");
      return;
    }
    if (token === "/compact") {
      await compact(args.join(" ") || undefined);
      setInputValue("");
      return;
    }
    const operationThreadId = snapshot?.threadId;
    setIsSubmitting(true);
    try {
      const newImages = await Promise.all(files.map(fileToPromptImage));
      const retained = (editState?.images ?? []).map(({ type, data, mimeType }) => ({
        type,
        data,
        mimeType,
      }));
      if (editState && operationThreadId)
        await replacePrompt({
          threadId: operationThreadId,
          targetUserEntryId: editState.targetEntryId,
          message: trimmed,
          images: [...retained, ...newImages],
        });
      else
        await sendPrompt({
          threadId: operationThreadId,
          message: trimmed,
          images: newImages.length ? newImages : undefined,
          streamingBehavior: isStreaming ? streamingBehavior : undefined,
        });
      if (snapshot?.threadId === operationThreadId) {
        setInputValue("");
        setAttachedFiles([]);
        setEditState(null);
      }
      setStreamingBehavior("followUp");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFilesChange = (files: File[]) => {
    const { valid, errors } = partitionValidImageFiles(files);
    setAttachedFiles(valid);
    if (errors.length)
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Attachment rejected",
        description: errors.join(" "),
      });
  };

  const handleAbort = async () => {
    if (isAborting) return;
    setIsAborting(true);
    try {
      await abort();
    } finally {
      setIsAborting(false);
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    if (thread.id === snapshot?.threadId && isStreaming) return;
    if (!window.confirm(`Permanently delete “${thread.title}” and its session history?`)) return;
    await deleteThread(thread.id);
    setIsDropdownOpen(false);
    await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ["threads", thread.project_id],
    });
    const state = await window.omni.tabs.listOpen();
    if (state.activeThreadId) await handleSelectThread(state.activeThreadId);
    else setActiveTabId(null);
  };

  const applyCommand = (commandName: string) => {
    setInputValue(`/${commandName} `);
  };

  const formatThreadRecency = (timestamp: number) => {
    const time = typeof timestamp === "number" ? timestamp : Number(timestamp);
    if (Number.isNaN(time)) return "Unknown";

    const diffMs = Math.max(0, mountTime - time);
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
    return mountTime - fallbackDaysAgo * 24 * 60 * 60 * 1000;
  };

  const handleCreateThread = async () => {
    const projectId = hoveredProjectId ?? activeProject?.id;
    if (!projectId) return;
    const project = projectsList.find((item) => item.id === projectId);
    const nextCount = threads.filter((thread) => thread.project_id === projectId).length + 1;
    const title = `${project?.name ?? "Thread"} #${nextCount}`;
    const thread = await createThread(projectId, title, snapshot?.threadId ?? null);
    addThread(thread);
    await handleSelectThread(thread.id);
  };

  const projectItems = projectsList.map((project, idx) => ({
    id: project.id,
    name: project.name,
    icon: project.icon,
    index: idx,
  }));

  const checkedIndex = projectItems.findIndex((item) => item.id === activeProject?.id);
  const addProjectIndex = projectItems.length;
  const hoveredProjectThreads = useMergedProjectThreads(
    hoveredProjectId,
    hoveredProjectThreadsQuery.data?.threads ?? [],
    threads,
  );
  const hoveredThreadPage = hoveredProjectId ? pagesByProject[hoveredProjectId] : undefined;
  const isHoveredThreadsLoading =
    hoveredProjectThreadsQuery.isLoading || Boolean(hoveredThreadPage?.isLoading);
  const hoveredThreadsHasMore =
    hoveredProjectThreadsQuery.data?.hasMore || Boolean(hoveredThreadPage?.hasMore);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, typeof models>();
    for (const model of models) {
      const group = groups.get(model.provider) ?? [];
      group.push(model);
      groups.set(model.provider, group);
    }
    return Array.from(groups.entries()).map(([provider, providerModels]) => ({
      provider,
      label: formatProviderName(provider),
      models: providerModels,
    }));
  }, [models]);
  const activeProvider =
    selectedModelProvider ?? snapshot?.model?.provider ?? modelGroups[0]?.provider;
  const visibleProviderModels = (
    modelGroups.find((group) => group.provider === activeProvider)?.models ?? []
  ).filter((model) => {
    const query = modelSearch.trim().toLowerCase();
    return (
      !query ||
      String(model.name ?? "")
        .toLowerCase()
        .includes(query) ||
      String(model.modelId ?? "")
        .toLowerCase()
        .includes(query)
    );
  });
  const currentProject = projectsList.find((p) => p.id === snapshot?.projectId) || activeProject;
  const emptyStateSubject = currentProject?.name ?? "your project";

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
      {previewImage && (
        <div
          className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/75 p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={`data:${previewImage.mimeType};base64,${previewImage.data}`}
            alt="Message attachment preview"
            className="max-h-full max-w-full object-contain"
          />
        </div>
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
            {[...openThreads]
              .sort((a, b) => a.created_at - b.created_at)
              .map((thread) => {
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
                    onClose={() => handleCloseThreadTab(thread.id)}
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
                    setHoveredProjectId(activeProject?.id ?? projectItems[0]?.id ?? null);
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
                                <div
                                  key={thread.id}
                                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                                >
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 text-left"
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
                                  </button>
                                  <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] leading-tight text-muted-foreground/75 max-sm:hidden">
                                    {recencyLabel}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Delete ${thread.title}`}
                                    disabled={thread.id === snapshot?.threadId && isStreaming}
                                    onClick={() => void handleDeleteThread(thread)}
                                    className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                                  >
                                    <TrashIcon size={14} />
                                  </button>
                                </div>
                              );
                            })
                          ) : (
                            <div className="px-2 py-3 text-[13px] text-muted-foreground">
                              {isHoveredThreadsLoading ? "Loading threads..." : "No threads yet."}
                            </div>
                          )}
                        </div>
                        {hoveredProjectId && hoveredThreadsHasMore ? (
                          <button
                            type="button"
                            className="mt-2 w-full rounded-lg px-2 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            disabled={isHoveredThreadsLoading}
                            onClick={() => {
                              void loadProjectThreads(hoveredProjectId);
                            }}
                          >
                            {isHoveredThreadsLoading ? "Loading..." : "Load more"}
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

        <div className="relative flex-1 overflow-hidden  min-h-0 flex flex-col">
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
            <div className="min-h-full ">
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
                <div
                  data-pipper-id="messages-list"
                  className="relative p-4"
                  style={{
                    height: `${conversationVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {conversationVirtualizer.getVirtualItems().map((virtualRow) => {
                    const entry = allMessages[virtualRow.index];
                    if (!entry) return null;
                    const { key, role, messages, originalIndex, isStreaming } = entry;
                    const from = role;
                    const msgId = key;
                    const bodyText = messages
                      .map((m) => stringifyMessageContent(m))
                      .filter(Boolean)
                      .join("\n\n");
                    const timeStr = isStreaming
                      ? undefined
                      : formatMessageTime(messages[messages.length - 1]);
                    const hasContent =
                      bodyText.trim() !== "" ||
                      extractGroupedMessageImages(messages).length > 0 ||
                      (from === "assistant" && messages.some((m) => getToolSummary(m) !== null));

                    const actions =
                      from === "user" ? (
                        <div data-pipper-id="user-actions-buttons">
                          <CopyButton msgId={msgId} bodyText={bodyText} />
                          <button
                            type="button"
                            aria-label="Edit message"
                            className={iconButtonClass}
                            disabled={
                              isStreaming ||
                              isSubmitting ||
                              !snapshot?.messageEntryRefs[originalIndex]
                            }
                            onClick={() => {
                              setInputValue(bodyText);
                              setAttachedFiles([]);
                              setEditState({
                                targetEntryId: snapshot!.messageEntryRefs[originalIndex]!.entryId,
                                images: extractGroupedMessageImages(messages),
                              });
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
                              disabled={
                                isSubmitting || snapshot?.isCompacting || snapshot?.isRetrying
                              }
                              onClick={() => handleRegenerate(originalIndex)}
                            >
                              <RotateCcwIcon size={13} />
                            </button>
                          )}
                        </div>
                      );

                    return (
                      <div
                        key={virtualRow.key}
                        ref={conversationVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute left-0 top-0 w-full px-4 pb-3"
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <ChatMessage from={from} time={timeStr} actions={actions}>
                          {hasContent ? (
                            <MessageBody
                              messages={messages}
                              isStreaming={isStreaming}
                              activeMessages={activeMessages}
                            />
                          ) : undefined}
                          {extractGroupedMessageImages(messages).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {extractGroupedMessageImages(messages).map((image) => (
                                <button
                                  key={image.id}
                                  type="button"
                                  onClick={() => setPreviewImage(image)}
                                >
                                  <img
                                    src={`data:${image.mimeType};base64,${image.data}`}
                                    alt="Message attachment"
                                    className="size-24 rounded-md object-cover border border-border"
                                    onLoad={() => conversationVirtualizer.measure()}
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </ChatMessage>
                      </div>
                    );
                  })}

                  {isStreaming && !streamingMessage && (
                    <div
                      className="absolute left-0 flex justify-start px-8 py-2"
                      style={{
                        top: `${conversationVirtualizer.getTotalSize()}px`,
                      }}
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
              {snapshot?.queue.steering.length || snapshot?.queue.followUp.length ? (
                <div className="rounded-lg border border-border bg-surface-2 p-2 text-xs">
                  {snapshot.queue.steering.length > 0 && (
                    <div>
                      <span className="font-medium">Steering</span>
                      {snapshot.queue.steering.map((item, index) => (
                        <div
                          key={index}
                          className="line-clamp-2 text-muted-foreground"
                          title={item}
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                  {snapshot.queue.followUp.length > 0 && (
                    <div className="mt-1">
                      <span className="font-medium">Next</span>
                      {snapshot.queue.followUp.map((item, index) => (
                        <div
                          key={index}
                          className="line-clamp-2 text-muted-foreground"
                          title={item}
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {editState && (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                  <span>Editing message · {editState.images.length} retained image(s)</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditState(null);
                      setInputValue("");
                      setAttachedFiles([]);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              <div className="relative isolate">
                <AgentSlashCommandMenu
                  commands={slashMatches}
                  selectedIndex={selectedCommandIndex}
                  onSelect={applyCommand}
                />

                <InputMessage
                  className="relative z-10"
                  textareaRef={composerTextareaRef}
                  value={inputValue}
                  onValueChange={setInputValue}
                  placeholder="Type here"
                  onSend={handleSend}
                  disabled={isSwitchingThread || isSubmitting || Boolean(editState && isStreaming)}
                  files={attachedFiles}
                  onFilesChange={handleFilesChange}
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  maxFiles={5}
                  hideSendButton={isStreaming}
                  sendLabel={isSubmitting ? "Sending" : "Send"}
                  leftSlot={({ openFilePicker }) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Attach images"
                      onClick={() => openFilePicker("image/png,image/jpeg,image/gif,image/webp")}
                    >
                      <PaperclipIcon size={15} />
                    </Button>
                  )}
                  textareaProps={{
                    onKeyDown: (event) => {
                      if (
                        slashMatches.length &&
                        (event.key === "ArrowDown" || event.key === "ArrowUp")
                      ) {
                        event.preventDefault();
                        setSelectedCommandIndex(
                          (current) =>
                            (current + (event.key === "ArrowDown" ? 1 : -1) + slashMatches.length) %
                            slashMatches.length,
                        );
                        return;
                      }
                      if (
                        slashMatches.length &&
                        (event.key === "Tab" ||
                          (event.key === "Enter" && !/\s/.test(inputValue.trimStart())))
                      ) {
                        event.preventDefault();
                        applyCommand(
                          slashMatches[selectedCommandIndex]?.name ?? slashMatches[0]!.name,
                        );
                        return;
                      }
                      if (event.key === "Escape") {
                        setSelectedCommandIndex(0);
                      }
                    },
                  }}
                  rightSlot={
                    <div ref={modelDropdownRef} className="relative flex items-center gap-1.5">
                      {isStreaming && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setStreamingBehavior((value) =>
                                value === "followUp" ? "steer" : "followUp",
                              )
                            }
                          >
                            {streamingBehavior === "followUp" ? "Next" : "Steer"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            leadingIcon={StopIcon}
                            disabled={isAborting}
                            onClick={() => void handleAbort()}
                          >
                            {isAborting ? "Stopping…" : "Stop"}
                          </Button>
                        </>
                      )}
                      {!isStreaming && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={Boolean(snapshot?.isCompacting || snapshot?.isRetrying)}
                          onClick={() => void compact()}
                        >
                          {snapshot?.isCompacting ? "Compacting…" : "Compact"}
                        </Button>
                      )}
                      {snapshot?.thinkingLevel !== undefined &&
                        snapshot?.thinkingLevel !== null && (
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
                        {snapshot?.model
                          ? `${formatProviderName(snapshot.model.provider)} · ${modelName}`
                          : modelName}
                      </Button>
                      {isModelDropdownOpen && models.length > 0 && (
                        <div
                          data-pipper-id="model-dropdown"
                          className="absolute right-0 bottom-full mb-1.5 z-[250]"
                        >
                          <div className="flex h-[420px] w-[520px] overflow-hidden rounded-xl border border-border/80 bg-surface-1 shadow-surface-5">
                            <div className="flex w-40 shrink-0 flex-col border-r border-border/70 bg-surface-2/50 p-2">
                              <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                                Providers
                              </div>
                              <div className="min-h-0 flex-1 overflow-y-auto">
                                {modelGroups.map((group) => {
                                  const isActiveProvider = group.provider === activeProvider;
                                  const hasSelectedModel =
                                    group.provider === snapshot?.model?.provider;
                                  return (
                                    <button
                                      key={group.provider}
                                      type="button"
                                      onClick={() => setSelectedModelProvider(group.provider)}
                                      className={cn(
                                        "mb-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                                        isActiveProvider
                                          ? "bg-accent text-foreground"
                                          : "text-muted-foreground hover:bg-hover hover:text-foreground",
                                      )}
                                    >
                                      <span className="truncate font-medium">{group.label}</span>
                                      <span className="flex items-center gap-1.5">
                                        <span className="text-[10px] tabular-nums opacity-50">
                                          {group.models.length}
                                        </span>
                                        {hasSelectedModel && (
                                          <span className="size-1.5 rounded-full bg-foreground" />
                                        )}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="border-b border-border/70 p-3">
                                <div className="mb-2 flex items-baseline justify-between gap-3">
                                  <div className="text-[13px] font-semibold">
                                    {formatProviderName(activeProvider ?? "Models")}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {visibleProviderModels.length} models
                                  </div>
                                </div>
                                <label className="flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-surface-2 px-2.5 text-muted-foreground focus-within:border-foreground/30 focus-within:text-foreground">
                                  <MagnifyingGlassIcon size={14} />
                                  <input
                                    value={modelSearch}
                                    onChange={(event) => setModelSearch(event.target.value)}
                                    placeholder="Search models"
                                    className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70"
                                    autoFocus
                                  />
                                </label>
                              </div>
                              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                                {visibleProviderModels.map((model) => {
                                  const isSelected =
                                    model.provider === snapshot?.model?.provider &&
                                    model.modelId === snapshot?.model?.modelId;
                                  const inputPrice = formatModelPrice(model.cost?.input);
                                  return (
                                    <button
                                      type="button"
                                      key={`${model.provider}:${model.modelId}`}
                                      className={cn(
                                        "mb-1 flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                                        isSelected
                                          ? "border-foreground/15 bg-accent text-foreground"
                                          : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-hover hover:text-foreground",
                                      )}
                                      onClick={async () => {
                                        const success = await setModel({
                                          provider: model.provider,
                                          modelId: model.modelId,
                                        });
                                        if (success) {
                                          setIsModelDropdownOpen(false);
                                        }
                                      }}
                                    >
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13px] font-medium">
                                          {model.name}
                                        </span>
                                        <span className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground/70">
                                          <span>
                                            {formatTokenCount(model.contextWindow)} context
                                          </span>
                                          {model.reasoning && <span>Reasoning</span>}
                                          {inputPrice && <span>{inputPrice} input</span>}
                                        </span>
                                      </span>
                                      <span
                                        className={cn(
                                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                                          isSelected
                                            ? "bg-foreground text-background"
                                            : "opacity-0",
                                        )}
                                      >
                                        <ModelCheckIcon size={12} weight="bold" />
                                      </span>
                                    </button>
                                  );
                                })}
                                {visibleProviderModels.length === 0 && (
                                  <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
                                    No models match “{modelSearch}”.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  }
                />
              </div>

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
