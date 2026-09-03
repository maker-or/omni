import { useState, useMemo, type HTMLAttributes } from "react";
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
  type StepStatus,
} from "@/components/ui/thinking-steps";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import type { MessageLike } from "@/lib/message-utils";
import { useAgentTerminalStore } from "@/store/agent-terminal-store";
import { cn } from "@/lib/utils";

function AgentTerminalOutput({ terminalId }: { terminalId: string }) {
  const output = useAgentTerminalStore((s) => s.outputs[terminalId] ?? "");
  return (
    <div
      data-pipper-id={`agent-terminal-${terminalId}`}
      className="mt-1.5 rounded-md border border-border/60 bg-black/95"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-400">
        <span>Terminal</span>
        <span className="font-mono normal-case tracking-normal text-zinc-500">
          {terminalId.slice(0, 8)}
        </span>
      </div>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap p-2 font-mono text-[11px] text-zinc-100">
        {output || "…"}
      </pre>
    </div>
  );
}

function extractTerminalIdsFromPart(part: {
  content?: unknown;
  status?: string;
  terminalIds?: string[];
}): string[] {
  const ids: string[] = [...(part.terminalIds ?? [])];
  if (!Array.isArray(part.content)) return ids;
  for (const block of part.content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "terminal" &&
      typeof (block as { terminalId?: string }).terminalId === "string"
    ) {
      ids.push((block as { terminalId: string }).terminalId);
    }
  }
  return ids;
}

interface AssistantTraceDeckProps extends HTMLAttributes<HTMLDivElement> {
  traceParts: any[];
  isStreaming: boolean;
  activeMessages: MessageLike[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ToolResultMessage = MessageLike & {
  toolCallId?: string;
  isError?: boolean;
};

const MAX_RENDERED_TOOL_OUTPUT_CHARS = 120_000;
const EMPTY_TOOL_RESULT_MAP = new Map<string, ToolResultMessage & { terminalIds?: string[] }>();

function compactText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function compactValue(value: unknown, maxLength = 256): string {
  if (typeof value === "string") return compactText(value, maxLength);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const preview = keys.slice(0, 6).join(", ");
    return keys.length > 6 ? `{${preview}, …}` : `{${preview}}`;
  }
  try {
    return compactText(JSON.stringify(value) ?? String(value), maxLength);
  } catch {
    return "[unserializable value]";
  }
}

function tailText(
  value: string,
  maxLength = MAX_RENDERED_TOOL_OUTPUT_CHARS,
): {
  text: string;
  truncated: boolean;
} {
  if (value.length <= maxLength) return { text: value, truncated: false };

  const start = value.length - maxLength;
  const firstLine = value.indexOf("\n", start);
  return {
    text: `[Earlier output truncated]\n${value.slice(firstLine >= 0 ? firstLine + 1 : start)}`,
    truncated: true,
  };
}

function firstNonEmptyLines(value: string, maxLines = 10): string[] {
  const lines: string[] = [];
  let start = 0;

  while (start <= value.length && lines.length < maxLines) {
    const newline = value.indexOf("\n", start);
    const end = newline >= 0 ? newline : value.length;
    const line = value.slice(start, end).trim();
    if (line) lines.push(line);
    if (newline < 0) break;
    start = newline + 1;
  }

  return lines;
}

function boundedMessageText(message: MessageLike, maxLength: number): string {
  if ("text" in message && typeof message.text === "string") {
    return tailText(message.text, maxLength).text;
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return tailText(content, maxLength).text;
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  let length = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const typed = part as { type?: string; text?: string; thinking?: string };
    const chunk =
      typed.type === "text" && typeof typed.text === "string"
        ? typed.text
        : typed.type === "thinking" && typeof typed.thinking === "string"
          ? typed.thinking
          : "";
    if (!chunk) continue;

    const remaining = maxLength - length;
    if (remaining <= 0) break;
    chunks.push(chunk.slice(0, remaining));
    length += Math.min(chunk.length, remaining);
    if (chunk.length > remaining) break;
  }

  return tailText(chunks.join("\n"), maxLength).text;
}

function findToolResult(
  messages: MessageLike[],
  toolCallId?: string,
): (ToolResultMessage & { terminalIds?: string[] }) | undefined {
  if (!toolCallId) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index] as ToolResultMessage & { terminalIds?: string[] };
    if (candidate.role === "toolResult" && candidate.toolCallId === toolCallId) {
      return candidate;
    }
  }
  return undefined;
}

