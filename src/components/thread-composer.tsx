"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import { MentionPopover, mentionChipClass, type MentionItem } from "@/components/mention-popover";
import { cn } from "@/lib/utils";
import type {
  ComposerContent,
  ComposerEntityToken,
  ComposerMentionKind,
} from "../../contracts/composer.ts";
import {
  allowedMentionKinds,
  buildContent,
  extractTextContent,
  findActiveMention,
  getEntityTokens,
  getFreeText,
  mentionPlaceholderHint,
  removeEntityKind,
  removeMentionFromText,
  resolveDefaultMentionKind,
  setFreeText,
  upsertEntity,
} from "@/lib/composer-tokens";

export type ThreadComposerMode = "draft" | "live";

export type ThreadComposerProps = {
  mode: ThreadComposerMode;
  content: ComposerContent;
  onContentChange: (content: ComposerContent) => void;
  onSend: (content: ComposerContent, files: File[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  isStopping?: boolean;
  isSubmitting?: boolean;
  placeholder?: string;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  onFilesRejected?: (files: File[], reason: "type" | "limit") => void;
  maxFiles?: number;
  showImageAttach?: boolean;
  /** Project mention items (draft). */
  projects?: MentionItem[];
  /** Agent mention items (draft). */
  agents?: MentionItem[];
  /** Model mention items (draft optional / live switch). */
  models?: MentionItem[];
  /** Project file paths for `@file` (inserted as text, not chips). */
  projectFiles?: MentionItem[];
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  leftSlotExtra?: React.ReactNode;
  /** Additional bottom-right controls before send. */
  rightSlotExtra?: React.ReactNode;
  /** Extra key handling after mention keys are processed. */
  onTextareaKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
};

export function ThreadComposer({
  mode,
  content,
  onContentChange,
  onSend,
  disabled = false,
  isStreaming = false,
  onStop,
  isStopping = false,
  isSubmitting = false,
  placeholder,
  files = [],
  onFilesChange,
  onFilesRejected,
  maxFiles,
  showImageAttach = false,
  projects = [],
  agents = [],
  models = [],
  projectFiles = [],
  className,
  textareaRef: externalTextareaRef,
  leftSlotExtra,
  rightSlotExtra,
  onTextareaKeyDown,
}: ThreadComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef ?? internalRef;
  const entities = useMemo(() => getEntityTokens(content), [content]);
  const freeText = useMemo(() => getFreeText(content), [content]);

  const filesAvailable = projectFiles.length > 0 || mode === "live" || mode === "draft";
  const kinds = useMemo(
    () => allowedMentionKinds(mode, { filesAvailable }),
    [mode, filesAvailable],
  );
  const availability = useMemo(
    () => ({
      project: projects.length,
      agent: agents.length,
      model: models.length,
      file: projectFiles.length,
    }),
    [projects.length, agents.length, models.length, projectFiles.length],
  );

  const [mentionKind, setMentionKind] = useState<ComposerMentionKind>(() =>
    resolveDefaultMentionKind({ mode, content, filesAvailable, availability }),
  );
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  /** When user picks a tab, stick to it until the popover closes. */
  const stickyKindRef = useRef<ComposerMentionKind | null>(null);

  const itemSource = useMemo(() => {
    if (mentionKind === "project") return projects;
    if (mentionKind === "agent") return agents;
    if (mentionKind === "model") return models;
    return projectFiles;
  }, [mentionKind, projects, agents, models, projectFiles]);

  const filteredItems = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return itemSource.slice(0, 80);
    return itemSource
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          (item.description?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 80);
  }, [itemSource, mentionQuery]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionKind, filteredItems.length]);

  const updateAnchor = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setAnchorRect(null);
      return;
    }
    setAnchorRect(el.getBoundingClientRect());
  }, [textareaRef]);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setAnchorRect(null);
    stickyKindRef.current = null;
  }, []);

  const resolveKindForQuery = useCallback(
    (query: string) =>
      resolveDefaultMentionKind({
        mode,
        content,
        filesAvailable,
        query,
        preferredKind: stickyKindRef.current,
        availability,
      }),
    [mode, content, filesAvailable, availability],
  );

  const syncMentionFromText = useCallback(
    (text: string, cursor: number) => {
      const mention = findActiveMention(text, cursor);
      if (!mention) {
        closeMention();
        return;
      }
      const nextKind = resolveKindForQuery(mention.query);
      setMentionKind(nextKind);
      setMentionOpen(true);
      setMentionQuery(mention.query);
      updateAnchor();
    },
    [closeMention, resolveKindForQuery, updateAnchor],
  );

  const handleValueChange = useCallback(
    (next: string) => {
      onContentChange(setFreeText(content, next));
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? next.length;
      requestAnimationFrame(() => {
        const liveCursor = textareaRef.current?.selectionStart ?? cursor;
        syncMentionFromText(next, liveCursor);
      });
    },
    [content, onContentChange, syncMentionFromText, textareaRef],
  );

  const handleKindChange = useCallback((kind: ComposerMentionKind) => {
    stickyKindRef.current = kind;
    setMentionKind(kind);
    setMentionIndex(0);
  }, []);

  const pickItem = useCallback(
    (item: MentionItem) => {
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? freeText.length;
      const mention = findActiveMention(freeText, cursor);
      let nextText = freeText;
      if (mention) {
        nextText = removeMentionFromText(freeText, mention);
      }

      // Files insert as plain `@path` text (agent-readable), not control chips.
      if (mentionKind === "file") {
        const insertAt = mention?.atIndex ?? nextText.length;
        const insertion = `@${item.label} `;
        nextText = `${nextText.slice(0, insertAt)}${insertion}${nextText.slice(insertAt)}`;
        onContentChange(setFreeText(content, nextText));
        closeMention();
        requestAnimationFrame(() => {
          const caret = insertAt + insertion.length;
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(caret, caret);
        });
        return;
      }

      let entity: ComposerEntityToken;
      if (mentionKind === "project") {
        entity = { kind: "project", id: item.id, label: item.label };
      } else if (mentionKind === "agent") {
        entity = { kind: "agent", id: item.id, label: item.label };
      } else {
        entity = {
          kind: "model",
          id: item.id,
          label: item.label,
          agentId: item.agentId,
        };
      }
      const withEntity = upsertEntity(setFreeText(content, nextText), entity);
      onContentChange(withEntity);
      closeMention();
      requestAnimationFrame(() => {
        const caret = Math.min(mention?.atIndex ?? nextText.length, nextText.length);
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(caret, caret);
      });
    },
    [closeMention, content, freeText, mentionKind, onContentChange, textareaRef],
  );

  const removeChip = useCallback(
    (kind: ComposerEntityToken["kind"]) => {
      onContentChange(removeEntityKind(content, kind));
    },
    [content, onContentChange],
  );

  const handleSend = useCallback(
    (_value: string, sendFiles: File[]) => {
      if (disabled || isSubmitting) return;
      onSend(content, sendFiles);
    },
    [content, disabled, isSubmitting, onSend],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen && filteredItems.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setMentionIndex(
            (current) => (current + delta + filteredItems.length) % filteredItems.length,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const item = filteredItems[mentionIndex] ?? filteredItems[0];
          if (item) pickItem(item);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeMention();
          return;
        }
      }
      onTextareaKeyDown?.(event);
    },
    [closeMention, filteredItems, mentionIndex, mentionOpen, onTextareaKeyDown, pickItem],
  );

  const resolvedPlaceholder = placeholder ?? mentionPlaceholderHint(mode, content);

  const textForSend = extractTextContent(content);
  const canSend = textForSend.length > 0 || files.length > 0;

  // When content chips change while popover is closed, keep kind aligned for next @.
  useEffect(() => {
    if (mentionOpen) return;
    setMentionKind(resolveDefaultMentionKind({ mode, content, filesAvailable, availability }));
  }, [mode, content, filesAvailable, availability, mentionOpen]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-pipper-id="thread-composer">
      {entities.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5" data-pipper-id="composer-chips">
          {entities.map((entity) => (
            <span
              key={`${entity.kind}:${entity.id}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[12px] font-medium",
                mentionChipClass(entity.kind),
              )}
            >
              <span className="truncate">@{entity.label}</span>
              <button
                type="button"
                aria-label={`Remove ${entity.kind} ${entity.label}`}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100"
                onClick={() => removeChip(entity.kind)}
                disabled={disabled}
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <InputMessage
        className="relative z-10"
        textareaRef={textareaRef}
        value={freeText}
        onValueChange={handleValueChange}
        placeholder={resolvedPlaceholder}
        onSend={handleSend}
        disabled={disabled}
        canSendWhenEmpty={files.length > 0}
        files={onFilesChange ? files : undefined}
        onFilesChange={onFilesChange}
        onFilesRejected={onFilesRejected}
        accept="image/png,image/jpeg,image/gif,image/webp"
        maxFiles={maxFiles}
        isStreaming={isStreaming}
        onStop={onStop}
        isStopping={isStopping}
        sendLabel={isSubmitting ? "Sending" : "Send"}
        disableFileMentions
        leftSlot={
          showImageAttach && onFilesChange
            ? ({ openFilePicker }) => (
                <>
                  {leftSlotExtra}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-pipper-id="attach-image-button"
                    aria-label="Attach images"
                    onClick={() => openFilePicker("image/png,image/jpeg,image/gif,image/webp")}
                  >
                    <PaperclipIcon size={15} />
                  </Button>
                </>
              )
            : leftSlotExtra
              ? () => <>{leftSlotExtra}</>
              : undefined
        }
        rightSlot={rightSlotExtra ? () => <>{rightSlotExtra}</> : undefined}
        textareaProps={{
          onKeyDown,
          "aria-label": mode === "draft" ? "New thread composer" : "Message composer",
        }}
      />

      {mentionOpen ? (
        <MentionPopover
          anchorRect={anchorRect}
          kind={mentionKind}
          query={mentionQuery}
          items={filteredItems}
          selectedIndex={mentionIndex}
          onSelectedIndexChange={setMentionIndex}
          onPick={pickItem}
          onClose={closeMention}
          kinds={kinds}
          onKindChange={handleKindChange}
        />
      ) : null}

      <span className="sr-only" aria-hidden>
        {canSend ? "ready" : "empty"}
      </span>
    </div>
  );
}

/** Build initial draft content with optional soft-default project chip. */
export function initialDraftContent(
  project?: { id: string; name: string } | null,
): ComposerContent {
  if (!project) return buildContent([], "");
  return buildContent([{ kind: "project", id: project.id, label: project.name }], "");
}
