"use client";

import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { FileThumbnail } from "@/components/ui/file-thumbnail";
import { PipperBeam } from "@/components/ui/pipper-beam";

interface ChatMessageProps extends Omit<HTMLMotionProps<"div">, "children"> {
  from: "user" | "assistant";
  files?: File[];
  thumbnailSize?: number;
  time?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Optional pipper-id to enable visual edit beam on this message */
  pipperId?: string;
}

const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  (
    { from, files, thumbnailSize = 64, time, actions, children, className, pipperId, ...props },
    ref,
  ) => {
    const shape = useShape();
    const isUser = from === "user";
    const showTime = isUser && time != null;

    return (
      <PipperBeam pipperId={pipperId}>
        <motion.div
          ref={ref}
          layout="position"
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={springs.moderate}
          style={{ transformOrigin: isUser ? "bottom right" : "bottom left" }}
          data-pipper-id={pipperId}
          className={cn(
            "group flex max-w-[80%] flex-col gap-1.5",
            isUser ? "items-end self-end" : "items-start self-start",
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
          {children != null && children !== "" && (
            <div
              className={cn(
                "py-2 text-[14px] whitespace-pre-wrap break-words text-pretty",
                isUser
                  ? cn(
                      shape.bg,
                      "px-3.5 bg-[color-mix(in_oklab,var(--accent),var(--background)_45%)] text-accent-foreground",
                    )
                  : "text-foreground",
              )}
            >
              {children}
            </div>
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
      </PipperBeam>
    );
  },
);

ChatMessage.displayName = "ChatMessage";

export { ChatMessage };
export type { ChatMessageProps };