function buildToolResultMap(
  messages: MessageLike[],
): Map<string, ToolResultMessage & { terminalIds?: string[] }> {
  const map = new Map<string, ToolResultMessage & { terminalIds?: string[] }>();
  for (const message of messages) {
    const candidate = message as ToolResultMessage & { terminalIds?: string[] };
    if (candidate.role === "toolResult" && candidate.toolCallId && !map.has(candidate.toolCallId)) {
      map.set(candidate.toolCallId, candidate);
    }
  }
  return map;
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
          label: toolName ? `Used ${compactText(toolName, 48)}` : "Ran an agent action",
          description: Object.keys(args).length
            ? compactText(
                Object.entries(args)
                  .map(([key, value]) => `${key}: ${compactValue(value)}`)
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

function getToolIcon(toolName: string): IconName {
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
}

function extractSources(text: string): string[] {
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
}

// ─── Active Streaming Component (Single Compact Row) ──────────────────────────

function ActiveTraceRow({
  activePart,
  toolResult,
  className,
  ...props
}: {
  activePart?: any;
  toolResult?: ToolResultMessage;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const label = useMemo(() => {
    if (!activePart) return undefined;
    if (activePart.type === "thinking") return "Thinking";
    if (activePart.type === "toolCall") {
      const toolName = activePart.name || "";
      const args = activePart.arguments ?? activePart.args ?? {};
      const resultText = toolResult
        ? boundedMessageText(toolResult, 8_000)
        : activePart.rawOutput != null
          ? typeof activePart.rawOutput === "string"
            ? compactText(activePart.rawOutput, 8_000)
            : compactValue(activePart.rawOutput, 8_000)
          : typeof activePart.outputPreview === "string"
            ? activePart.outputPreview
            : "";
      const isError = Boolean(toolResult?.isError) || activePart.status === "failed";
      const actionCopy = getToolActionCopy(toolName, args, resultText, isError);
      return actionCopy.label || toolName || "Ran an agent action";
    }
    return undefined;
  }, [activePart, toolResult]);

  return (
    <div
      data-pipper-id="assistant-trace-deck-active"
      className={cn("flex h-9 items-center select-none", className)}
      {...props}
    >
      <ThinkingIndicator
        isStreaming={true}
        label={label}
        showIcon={false}
        className="p-0 bg-transparent"
      />
    </div>
  );
}

// ─── Lazy Step Components for Passive Accordion ─────────────────────────────

function PassiveThinkingStepItem({
  part,
  index,
  isLast,
}: {
  part: { thinking?: string };
  index: number;
  isLast: boolean;
}) {
  return (
    <ThinkingStep
      data-pipper-id="assistant-thinking-step"
      index={index}
      icon="brain"
      label="Thinking"
      status="complete"
      isLast={isLast}
    >
      {part.thinking && (
        <MarkdownRenderer
          isStreaming={false}
          className="text-[13px] text-muted-foreground [&_p]:leading-snug [&_strong]:text-foreground"
        >
          {part.thinking}
        </MarkdownRenderer>
      )}
    </ThinkingStep>
  );
}

function PassiveToolStepItem({
  part,
  index,
  isLast,
  resultMsg,
}: {
  part: any;
  index: number;
  isLast: boolean;
  resultMsg?: ToolResultMessage & { terminalIds?: string[] };
}) {
  const toolCallId = part.id;
  const toolName = part.name || "";
  const args = part.arguments ?? part.args ?? {};
  const partStatus = part.status as string | undefined;

  const terminalIds = useMemo(
    () =>
      [...extractTerminalIdsFromPart(part), ...(resultMsg?.terminalIds ?? [])].filter(
        (id, i, all) => all.indexOf(id) === i,
      ),
    [part, resultMsg],
  );

  const completedViaPart =
    partStatus === "completed" || partStatus === "failed" || partStatus === "cancelled";
  const hasResult = Boolean(resultMsg) || completedViaPart;
  const missingResult = !hasResult;
  const resultIsError = Boolean(resultMsg?.isError) || partStatus === "failed";
  const status: StepStatus = missingResult || resultIsError ? "error" : "complete";

  const stepLabel = toolName;
  let stepDescription = "";
  if (toolName === "bash") {
    stepDescription = args.command || "";
  } else {
    const keys = Object.keys(args);
    if (keys.length > 0) {
      stepDescription = keys.map((k) => `${k}: ${compactValue(args[k])}`).join(", ");
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
    resultText = boundedMessageText(resultMsg, MAX_RENDERED_TOOL_OUTPUT_CHARS);
    isError = Boolean(resultMsg.isError);

    if (toolName.includes("search") || toolName.includes("web") || toolName.includes("globe")) {
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
        const pathMatch = resultText.match(/(?:[a-zA-Z]:)?[\w/.-]+\.(?:png|jpg|jpeg|gif)/);
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
      detailsLinesArray = firstNonEmptyLines(resultText);
    }
  } else if (completedViaPart && part.rawOutput != null) {
    resultText =
      typeof part.rawOutput === "string"
        ? compactText(part.rawOutput, MAX_RENDERED_TOOL_OUTPUT_CHARS)
        : compactValue(part.rawOutput, MAX_RENDERED_TOOL_OUTPUT_CHARS);
  } else if (completedViaPart && typeof part.outputPreview === "string") {
    resultText = part.outputPreview;
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
      data-pipper-id="assistant-tool-step"
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
        <ThinkingStepDetails summary={detailsSummary || "Details"} details={detailsLinesArray} />
      )}

      {terminalIds.map((terminalId) => (
        <AgentTerminalOutput key={terminalId} terminalId={terminalId} />
      ))}

      {resultMsg && toolName === "bash" && terminalIds.length === 0 && (
        <div className="mt-1.5 rounded bg-black/95 p-2 font-mono text-[11px] text-zinc-100 max-h-48 overflow-y-auto whitespace-pre-wrap">
          {tailText(resultText).text}
        </div>
      )}

      {resultMsg?.isError && (
        <div className="mt-1.5 text-amber-700 dark:text-amber-300 text-[12px] font-medium leading-snug">
          Error: {resultText}
        </div>
      )}

      {missingResult && (
        <div className="mt-1.5 text-amber-700 dark:text-amber-300 text-[12px] font-medium leading-snug">
          Missing tool result.
        </div>
      )}
    </ThinkingStep>
  );
}

function PassiveTraceContent({
  traceParts,
  toolResultByCallId,
}: {
  traceParts: any[];
  toolResultByCallId: Map<string, ToolResultMessage & { terminalIds?: string[] }>;
}) {
  return (
    <>
      {traceParts.map((part, index) => {
        const isLast = index === traceParts.length - 1;

        if (part.type === "thinking") {
          return (
            <PassiveThinkingStepItem
              key={`thinking-${index}`}
              part={part}
              index={index}
              isLast={isLast}
            />
          );
        }

        if (part.type === "toolCall") {
          const toolCallId = part.id;
          const resultMsg = toolResultByCallId.get(toolCallId);
          return (
            <PassiveToolStepItem
              key={`tool-${toolCallId || index}`}
              part={part}
              index={index}
              isLast={isLast}
              resultMsg={resultMsg}
            />
          );
        }

        return null;
      })}
    </>
  );
}

// ─── Passive Settled Deck (Lazy Collapsible Accordion) ─────────────────────────

function PassiveTraceDeck({
  traceParts,
  activeMessages,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  ...props
}: {
  traceParts: any[];
  activeMessages: MessageLike[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const toolResultByCallId = useMemo(
    () => (open ? buildToolResultMap(activeMessages) : EMPTY_TOOL_RESULT_MAP),
    [activeMessages, open],
  );
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const stepCount = traceParts.length;
  const headerLabel = stepCount > 1 ? `Thought process · ${stepCount} steps` : "Thought process";

  return (
    <ThinkingSteps
      open={open}
      onOpenChange={setOpen}
      className={className}
      {...props}
      data-pipper-id="assistant-trace-deck"
    >
      <ThinkingStepsHeader className="px-0">
        <ThinkingIndicator
          isStreaming={false}
          label={headerLabel}
          showIcon={false}
          className="p-0 bg-transparent"
        />
      </ThinkingStepsHeader>
      <ThinkingStepsContent>
        {open && (
          <PassiveTraceContent traceParts={traceParts} toolResultByCallId={toolResultByCallId} />
        )}
      </ThinkingStepsContent>
    </ThinkingSteps>
  );
}

// ─── Root AssistantTraceDeck ───────────────────────────────────────────────────

function AssistantTraceDeck({
  traceParts,
  isStreaming,
  activeMessages,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  ...props
}: AssistantTraceDeckProps) {
  if (!traceParts || traceParts.length === 0) return null;

  if (isStreaming) {
    const activePart = traceParts[traceParts.length - 1];
    const toolResult =
      activePart?.type === "toolCall" ? findToolResult(activeMessages, activePart.id) : undefined;

    return (
      <ActiveTraceRow
        activePart={activePart}
        toolResult={toolResult}
        className={className}
        {...props}
      />
    );
  }

  return (
    <PassiveTraceDeck
      traceParts={traceParts}
      activeMessages={activeMessages}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className={className}
      {...props}
    />
  );
}

export { AssistantTraceDeck };
export type { AssistantTraceDeckProps };
