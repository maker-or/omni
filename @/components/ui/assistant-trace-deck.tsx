import { useState, useEffect, type HTMLAttributes } from "react";
import type { IconName } from "@/lib/icon-context";
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
import { stringifyMessageContent, type MessageLike } from "@/lib/message-utils";
import type { StepStatus } from "@/components/ui/thinking-steps";

interface AssistantTraceDeckProps extends HTMLAttributes<HTMLDivElement> {
  traceParts: any[];
  isStreaming: boolean;
  activeMessages: MessageLike[];
}

type ToolResultMessage = MessageLike & {
  toolCallId?: string;
  isError?: boolean;
};

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
      description: "Opened source context to understand the current implementation.",
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

function AssistantTraceDeck({
  traceParts,
  isStreaming,
  activeMessages,
  className,
  ...props
}: AssistantTraceDeckProps) {
  const [open, setOpen] = useState(isStreaming);

  useEffect(() => {
    setOpen(isStreaming);
  }, [isStreaming]);

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
    <ThinkingSteps open={open} onOpenChange={setOpen} className={className} {...props}>
      <ThinkingStepsHeader>
        <ThinkingIndicator isStreaming={isStreaming} className="p-0 bg-transparent" />
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

            const resultMsg = activeMessages.find((m) => {
              const candidate = m as ToolResultMessage;
              return candidate.role === "toolResult" && candidate.toolCallId === toolCallId;
            }) as ToolResultMessage | undefined;

            const isPartStreaming = isStreaming && isLast && !resultMsg;
            const missingResult = !isStreaming && !resultMsg;
            const resultIsError = Boolean(resultMsg?.isError);

            let status: StepStatus = "complete";
            if (isPartStreaming) {
              status = "active";
            } else if (missingResult || resultIsError) {
              status = "error";
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
            const actionDescription = [
              actionCopy.description,
              missingResult ? "No tool result was returned." : actionCopy.resultSummary,
            ]
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

                {missingResult && (
                  <div className="mt-1.5 text-red-500 text-[12px] font-medium leading-snug">
                    Missing tool result.
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

export { AssistantTraceDeck };
export type { AssistantTraceDeckProps };
