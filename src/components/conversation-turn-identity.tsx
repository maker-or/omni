"use client";

import { memo } from "react";
import { StopIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ConversationTurnIdentityProps {
  role: "user" | "assistant";
  isStreaming?: boolean;
  isStopping?: boolean;
  onStop?: () => void;
  emphasis?: "quiet" | "composer";
  className?: string;
}

const USER_IDENTITY_MARK = (
  <svg
    width="29"
    height="29"
    viewBox="0 0 29 29"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="block size-full"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="29" height="29" rx="14.5" fill="#26B25A" />
    <path
      d="M6.84425 15.494C6.84425 10.8139 9.98266 7.77648 14.5159 7.77648C18.783 7.77648 21.8572 10.4652 21.8572 14.6498C21.8572 17.3936 20.5358 19.3666 18.3976 19.3666C17.2597 19.3666 16.3971 18.8251 16.2319 17.8983H16.1402C15.7364 18.8343 14.9105 19.3666 13.846 19.3666C11.9556 19.3666 10.6617 17.7882 10.6617 15.4848C10.6617 13.2182 11.9556 11.6765 13.7818 11.6765C14.7912 11.6765 15.6446 12.1446 16.0209 12.9613H16.1126V12.5024C16.1126 11.9885 16.4155 11.6765 16.9018 11.6765C17.3974 11.6765 17.691 11.9885 17.691 12.5024V17.054C17.691 17.6781 18.0489 18.0359 18.7096 18.0359C19.7282 18.0359 20.4257 16.687 20.4257 14.7599C20.4257 11.0617 17.7736 9.05203 14.4976 9.05203C10.7443 9.05203 8.2758 11.7041 8.2758 15.5491C8.2758 19.5226 10.937 21.8167 14.883 21.8167C15.7823 21.8167 16.4155 21.6882 17.2414 21.4864C17.3882 21.4588 17.5075 21.4497 17.5993 21.4497C17.9755 21.4497 18.1866 21.6515 18.1866 21.9727C18.1866 22.2939 17.9939 22.5417 17.4433 22.7252C16.7642 22.9546 15.7456 23.1014 14.5985 23.1014C10.0928 23.1014 6.84425 20.2659 6.84425 15.494ZM14.1672 17.935C15.3143 17.935 16.0576 16.9898 16.0576 15.4848C16.0576 14.0166 15.3235 13.0806 14.1672 13.0806C13.0385 13.0806 12.3594 13.9799 12.3594 15.494C12.3594 17.0173 13.0293 17.935 14.1672 17.935Z"
      fill="#088139"
    />
    <rect x="0.5" y="0.5" width="28" height="28" rx="14" stroke="#088139" />
  </svg>
);

const ASSISTANT_IDENTITY_MARK = (
  <svg
    width="29"
    height="29"
    viewBox="0 0 29 29"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="block size-full"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="0.5" y="0.5" width="28" height="27.5397" rx="13.7698" fill="#FFAA4F" />
    <rect x="0.5" y="0.5" width="28" height="27.5397" rx="13.7698" stroke="#B1620D" />
    <path
      d="M12.7546 7.47987C13.6048 6.27201 15.3952 6.27201 16.2454 7.47987V7.47987C16.6712 8.08491 17.38 8.42625 18.1185 8.38194V8.38194C19.5929 8.29349 20.7092 9.69335 20.2949 11.1111V11.1111C20.0874 11.8212 20.2625 12.5882 20.7576 13.138V13.138C21.746 14.2356 21.3476 15.9812 19.9808 16.5412V16.5412C19.2962 16.8217 18.8057 17.4368 18.6845 18.1667V18.1667C18.4427 19.6238 16.8295 20.4006 15.5395 19.6812V19.6812C14.8934 19.3209 14.1066 19.3209 13.4605 19.6812V19.6812C12.1705 20.4006 10.5573 19.6238 10.3155 18.1667V18.1667C10.1943 17.4368 9.70381 16.8217 9.01919 16.5412V16.5412C7.65244 15.9812 7.25402 14.2356 8.24243 13.138V13.138C8.73755 12.5882 8.9126 11.8212 8.70507 11.1111V11.1111C8.29075 9.69335 9.4071 8.29349 10.8815 8.38194V8.38194C11.62 8.42625 12.3288 8.08491 12.7546 7.47987V7.47987Z"
      fill="#B1620D"
    />
  </svg>
);

const assistantIdentityClass =
  "relative flex shrink-0 items-center justify-center rounded-full text-[#B1620D]";
const identityEmphasisClass = {
  quiet: "size-7",
  composer: "size-8",
} as const;

function StreamingAssistantIdentity({
  isStopping,
  onStop,
  className,
}: {
  isStopping: boolean;
  onStop: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      type="button"
      className={cn(
        assistantIdentityClass,
        "size-7",
        "group cursor-pointer bg-[#FFAA4F] outline-none ring-1 ring-inset ring-[#B1620D] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait",
        className,
      )}
      data-pipper-id="assistant-turn-stop"
      aria-label={isStopping ? "Stopping response" : "Stop response"}
      title={isStopping ? "Stopping response" : "Stop response"}
      disabled={isStopping}
      onClick={onStop}
      whileTap={reduceMotion || isStopping ? undefined : { scale: 0.92 }}
    >
      <motion.span
        className="relative flex size-full items-center justify-center"
        aria-hidden="true"
        animate={
          reduceMotion || isStopping
            ? undefined
            : {
                scale: [1, 0.94, 1],
              }
        }
        transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
      >
        <span
          className={cn(
            "absolute transition-[opacity,transform] duration-150",
            isStopping
              ? "scale-75 opacity-0"
              : "scale-100 opacity-100 group-hover:scale-75 group-hover:opacity-0 group-focus-visible:scale-75 group-focus-visible:opacity-0",
          )}
        >
          {ASSISTANT_IDENTITY_MARK}
        </span>
        <StopIcon
          size={13}
          weight="fill"
          className={cn(
            "absolute transition-[opacity,transform] duration-150",
            isStopping
              ? "scale-100 opacity-100"
              : "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100",
          )}
        />
      </motion.span>
    </motion.button>
  );
}

const ConversationTurnIdentity = memo(function ConversationTurnIdentity({
  role,
  isStreaming = false,
  isStopping = false,
  onStop,
  emphasis = "quiet",
  className,
}: ConversationTurnIdentityProps) {
  if (role === "user") {
    return (
      <span
        className={cn("block shrink-0", identityEmphasisClass[emphasis], className)}
        data-pipper-id="user-turn-identity"
      >
        {USER_IDENTITY_MARK}
      </span>
    );
  }

  if (!isStreaming || !onStop) {
    return (
      <span
        className={cn(assistantIdentityClass, identityEmphasisClass[emphasis], className)}
        data-pipper-id="assistant-turn-identity"
        aria-hidden="true"
      >
        {ASSISTANT_IDENTITY_MARK}
      </span>
    );
  }

  return (
    <StreamingAssistantIdentity isStopping={isStopping} onStop={onStop} className={className} />
  );
});

export { ConversationTurnIdentity };
export type { ConversationTurnIdentityProps };
