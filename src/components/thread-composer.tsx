"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { InputMessage } from "@/components/ui/input-message";
import {
  MentionPopover,
  mentionChipClass,
  type MentionItem,
  type MentionProvider,
} from "@/components/mention-popover";
import { ProjectIcon } from "@/components/ui/icon-picker";
import { ProviderLogo } from "@/components/provider-logos";
import { cn } from "@/lib/utils";
import type {
  ComposerContent,
  ComposerEntityToken,
  ComposerMentionKind,
} from "../../contracts/composer.ts";
import {
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
  /** Provider options for the model picker. Draft can provide all opted-in agents. */
  modelProviders?: MentionProvider[];
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
  modelProviders: providedModelProviders = [],
  projectFiles = [],
  className,
  textareaRef: externalTextareaRef,
  leftSlotExtra,
  rightSlotExtra,
  onTextareaKeyDown,
}: ThreadComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef ?? internalRef;
  const mentionFrameRef = useRef<number | null>(null);
  const entities = useMemo(() => getEntityTokens(content), [content]);
  const freeText = useMemo(() => getFreeText(content), [content]);
  const inlineTextRef = useRef<HTMLSpanElement | null>(null);
  const inlineEditorRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const setInlineTextRef = useCallback(
    (node: HTMLSpanElement | null) => {
      inlineTextRef.current = node;
      // ThreadComposer uses a contentEditable span instead of InputMessage's
      // native textarea. Keep the legacy focus ref useful for callers that
      // focus the composer after opening a draft or editing a message.
      if (externalTextareaRef) {
        (externalTextareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
          node as unknown as HTMLTextAreaElement | null;
      }
    },
    [externalTextareaRef],
  );

  const filesAvailable = projectFiles.length > 0 || mode === "live" || mode === "draft";
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
  const [selectedModelProviderId, setSelectedModelProviderId] = useState<string | null>(null);
  const inferredModelProviders = useMemo<MentionProvider[]>(() => {
    const seen = new Set<string>();
    const result: MentionProvider[] = [];
    for (const model of models) {
      const id = model.providerId ?? model.agentId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        label: model.providerLabel ?? model.agentId ?? id,
      });
    }
    return result;
  }, [models]);

  const modelProviders = useMemo<MentionProvider[]>(() => {
    const seen = new Set<string>();
    const result: MentionProvider[] = [];
    for (const provider of [...providedModelProviders, ...inferredModelProviders]) {
      if (seen.has(provider.id)) continue;
      seen.add(provider.id);
      result.push(provider);
    }
    return result;
  }, [inferredModelProviders, providedModelProviders]);

  // A live thread has one fixed provider, so keep its icon visibly active.
  // Draft mode intentionally starts unfiltered so all opted-in providers are usable.
  const activeModelProviderId =
    selectedModelProviderId ??
    (mode === "live" && modelProviders.length === 1 ? modelProviders[0]?.id : null);

  const itemSource = useMemo(() => {
    if (mentionKind === "project") return projects;
    if (mentionKind === "agent") return agents;
    if (mentionKind === "model") return models;
    return projectFiles;
  }, [mentionKind, projects, agents, models, projectFiles]);

  const filteredItems = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    const providerItems =
      mentionKind === "model" && activeModelProviderId
        ? itemSource.filter((item) => (item.providerId ?? item.agentId) === activeModelProviderId)
        : itemSource;
    if (!q) return providerItems.slice(0, 80);
    return providerItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          (item.description?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 80);
  }, [activeModelProviderId, itemSource, mentionKind, mentionQuery]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionKind, filteredItems.length]);

  const updateAnchor = useCallback(() => {
    const el = textareaRef.current ?? inlineEditorRef.current;
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
    setSelectedModelProviderId(null);
  }, []);

  const placeInlineCaret = useCallback((offset: number) => {
    const editor = inlineTextRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const textNode = editor.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
      const safeOffset = Math.max(0, Math.min(offset, textNode.textContent.length));
      range.setStart(textNode, safeOffset);
    } else {
      range.setStart(editor, 0);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const focusInlineEditor = useCallback(() => {
    const editor = inlineTextRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection || !editor.contains(selection.anchorNode)) {
      placeInlineCaret(editor.textContent?.length ?? 0);
    }
  }, [placeInlineCaret]);

  const inlineCursorOffset = useCallback(() => {
    const selection = window.getSelection();
    const editor = inlineTextRef.current;
    if (!selection?.isCollapsed || !editor || !selection.anchorNode) return null;
    if (!editor.contains(selection.anchorNode)) return null;
    return selection.anchorOffset;
  }, []);

  const resolveKindForQuery = useCallback(
    (query: string) =>
      resolveDefaultMentionKind({
        mode,
        content: contentRef.current,
        filesAvailable,
        query,
        availability,
      }),
    [mode, filesAvailable, availability],
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
    (next: string, nextCursor?: number) => {
      const nextContent = setFreeText(contentRef.current, next);
      contentRef.current = nextContent;
      onContentChange(nextContent);
      const el = textareaRef.current;
      const cursor = nextCursor ?? el?.selectionStart ?? next.length;
      if (mentionFrameRef.current !== null) cancelAnimationFrame(mentionFrameRef.current);
      mentionFrameRef.current = requestAnimationFrame(() => {
        const liveCursor = textareaRef.current?.selectionStart ?? cursor;
        syncMentionFromText(next, liveCursor);
        mentionFrameRef.current = null;
      });
    },
    [onContentChange, syncMentionFromText, textareaRef],
  );

  useEffect(() => {
    return () => {
      if (mentionFrameRef.current !== null) cancelAnimationFrame(mentionFrameRef.current);
    };
  }, []);

  const handleProviderChange = useCallback((providerId: string | null) => {
    setSelectedModelProviderId(providerId);
    setMentionIndex(0);
  }, []);

  const pickItem = useCallback(
    (item: MentionItem) => {
      const currentContent = contentRef.current;
      const currentFreeText = getFreeText(currentContent);
      const el = textareaRef.current;
      const selection = window.getSelection();
      const inlineText = inlineTextRef.current;
      const cursor =
        el?.selectionStart ??
        (selection?.anchorNode && inlineText?.contains(selection.anchorNode)
          ? selection.anchorOffset
          : currentFreeText.length);
      const mention = findActiveMention(currentFreeText, cursor);
      let nextText = currentFreeText;
      if (mention) {
        nextText = removeMentionFromText(currentFreeText, mention);
      }

      // Files insert as plain `@path` text (agent-readable), not control chips.
      if (mentionKind === "file") {
        const insertAt = mention?.atIndex ?? nextText.length;
        const fileLabel = item.label.replace(/^@+/, "");
        const insertion = `@${fileLabel} `;
        nextText = `${nextText.slice(0, insertAt)}${insertion}${nextText.slice(insertAt)}`;
        const nextContent = setFreeText(currentContent, nextText);
        contentRef.current = nextContent;
        onContentChange(nextContent);
        closeMention();
        requestAnimationFrame(() => {
          const caret = insertAt + insertion.length;
          placeInlineCaret(caret);
        });
        return;
      }

      let entity: ComposerEntityToken;
      if (mentionKind === "project") {
        entity = { kind: "project", id: item.id, label: item.label, icon: item.icon };
      } else if (mentionKind === "agent") {
        entity = { kind: "agent", id: item.id, label: item.label };
      } else {
        entity = {
          kind: "model",
          id: item.id,
          label: item.label,
          agentId: item.agentId,
          providerId: item.providerId,
        };
      }
      const withEntity = upsertEntity(setFreeText(currentContent, nextText), entity);
      contentRef.current = withEntity;
      onContentChange(withEntity);
      closeMention();
      requestAnimationFrame(() => {
        const caret = Math.min(mention?.atIndex ?? nextText.length, nextText.length);
        placeInlineCaret(caret);
      });
    },
    [closeMention, mentionKind, onContentChange, placeInlineCaret, textareaRef],
  );

  const removeChip = useCallback(
    (kind: ComposerEntityToken["kind"]) => {
      const nextContent = removeEntityKind(contentRef.current, kind);
      contentRef.current = nextContent;
      onContentChange(nextContent);
    },
    [onContentChange],
  );

  const handleSend = useCallback(
    (_value: string, sendFiles: File[]) => {
      if (disabled || isSubmitting) return;
      onSend(contentRef.current, sendFiles);
    },
    [disabled, isSubmitting, onSend],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
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
      onTextareaKeyDown?.(event as ReactKeyboardEvent<HTMLTextAreaElement>);
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

  // The editable text node is intentionally uncontrolled while the user types.
  // Sync only external changes so React never reconciles children inside a
  // contentEditable element.
  useEffect(() => {
    const editor = inlineTextRef.current;
    if (editor && editor.textContent !== freeText) editor.textContent = freeText;
  }, [freeText]);

  // Keep chips and the editable text in one inline formatting context.
  // A flex row makes the text span its own permanent column, so wrapped
  // lines stay indented after the last chip instead of using the full
  // composer width.
  const inlineEditor = (
    <div
      ref={inlineEditorRef}
      className="block h-11 min-h-11 max-h-11 min-w-0 flex-1 cursor-text overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-2 text-[14px] leading-5 text-foreground outline-none"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={mode === "draft" ? "New thread composer" : "Message composer"}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button") || target.closest('[contenteditable="true"]')) return;
        event.preventDefault();
        focusInlineEditor();
      }}
      onInput={(event) => {
        const text =
          event.currentTarget.querySelector<HTMLElement>("[data-inline-text]")?.textContent ?? "";
        const selection = window.getSelection();
        const textNode = event.currentTarget.querySelector<HTMLElement>("[data-inline-text]");
        const cursor =
          selection && textNode && selection.anchorNode && textNode.contains(selection.anchorNode)
            ? selection.anchorOffset
            : text.length;
        handleValueChange(text, cursor);
      }}
      onKeyDown={(event) => {
        const cursor = inlineCursorOffset();
        const visibleEntities = entities.filter((entity) => entity.kind !== "agent");
        if (cursor === 0 && visibleEntities.length > 0 && event.key === "Backspace") {
          event.preventDefault();
          const previous = visibleEntities[visibleEntities.length - 1]!;
          const nextContent = removeEntityKind(contentRef.current, previous.kind);
          contentRef.current = nextContent;
          onContentChange(nextContent);
          requestAnimationFrame(() => placeInlineCaret(0));
          return;
        }
        if (cursor === 0 && visibleEntities.length > 0 && event.key === "Delete") {
          event.preventDefault();
          const nextContent = removeEntityKind(contentRef.current, visibleEntities[0]!.kind);
          contentRef.current = nextContent;
          onContentChange(nextContent);
          requestAnimationFrame(() => placeInlineCaret(0));
          return;
        }
        onKeyDown(event);
        if (event.defaultPrevented) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          handleSend(getFreeText(content), files);
        }
      }}
    >
      {entities
        .filter((entity) => entity.kind !== "agent")
        .map((entity) => {
          let iconNode: React.ReactNode = null;
          if (entity.kind === "project") {
            const projectItem = projects.find((p) => p.id === entity.id);
            const iconName = entity.icon ?? projectItem?.icon ?? null;
            iconNode = <ProjectIcon name={iconName} className="size-3.5 shrink-0" />;
          } else if (entity.kind === "model") {
            const modelItem = models.find((m) => m.id === entity.id);
            const providerKey =
              entity.providerId ??
              modelItem?.providerId ??
              entity.agentId ??
              modelItem?.agentId ??
              entity.id;
            iconNode = (
              <ProviderLogo provider={providerKey} size={13} className="size-3.5 shrink-0" />
            );
          }

          return (
            <span
              key={`${entity.kind}:${entity.id}`}
              contentEditable={false}
              title={`@${entity.label}`}
              className={cn(
                "mr-1.5 inline-flex min-w-0 max-w-[min(100%,28rem)] shrink items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1 align-middle text-[12px] leading-none font-medium",
                mentionChipClass(entity.kind),
              )}
            >
              {iconNode}
              <span className="min-w-0 truncate leading-none">@{entity.label}</span>
              <button
                type="button"
                aria-label={`Remove ${entity.kind} ${entity.label}`}
                className="inline-flex size-4 items-center justify-center rounded-full opacity-70 hover:opacity-100"
                onClick={() => removeChip(entity.kind)}
              >
                <XIcon size={11} />
              </button>
            </span>
          );
        })}
      <span
        ref={setInlineTextRef}
        data-inline-text
        contentEditable={!disabled}
        tabIndex={0}
        className="inline-block min-w-[2px] cursor-text whitespace-pre-wrap break-words [overflow-wrap:anywhere] outline-none align-middle empty:before:inline-block empty:before:align-middle empty:before:max-w-full empty:before:overflow-hidden empty:before:text-ellipsis empty:before:whitespace-nowrap empty:before:text-muted-foreground empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)]"
        style={{ caretColor: "currentColor" }}
        data-placeholder={resolvedPlaceholder}
      />
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-pipper-id="thread-composer">
      <InputMessage
        className="relative z-10"
        textareaRef={textareaRef}
        value={freeText}
        onValueChange={handleValueChange}
        placeholder={resolvedPlaceholder}
        onSend={handleSend}
        customInput={inlineEditor}
        compact
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
                    <PlusIcon size={17} />
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
          items={filteredItems}
          selectedIndex={mentionIndex}
          onSelectedIndexChange={setMentionIndex}
          onPick={pickItem}
          onClose={closeMention}
          providers={modelProviders}
          selectedProviderId={activeModelProviderId}
          onProviderChange={handleProviderChange}
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
  project?: { id: string; name: string; icon?: string | null } | null,
): ComposerContent {
  if (!project) return buildContent([], "");
  return buildContent(
    [{ kind: "project", id: project.id, label: project.name, icon: project.icon }],
    "",
  );
}
