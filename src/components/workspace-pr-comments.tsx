import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CaretDown, ChatCircle } from "@phosphor-icons/react";
import type { WorkspacePrComment } from "../../contracts/git.ts";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import {
  commentTitle,
  commentToMarkdown,
  groupCommentsByAuthor,
  sortComments,
} from "@/lib/pr-comment-text";
import { cn } from "@/lib/utils";

type SortOrder = "latest" | "oldest";

const AVATAR_STRIP_MAX = 6;
const BODY_COLLAPSED_PX = 160;

function Avatar({
  url,
  name,
  size,
  className,
}: {
  url: string | null;
  name: string;
  size: number;
  className?: string;
}) {
  return url ? (
    <img
      src={url}
      alt=""
      title={name}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full bg-surface-2 object-cover", className)}
    />
  ) : (
    <span
      title={name}
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold uppercase text-muted-foreground",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}

/**
 * Selected author reads as a pill (avatar + name); the rest collapse into an
 * overlapping avatar stack. One click swaps who is expanded.
 */
function AuthorStrip({
  groups,
  selected,
  onSelect,
}: {
  groups: ReturnType<typeof groupCommentsByAuthor>;
  selected: string;
  onSelect: (author: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center">
      {groups.slice(0, AVATAR_STRIP_MAX).map((group, index) => {
        const active = group.author === selected;
        return (
          <button
            key={group.author}
            type="button"
            onClick={() => onSelect(group.author)}
            title={`${group.author} · ${group.comments.length}`}
            className={cn(
              "flex h-7 items-center rounded-full border border-border/60 transition-[margin,background-color]",
              active
                ? "z-10 gap-1.5 bg-surface-2 pl-0.5 pr-2.5 text-foreground"
                : "bg-surface-1 text-muted-foreground hover:z-20 hover:bg-surface-2",
              index > 0 && !active && "-ml-2",
              index > 0 && active && "-ml-1",
            )}
          >
            <Avatar url={group.avatarUrl} name={group.author} size={24} />
            {active ? (
              <span className="max-w-[9rem] truncate text-xs font-medium">{group.author}</span>
            ) : null}
            {active ? (
              <span className="text-[10px] text-muted-foreground">{group.comments.length}</span>
            ) : null}
          </button>
        );
      })}
      {groups.length > AVATAR_STRIP_MAX ? (
        <span className="-ml-2 flex h-7 items-center rounded-full border border-border/60 bg-surface-1 px-2 text-[10px] text-muted-foreground">
          +{groups.length - AVATAR_STRIP_MAX}
        </span>
      ) : null}
    </div>
  );
}

function SortMenu({ value, onChange }: { value: SortOrder; onChange: (v: SortOrder) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        {value === "latest" ? "Latest" : "Oldest"}
        <CaretDown size={11} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-28 rounded-lg border border-border bg-surface-1 p-1 shadow-surface-5">
          {(["latest", "oldest"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={cn(
                "flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-hover",
                option === value ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {option === "latest" ? "Latest" : "Oldest"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommentCard({
  comment,
  onAdd,
}: {
  comment: WorkspacePrComment;
  onAdd?: (comment: WorkspacePrComment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const markdown = useMemo(() => commentToMarkdown(comment.body), [comment.body]);
  const title = useMemo(() => commentTitle(comment), [comment]);
  const long = markdown.length > 600;
  return (
    <article className="flex flex-col gap-1.5 py-3">
      <header className="flex items-center gap-2">
        <span
          className={cn(
            "size-3 shrink-0 rounded-full",
            comment.path ? "bg-amber-500" : "bg-muted-foreground/40",
          )}
          title={comment.path ? "Inline review comment" : "Comment"}
        />
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={title}>
          {title}
        </h4>
        {onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(comment)}
            title="Add this comment to chat"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Add to chat"
          >
            <ChatCircle size={14} />
          </button>
        ) : null}
        {comment.url ? (
          <button
            type="button"
            onClick={() => void window.omni.shell.openHttps(comment.url!).catch(() => {})}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Open comment on GitHub"
          >
            <ArrowUpRight size={14} />
          </button>
        ) : null}
      </header>
      <div
        className="overflow-hidden pl-5 text-xs leading-5 text-muted-foreground"
        style={expanded ? undefined : { maxHeight: BODY_COLLAPSED_PX }}
      >
        <MarkdownRenderer className="text-xs leading-5">{markdown}</MarkdownRenderer>
      </div>
      {long && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start pl-5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Show more
        </button>
      ) : null}
    </article>
  );
}

export function WorkspacePrComments({
  comments,
  onAddComments,
}: {
  comments: WorkspacePrComment[];
  onAddComments?: (comments: WorkspacePrComment[]) => void;
}) {
  const groups = useMemo(() => groupCommentsByAuthor(comments), [comments]);
  const [picked, setPicked] = useState<string | null>(null);
  const [order, setOrder] = useState<SortOrder>("latest");
  // Fall back to the first author whenever the picked one leaves the list
  // (comment deleted, PR refreshed).
  const selected =
    picked && groups.some((group) => group.author === picked)
      ? picked
      : (groups[0]?.author ?? null);
  const visible = useMemo(() => {
    const group = groups.find((item) => item.author === selected);
    return group ? sortComments(group.comments, order) : [];
  }, [groups, selected, order]);

  if (groups.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Comments</h3>
        {onAddComments && visible.length > 0 ? (
          <button
            type="button"
            onClick={() => onAddComments(visible)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Add {visible.length === 1 ? "to chat" : `all ${visible.length} to chat`}
          </button>
        ) : null}
      </header>
      <div className="flex items-center justify-between gap-2">
        <AuthorStrip groups={groups} selected={selected ?? ""} onSelect={setPicked} />
        <SortMenu value={order} onChange={setOrder} />
      </div>
      <div className="flex flex-col divide-y divide-border/60">
        {visible.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            onAdd={onAddComments ? (item) => onAddComments([item]) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
