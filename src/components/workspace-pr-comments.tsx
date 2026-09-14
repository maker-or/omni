import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CaretDown, ChatCircle } from "@phosphor-icons/react";
import type { WorkspacePrComment } from "../../contracts/git.ts";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Elevated } from "@/lib/elevated";
import {
  commentTitle,
  commentToMarkdown,
  groupCommentsByAuthor,
  sortComments,
} from "@/lib/pr-comment-text";
import { useContentOverflow } from "@/lib/use-content-overflow";
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
 * Minimal anchored menu: a trigger plus an `Elevated` popup that closes on
 * outside pointer-down. `items` render inside; each closes the menu itself
 * via the `close` callback.
 */
function PopMenu({
  trigger,
  align = "right",
  width,
  children,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  align?: "left" | "right";
  width: string;
  children: (close: () => void) => ReactNode;
}) {
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
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <Elevated
          offset={2}
          className={cn(
            "absolute top-full z-50 mt-1 rounded-lg border border-border p-1",
            align === "right" ? "right-0" : "left-0",
            width,
          )}
        >
          {children(() => setOpen(false))}
        </Elevated>
      ) : null}
    </div>
  );
}

/**
 * Selected author reads as a pill (avatar + name); the rest collapse into an
 * overlapping avatar stack. One click swaps who is expanded. Authors past the
 * strip cap live behind the `+N` menu so every group stays reachable.
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
  // Keep the selected author visible even when they would fall past the cap:
  // swap them into the last visible slot rather than hiding the active pill.
  const { visible, hidden } = useMemo(() => {
    const selectedIndex = groups.findIndex((group) => group.author === selected);
    if (groups.length <= AVATAR_STRIP_MAX || selectedIndex < AVATAR_STRIP_MAX) {
      return { visible: groups.slice(0, AVATAR_STRIP_MAX), hidden: groups.slice(AVATAR_STRIP_MAX) };
    }
    const head = groups.slice(0, AVATAR_STRIP_MAX - 1);
    const rest = groups.filter(
      (_, index) => index >= AVATAR_STRIP_MAX - 1 && index !== selectedIndex,
    );
    return { visible: [...head, groups[selectedIndex]!], hidden: rest };
  }, [groups, selected]);
  return (
    <div className="flex min-w-0 items-center">
      {visible.map((group, index) => {
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
      {hidden.length > 0 ? (
        <PopMenu
          align="left"
          width="w-52"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-label={`${hidden.length} more ${hidden.length === 1 ? "author" : "authors"}`}
              className="-ml-2 flex h-7 items-center rounded-full border border-border/60 bg-surface-1 px-2 text-[10px] text-muted-foreground transition-colors hover:z-20 hover:bg-surface-2 hover:text-foreground"
            >
              +{hidden.length}
            </button>
          )}
        >
          {(close) =>
            hidden.map((group) => (
              <button
                key={group.author}
                type="button"
                onClick={() => {
                  onSelect(group.author);
                  close();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <Avatar url={group.avatarUrl} name={group.author} size={18} />
                <span className="min-w-0 flex-1 truncate">{group.author}</span>
                <span className="text-[10px]">{group.comments.length}</span>
              </button>
            ))
          }
        </PopMenu>
      ) : null}
    </div>
  );
}

function SortMenu({ value, onChange }: { value: SortOrder; onChange: (v: SortOrder) => void }) {
  return (
    <PopMenu
      width="w-28"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={open}
        >
          {value === "latest" ? "Latest" : "Oldest"}
          <CaretDown size={11} />
        </button>
      )}
    >
      {(close) =>
        (["latest", "oldest"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              onChange(option);
              close();
            }}
            className={cn(
              "flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-hover",
              option === value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {option === "latest" ? "Latest" : "Oldest"}
          </button>
        ))
      }
    </PopMenu>
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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Rendered height, not character count, decides whether anything is clipped.
  const clipped = useContentOverflow(bodyRef, [markdown, expanded]);
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
        ref={bodyRef}
        className="overflow-hidden pl-5 text-xs leading-5 text-muted-foreground"
        style={expanded ? undefined : { maxHeight: BODY_COLLAPSED_PX }}
      >
        <MarkdownRenderer className="text-xs leading-5">{markdown}</MarkdownRenderer>
      </div>
      {clipped && !expanded ? (
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
