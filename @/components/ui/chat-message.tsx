"use client";

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { FileThumbnail } from "@/components/ui/file-thumbnail";

interface ChatMessageProps extends Omit<HTMLMotionProps<"div">, "children"> {
  from: "user" | "assistant";
  files?: File[];
  images?: Array<{ id: string; data: string; mimeType: string; name?: string }>;
  onImageClick?: (image: { id: string; data: string; mimeType: string; name?: string }) => void;
  thumbnailSize?: number;
  time?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Optional pipper-id to enable visual edit beam on this message */
  pipperId?: string;
}

const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  (
    {
      from,
      files,
      images,
      onImageClick,
      thumbnailSize = 64,
      time,
      actions,
      children,
      className,
      pipperId,
      ...props
    },
    ref,
  ) => {
    const shape = useShape();
    const isUser = from === "user";
    const showTime = isUser && time != null;
    // Three-line clamp on user messages (assistant replies stream, so they
    // stay unclamped). `line-clamp-3` is always applied to user bubbles when
    // not expanded — it's a no-op for content under 3 lines, so short
    // messages look identical. Overflow is detected by comparing scrollHeight
    // to clientHeight (the clamp sets overflow:hidden, so scrollHeight holds
    // the full natural height while clientHeight holds the 3-line cap). The
    // toggle only renders when overflow is real. While expanded the clamp is
    // removed, so we skip measurement — otherwise it would clear `clamped`
    // and hide the "Show less" button.
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (!isUser || !bodyRef.current || expanded) return;
      const el = bodyRef.current;
      const measure = () => setClamped(el.scrollHeight - el.clientHeight > 1);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [isUser, children, expanded]);

    return (
      <>
        <motion.div
          ref={ref}
          layout="position"
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.moderate}
          style={{ transformOrigin: isUser ? "bottom right" : "bottom left" }}
          data-pipper-id={pipperId}
          className={cn(
            "group flex min-w-0 flex-col gap-1.5",
            isUser ? "max-w-[92%] items-end self-end" : "w-full max-w-full items-start self-start",
            className,
          )}
          {...props}
        >
          {files && files.length > 0 && (
            <div className={cn("flex flex-wrap gap-1.5", isUser ? "justify-end" : "justify-start")}>
              {files.map((file, i) => (
                <FileThumbnail
                  key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
                  file={file}
                  size={thumbnailSize}
                />
              ))}
            </div>
          )}
          {images && images.length > 0 && (
            <div className={cn("flex flex-wrap gap-2", isUser ? "justify-end" : "justify-start")}>
              {images.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  className="block overflow-hidden rounded-md border border-border outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => onImageClick?.(image)}
                  aria-label={`Open ${image.name ?? "attached image"}`}
                >
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={image.name ?? "Attached image"}
                    className="size-24 object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {children != null && children !== "" && (
            <div
              ref={isUser ? bodyRef : undefined}
              className={cn(
                "max-w-full py-2 text-[14px] whitespace-pre-wrap break-words text-pretty",
                isUser
                  ? cn(
                      shape.bg,
                      "px-3.5 bg-[color-mix(in_oklab,var(--accent),var(--background)_45%)] text-accent-foreground",
                      !expanded && "line-clamp-3",
                    )
                  : "text-foreground",
              )}
            >
              {children}
            </div>
          )}
          {isUser && clamped && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="self-end rounded-md px-1 text-[12px] leading-none text-accent-foreground/70 transition-colors hover:text-accent-foreground opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
            >
              Show more
            </button>
          )}
          {isUser && clamped && expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="self-end rounded-md px-1 text-[12px] leading-none text-accent-foreground/70 transition-colors hover:text-accent-foreground opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
            >
              Show less
            </button>
          )}
          {(showTime || actions != null) && (
            <div
              className={cn(
                "flex items-center gap-2 px-1 text-[12px] leading-none text-muted-foreground select-none",
                "opacity-0 pointer-events-none transition-opacity duration-150",
                "group-hover:opacity-100 group-hover:pointer-events-auto",
                "group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
              )}
            >
              {showTime && <span className="tabular-nums">{time}</span>}
              {actions != null && <span className="flex items-center gap-0.5">{actions}</span>}
            </div>
          )}
        </motion.div>
      </>
    );
  },
);

ChatMessage.displayName = "ChatMessage";

export { ChatMessage };
export type { ChatMessageProps };
