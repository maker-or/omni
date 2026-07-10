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
import { Elevated } from "@/lib/elevated";
import { useProjectStore } from "@/store/project-store";
import { useThreadStore } from "@/store/thread-store";
import { useAgentStore } from "@/store/agent-store";
import { useAgentRegistryStore } from "@/store/agent-registry-store";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { AssistantTraceDeck } from "@/components/ui/assistant-trace-deck";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ContextWindowRing } from "@/components/ui/context-window-ring";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import { AgentSlashCommandMenu } from "@/components/agent-slash-command-menu";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { AgentPanelSnapshot } from "@/store/agent-store";
import { stringifyMessageContent, type MessageLike } from "@/lib/message-utils";
import {
  extractGroupedMessageImages,
  fileToPromptImage,
  MAX_AGENT_IMAGES,
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
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";
const iconButtonClass =
  "inline-flex size-6 items-center justify-center rounded-full  text-muted-foreground/60 hover:text-foreground hover:bg-hover transition-colors duration-100 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function formatProviderName(provider: string): string {
  return provider
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getProviderIconKind(provider: string): string {
  const key = provider.toLowerCase();
  if (key.includes("codex")) return "openai-codex";
  if (key.includes("copilot") || key.includes("github")) return "github-copilot";
  if (key.includes("anthropic") || key.includes("claude")) return "anthropic";
  if (key.includes("groq")) return "groq";
  if (key.includes("xai") || key.includes("grok")) return "xai";
  if (key.includes("openrouter")) return "openrouter";
  if (key.includes("opencode")) return "opencode";
  if (key.includes("kimi") || key.includes("moonshot")) return "kimi-coding";
  if (key.includes("openai")) return "openai";
  return "generic";
}

export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  const kind = getProviderIconKind(provider);
  const label = formatProviderName(provider) || "Provider";
  const iconClassName = cn("h-4 w-4 shrink-0", className);

  if (kind === "openai-codex") {
    return (
      <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" fill="none" role="img">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.7381 0.381875C7.54086 0.0519699 8.41467 -0.0670822 9.27643 0.036042C10.3873 0.163542 11.3773 0.636042 12.2464 1.45271C12.2581 1.4638 12.2724 1.47181 12.288 1.47602C12.3035 1.48024 12.3199 1.48053 12.3356 1.47688C13.5089 1.18854 14.6373 1.29021 15.7198 1.78188L15.7723 1.80688L15.9006 1.87021C17.0314 2.45604 17.8423 3.34521 18.3323 4.53521C18.5639 5.10104 18.6806 5.69188 18.6831 6.30688C18.6994 6.76481 18.6489 7.22269 18.5331 7.66604C18.5274 7.68864 18.5275 7.71231 18.5333 7.73488C18.5391 7.75745 18.5505 7.77819 18.5664 7.79521C19.2216 8.4594 19.6772 9.29409 19.8814 10.2044C20.2023 11.7885 19.8731 13.2169 18.8956 14.4877L18.7439 14.671C18.0966 15.4124 17.2468 15.9485 16.2989 16.2135C16.2782 16.2195 16.2593 16.2303 16.2436 16.2451C16.228 16.2599 16.2161 16.2782 16.2089 16.2985C15.9964 16.9119 15.7831 17.4352 15.3864 17.9585C14.3873 19.2769 12.9181 20.0102 11.2631 20.001C9.94393 19.9944 8.77476 19.5119 7.75476 18.5544C7.7393 18.5402 7.72042 18.5303 7.69996 18.5256C7.67951 18.5209 7.65818 18.5216 7.6381 18.5277C7.20643 18.6669 6.77143 18.6869 6.30143 18.6819C5.55055 18.6758 4.81096 18.4985 4.13893 18.1635C3.43551 17.8146 2.82317 17.3064 2.35059 16.6794C2.18143 16.4552 2.01393 16.2444 1.89143 15.9952C1.72248 15.6518 1.58443 15.294 1.47893 14.926C1.25741 14.09 1.25254 13.2112 1.46476 12.3727C1.47162 12.3529 1.4739 12.3318 1.47143 12.311C1.4673 12.2904 1.45646 12.2716 1.44059 12.2577C0.926911 11.7381 0.534239 11.1115 0.290595 10.4227C0.129283 9.99859 0.0356402 9.55174 0.0130947 9.09854C-0.0272048 8.50178 0.0256504 7.90238 0.169761 7.32188C0.544761 6.08521 1.26059 5.11521 2.31726 4.41104C2.55226 4.25438 2.77559 4.13271 2.98559 4.04604C3.22393 3.94604 3.46309 3.86271 3.70309 3.79271C3.72026 3.78762 3.73588 3.77832 3.74855 3.76566C3.76121 3.753 3.7705 3.73737 3.77559 3.72021C3.95759 3.06602 4.27059 2.45562 4.69559 1.92604C5.26226 1.22104 5.9431 0.706042 6.7381 0.381875ZM6.06809 6.92354C5.97505 6.76077 5.82115 6.64162 5.64026 6.59231C5.45936 6.54301 5.26629 6.56758 5.10351 6.66063C4.94073 6.75367 4.82159 6.90757 4.77228 7.08847C4.72298 7.26936 4.74755 7.46243 4.84059 7.62521L6.25226 10.096L4.84559 12.4694C4.75935 12.6302 4.73858 12.8181 4.78762 12.9939C4.83667 13.1697 4.95173 13.3197 5.10877 13.4126C5.26582 13.5056 5.4527 13.5342 5.63038 13.4926C5.80806 13.451 5.9628 13.3424 6.06226 13.1894L7.67893 10.4627C7.74269 10.3552 7.77682 10.2327 7.77784 10.1077C7.77887 9.98265 7.74675 9.8596 7.68476 9.75104L6.06809 6.92354ZM10.6064 12.1235C10.4264 12.1343 10.2572 12.2133 10.1335 12.3446C10.0099 12.4759 9.94097 12.6494 9.94097 12.8298C9.94097 13.0102 10.0099 13.1837 10.1335 13.315C10.2572 13.4463 10.4264 13.5253 10.6064 13.536H14.6464C14.8279 13.5272 14.999 13.4489 15.1244 13.3174C15.2497 13.1858 15.3196 13.0111 15.3196 12.8294C15.3196 12.6477 15.2497 12.4729 15.1244 12.3414C14.999 12.2098 14.8279 12.1315 14.6464 12.1227H10.6064V12.1235Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "openai") {
    return (
      <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" fill="none" role="img">
        <path
          d="M18.6863 8.16932C18.913 7.49711 18.9914 6.78502 18.9163 6.0806C18.8411 5.37617 18.6142 4.69564 18.2506 4.08447C17.1447 2.18901 14.9219 1.21401 12.751 1.67216C12.15 1.01385 11.3835 0.522841 10.5287 0.24846C9.67395 -0.025921 8.76089 -0.0740183 7.88124 0.108998C7.0016 0.292015 6.18635 0.699703 5.51737 1.29112C4.84838 1.88253 4.34922 2.63685 4.07002 3.47832C3.36515 3.62063 2.69925 3.90944 2.11683 4.32544C1.5344 4.74145 1.04887 5.27506 0.692672 5.89062C-0.425297 7.78309 -0.171469 10.1702 1.32025 11.7937C1.09271 12.4656 1.0135 13.1776 1.08794 13.882C1.16238 14.5864 1.38875 15.2671 1.75189 15.8785C2.85923 17.7746 5.08345 18.7495 7.25549 18.2908C7.73304 18.8203 8.31981 19.2433 8.97663 19.5318C9.63346 19.8202 10.3452 19.9673 11.0644 19.9634C13.2895 19.9653 15.2608 18.551 15.9405 16.4649C16.6452 16.3223 17.311 16.0334 17.8934 15.6174C18.4758 15.2014 18.9614 14.6679 19.3177 14.0525C20.4222 12.1635 20.1674 9.78932 18.6863 8.16932ZM11.0644 18.6569C10.1762 18.6582 9.31592 18.3517 8.63431 17.7911L8.75423 17.7242L12.791 15.4299C12.8914 15.3719 12.9748 15.2892 13.033 15.1898C13.0912 15.0905 13.1221 14.9779 13.1227 14.8632V9.25939L14.8294 10.2314C14.8464 10.2399 14.8583 10.256 14.8613 10.2747V14.9183C14.857 16.9812 13.1595 18.6525 11.0644 18.6569ZM2.90298 15.2253C2.45757 14.468 2.29765 13.5804 2.45134 12.7185L2.57119 12.7893L6.61197 15.0836C6.71195 15.1414 6.82577 15.1718 6.9417 15.1718C7.05762 15.1718 7.17144 15.1414 7.27142 15.0836L12.2074 12.2817V14.2218C12.207 14.2318 12.2042 14.2416 12.1994 14.2505C12.1945 14.2594 12.1877 14.267 12.1795 14.2729L8.0908 16.5948C6.27384 17.6254 3.95252 17.0125 2.90298 15.2253ZM1.83978 6.56755C2.28829 5.80541 2.99621 5.2241 3.83822 4.92655V9.64885C3.8367 9.76295 3.86631 9.87536 3.92395 9.97435C3.9816 10.0733 4.06517 10.1553 4.16595 10.2116L9.07798 13.0018L7.37134 13.9738C7.36211 13.9786 7.35183 13.9811 7.34138 13.9811C7.33094 13.9811 7.32065 13.9786 7.31142 13.9738L3.23072 11.656C1.41736 10.6211 0.795485 8.33724 1.83978 6.54793V6.56755ZM15.8606 9.77485L10.9324 6.95716L12.6352 5.98909C12.6444 5.98426 12.6547 5.98173 12.6652 5.98173C12.6756 5.98173 12.6859 5.98426 12.6952 5.98909L16.7759 8.31093C17.3998 8.66541 17.9085 9.18733 18.2424 9.81577C18.5764 10.4442 18.7219 11.1532 18.662 11.86C18.6021 12.5668 18.3392 13.2423 17.904 13.8075C17.4688 14.3727 16.8793 14.8044 16.2043 15.0521V10.3297C16.2008 10.2158 16.1672 10.1048 16.107 10.0075C16.0467 9.91024 15.9618 9.83007 15.8606 9.77485ZM17.5592 7.26024L17.4392 7.18932L13.4065 4.87539C13.3059 4.81728 13.1914 4.78664 13.0748 4.78664C12.9582 4.78664 12.8436 4.81728 12.7431 4.87539L7.81095 7.67739V5.73732C7.8099 5.72745 7.81158 5.71749 7.8158 5.70849C7.82002 5.69949 7.82663 5.69177 7.83494 5.68616L11.9156 3.36824C12.5411 3.01349 13.2561 2.84141 13.9772 2.87212C14.6983 2.90284 15.3956 3.13507 15.9876 3.54167C16.5796 3.94827 17.0417 4.51242 17.32 5.16814C17.5983 5.82387 17.6812 6.54405 17.5591 7.24447V7.26024H17.5592ZM6.87978 10.6996L5.17314 9.73155C5.16461 9.72647 5.15732 9.71961 5.15178 9.71144C5.14625 9.70328 5.1426 9.69402 5.14111 9.68432V5.05255C5.14206 4.342 5.34842 3.6464 5.73608 3.04707C6.12374 2.44775 6.67666 1.96947 7.33022 1.66816C7.98377 1.36684 8.71093 1.25494 9.42669 1.34554C10.1425 1.43614 10.8172 1.7255 11.3721 2.17978L11.2522 2.2467L7.21548 4.54093C7.11503 4.59895 7.03162 4.68171 6.97347 4.78106C6.91531 4.88041 6.8844 4.99295 6.88377 5.10762L6.87978 10.6997V10.6996ZM7.80697 8.73193L10.0052 7.48447L12.2074 8.73201V11.2269L10.0132 12.4745L7.81103 11.2269L7.80697 8.73193Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "github-copilot") {
    return (
      <svg
        aria-label={label}
        className={cn("h-4 w-5 shrink-0", className)}
        viewBox="0 0 25 20"
        fill="none"
        role="img"
      >
        <path
          d="M19.7404 3.01923C21.0865 4.44231 21.6635 6.40385 21.9038 9.13462C22.5385 9.13462 23.1346 9.27885 23.5385 9.82692L24.2885 10.8462C24.5 11.1346 24.6154 11.4808 24.6154 11.8462V14.6058C24.6139 14.7833 24.5715 14.958 24.4914 15.1165C24.4114 15.2749 24.2959 15.4127 24.1538 15.5192C20.7596 18 16.5673 20 12.3077 20C7.59615 20 2.86538 17.2788 0.461538 15.5192C0.319527 15.4127 0.204002 15.2749 0.123952 15.1165C0.0439012 14.958 0.00148389 14.7833 0 14.6058L0 11.8462C0 11.4808 0.115385 11.1346 0.326923 10.8365L1.07692 9.82692C1.48077 9.27885 2.07692 9.13462 2.71154 9.13462C2.95192 6.40385 3.51923 4.44231 4.875 3.01923C7.43269 0.307692 10.8269 0 12.2692 0H12.3077C13.7212 0 17.1538 0.278846 19.7404 3.01923ZM12.3077 7.56731C12.0192 7.56731 11.6827 7.58654 11.3173 7.625C11.2263 8.05529 11.0278 8.45554 10.7404 8.78846C10.3351 9.1892 9.85466 9.50591 9.32663 9.72043C8.7986 9.93494 8.23339 10.043 7.66346 10.0385C7.00962 10.0385 6.32692 9.89423 5.76923 9.53846C5.24038 9.72115 4.73077 9.97115 4.69231 10.5962C4.64423 11.7692 4.63462 12.9519 4.63462 14.1346C4.63462 14.7212 4.63462 15.3173 4.61538 15.9135C4.61538 16.2596 4.82692 16.5769 5.14423 16.7212C7.68269 17.875 10.0962 18.4615 12.3077 18.4615C14.5192 18.4615 16.9231 17.8846 19.4712 16.7212C19.6266 16.6503 19.7588 16.5368 19.8524 16.3938C19.9461 16.2509 19.9972 16.0843 20 15.9135C20.0288 14.1442 20 12.3558 19.9231 10.5962C19.8846 9.96154 19.375 9.72115 18.8462 9.53846C18.2885 9.89423 17.5962 10.0288 16.9519 10.0288C16.3827 10.0347 15.8179 9.92811 15.2899 9.71526C14.7619 9.50241 14.2811 9.18746 13.875 8.78846C13.5876 8.45554 13.3891 8.05529 13.2981 7.625C12.9712 7.58654 12.6346 7.57692 12.3077 7.56731ZM9.71154 11.7981C10.2692 11.7981 10.7212 12.2404 10.7212 12.7981V14.6442C10.7212 14.9094 10.6158 15.1638 10.4283 15.3513C10.2407 15.5389 9.98637 15.6442 9.72115 15.6442C9.45594 15.6442 9.20158 15.5389 9.01405 15.3513C8.82651 15.1638 8.72115 14.9094 8.72115 14.6442V12.7885C8.72115 12.2308 9.16346 11.7885 9.72115 11.7885L9.71154 11.7981ZM14.8462 11.7981C15.4038 11.7981 15.8462 12.2404 15.8462 12.7981V14.6442C15.8462 14.9094 15.7408 15.1638 15.5533 15.3513C15.3657 15.5389 15.1114 15.6442 14.8462 15.6442C14.5809 15.6442 14.3266 15.5389 14.139 15.3513C13.9515 15.1638 13.8462 14.9094 13.8462 14.6442V12.7885C13.8462 12.2308 14.2981 11.7885 14.8462 11.7885V11.7981ZM7.82692 2.72115C6.75 2.82692 5.84615 3.18269 5.38462 3.68269C4.38462 4.76923 4.59615 7.53846 5.17308 8.125C5.74351 8.60002 6.4698 8.84668 7.21154 8.81731C7.86538 8.81731 9.09615 8.67308 10.1058 7.64423C10.5577 7.21154 10.8269 6.13462 10.7981 5.04808C10.7692 4.17308 10.5192 3.44231 10.1538 3.13462C9.75 2.78846 8.84615 2.63462 7.82692 2.72115ZM14.4615 3.13462C14.0962 3.44231 13.8462 4.17308 13.8173 5.04808C13.7885 6.13462 14.0577 7.21154 14.5096 7.64423C14.8879 8.02225 15.338 8.32078 15.8334 8.52224C16.3288 8.7237 16.8595 8.82403 17.3942 8.81731C18.25 8.81731 19.0288 8.53846 19.4423 8.125C20.0192 7.53846 20.2308 4.76923 19.2308 3.67308C18.7692 3.19231 17.8654 2.82692 16.7885 2.72115C15.7692 2.625 14.8654 2.78846 14.4615 3.13462ZM12.3077 5.38462C12.0577 5.38462 11.7692 5.40385 11.4423 5.43269C11.4808 5.59615 11.4904 5.78846 11.5096 5.98077C11.5096 6.125 11.5096 6.26923 11.4904 6.41346C11.7981 6.38462 12.0673 6.38462 12.3077 6.38462C12.5577 6.38462 12.8173 6.38462 13.125 6.41346C13.1058 6.25962 13.1058 6.125 13.1058 5.98077C13.125 5.78846 13.1346 5.59615 13.1731 5.43269C12.8462 5.40385 12.5577 5.38462 12.3077 5.38462Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "anthropic") {
    return (
      <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" role="img">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11.5225 2.93359H14.525L20 16.6669H16.9975L11.5225 2.93359ZM5.47417 2.93359H8.61333L14.0883 16.6669H11.0267L9.9075 13.7828H4.18083L3.06083 16.6661H0L5.475 2.93526L5.47417 2.93359ZM8.9175 11.2328L7.04417 6.40609L5.17083 11.2336H8.91667L8.9175 11.2328Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "groq") {
    return (
      <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" role="img">
        <rect width="20" height="20" rx="4" fill="currentColor" />
        <path
          d="M12.7359 4.87543L12.9245 5.02668C13.5654 5.60061 13.9899 6.41673 14.129 7.26349C14.1386 7.44489 14.1437 7.62648 14.145 7.80817L14.148 8.13125L14.1492 8.47772L14.1509 8.83722C14.1519 9.08817 14.1525 9.33911 14.1529 9.58996C14.1538 9.97205 14.1569 10.3541 14.16 10.7363C14.1607 10.9806 14.1612 11.2249 14.1616 11.4691L14.1654 11.813C14.1621 12.9789 13.8298 13.9852 13.0236 14.8525C12.5707 15.2734 12.1134 15.5861 11.5419 15.8207L11.3044 15.9257C10.3815 16.2595 9.2845 16.1642 8.38111 15.8132C7.88201 15.5764 7.47007 15.2988 7.0643 14.9252C7.43027 14.4748 7.80161 14.09 8.25833 13.7312L8.5631 13.9675C9.11753 14.3613 9.67106 14.486 10.3479 14.4277C11.0404 14.29 11.5872 13.9797 12.0394 13.4326C12.4547 12.7576 12.4961 12.2165 12.4903 11.4332L12.4915 11.0877C12.4918 10.8475 12.491 10.6074 12.4893 10.3672C12.4873 10.001 12.4893 9.63484 12.4919 9.26867C12.4916 9.03454 12.4911 8.80051 12.4903 8.56638L12.4928 8.23683C12.483 7.4412 12.3204 6.9224 11.828 6.29951C11.1528 5.75643 10.524 5.4825 9.64748 5.52419C8.91843 5.6424 8.32629 5.99185 7.87862 6.57902C7.50927 7.16518 7.34887 7.76797 7.46231 8.45752C7.68032 9.20847 7.96171 9.84538 8.65634 10.2486C9.23823 10.5531 9.74012 10.5991 10.3915 10.6155L10.6695 10.6258C10.8939 10.6339 11.1184 10.6404 11.3429 10.6466V12.2386C9.683 12.3056 8.39614 12.3037 7.07902 11.1592C6.25514 10.3337 5.75186 9.21394 5.71484 8.04708C5.75405 7.06499 6.10589 6.26658 6.66629 5.47245L6.83425 5.21742C8.42728 3.53842 10.9499 3.42628 12.7359 4.87543Z"
          fill="var(--surface-3)"
        />
      </svg>
    );
  }

  if (kind === "xai") {
    return (
      <svg
        aria-label={label}
        className={cn("h-4 w-[22px] shrink-0", className)}
        viewBox="0 0 28 20"
        role="img"
      >
        <path
          d="M18.5278 7.12438L18.8042 18.0896H21.0179L21.2946 3.13265L18.5278 7.12438ZM21.2946 1.91406H17.9169L12.6164 9.56156L14.3053 11.9981L21.2946 1.91406ZM6.70508 18.0896H10.0828L11.772 15.6531L10.0828 13.2163L6.70508 18.0896ZM6.70508 7.12438L14.3053 18.0896H17.683L10.0828 7.12438H6.70508Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "openrouter") {
    return (
      <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" role="img">
        <path
          d="M0.117188 9.72267C0.703125 9.72267 2.96875 9.217 4.14062 8.55294C5.3125 7.88888 5.3125 7.88888 7.73438 6.17013C10.8007 3.99408 12.9688 4.72267 16.5234 4.72267"
          stroke="currentColor"
          strokeWidth="3.51562"
        />
        <path d="M19.9609 4.74483L13.9551 8.21233V1.27734L19.9609 4.74483Z" fill="currentColor" />
        <path
          d="M0 9.72656C0.585938 9.72656 2.85156 10.2322 4.02344 10.8963C5.19531 11.5604 5.19531 11.5604 7.61719 13.2791C10.6835 15.4552 12.8516 14.7266 16.4062 14.7266"
          stroke="currentColor"
          strokeWidth="3.51562"
        />
        <path d="M19.8438 14.7057L13.8379 11.2383V18.1732L19.8438 14.7057Z" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "opencode") {
    return (
      <svg
        aria-label={label}
        className={cn("h-4 w-[13px] shrink-0", className)}
        viewBox="0 0 16 20"
        role="img"
      >
        <path d="M12 8V16H4V8H12Z" fill="var(--surface-4)" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M16 20H0V0H16V20ZM12 4H4V16H12V4Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "kimi-coding") {
    return (
      <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" role="img">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M19.6484 4.46484V15.4023C19.6484 17.7739 17.723 19.6992 15.3516 19.6992H4.41406C2.04254 19.6992 0.117188 17.7739 0.117188 15.4023V4.46484C0.117188 2.09336 2.04254 0.167969 4.41406 0.167969H15.3516C17.723 0.167969 19.6484 2.09336 19.6484 4.46484Z"
          fill="currentColor"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M13.3623 7.41301C13.436 7.31848 13.5006 7.23215 13.5689 7.14855C13.6005 7.10922 13.5978 7.07937 13.5671 7.03824C13.271 6.64898 13.243 6.21683 13.4134 5.77832C13.5413 5.44832 13.8243 5.29371 14.1701 5.26074C14.3858 5.24039 14.5973 5.26254 14.7935 5.36738C15.0512 5.50527 15.2013 5.71551 15.2501 6.0057C15.289 6.23719 15.2817 6.4632 15.2162 6.68742C15.1 7.08433 14.8148 7.29004 14.4237 7.34203C14.0991 7.38539 13.7701 7.39086 13.4428 7.41301C13.4175 7.4148 13.3917 7.41301 13.3623 7.41301Z"
          fill="var(--surface-3)"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12.5591 5.63672H10.6034L9.05512 9.16734H6.86621V5.65211H5.11719V14.7485H6.86668V10.9164H9.95156C10.4827 10.9164 10.9678 10.6067 11.1916 10.1253V14.7485H12.9411V10.9164C12.9411 10.0046 12.2286 9.23785 11.3191 9.17141V9.16688H10.3584C10.5899 9.08784 10.8026 8.96196 10.9833 8.79707C11.164 8.63218 11.3087 8.43183 11.4086 8.20852L12.5591 5.63672Z"
          fill="var(--surface-3)"
        />
      </svg>
    );
  }

  return (
    <svg aria-label={label} className={iconClassName} viewBox="0 0 20 20" role="img">
      <path
        d="M4.25 10C4.25 6.82436 6.82436 4.25 10 4.25C13.1756 4.25 15.75 6.82436 15.75 10C15.75 13.1756 13.1756 15.75 10 15.75C6.82436 15.75 4.25 13.1756 4.25 10Z"
        fill="currentColor"
      />
      <path d="M10 1.75L11.85 5.5H8.15L10 1.75Z" fill="currentColor" />
      <path d="M10 18.25L8.15 14.5H11.85L10 18.25Z" fill="currentColor" />
    </svg>
  );
}

function hasTraceParts(messages: MessageLike[]): boolean {
  return messages.some((message) => {
    const content = (message as unknown as { content?: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some((part) => part && (part.type === "thinking" || part.type === "toolCall"))
    );
  });
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

export function getMessageStructureKey(message: MessageLike): string {
  const content = (message as unknown as { content?: unknown }).content;
  if (!Array.isArray(content)) return stringifyMessageContent(message).length.toString();
  return content
    .map((part, index) => {
      if (!part || typeof part !== "object") return `${index}:empty`;
      const typed = part as {
        type?: string;
        id?: string;
        name?: string;
        toolCallId?: string;
        text?: string;
        thinking?: string;
      };
      return [
        index,
        typed.type ?? "unknown",
        typed.id ?? "",
        typed.toolCallId ?? "",
        typed.name ?? "",
        typed.text?.length ?? 0,
        typed.thinking?.length ?? 0,
      ].join("/");
    })
    .join("|");
}

export interface GroupedMessageEntry {
  key: string;
  role: "user" | "assistant";
  messages: MessageLike[];
  originalIndex: number;
  isStreaming: boolean;
}

export function groupConversationMessages(
  activeMessages: MessageLike[],
  streamingMessage: MessageLike | null,
): GroupedMessageEntry[] {
  const rawEntries = activeMessages
    .map((message, index) => ({
      message,
      originalIndex: index,
      isStreaming: false,
    }))
    .filter(({ message }) => message.role === "user" || message.role === "assistant");

  if (streamingMessage) {
    rawEntries.push({
      message: streamingMessage,
      originalIndex: activeMessages.length,
      isStreaming: true,
    });
  }

  const grouped: GroupedMessageEntry[] = [];
  let lastUserIndex: number | null = null;

  for (const entry of rawEntries) {
    const lastGroup = grouped[grouped.length - 1];
    const role = entry.message.role === "user" ? "user" : "assistant";
    const groupKey =
      role === "user"
        ? `user-${entry.originalIndex}`
        : lastUserIndex == null
          ? "assistant-start"
          : `assistant-after-${lastUserIndex}`;

    if (lastGroup && lastGroup.role === role) {
      lastGroup.messages.push(entry.message);
      if (entry.isStreaming) {
        lastGroup.isStreaming = true;
      }
    } else {
      grouped.push({
        key: groupKey,
        role,
        messages: [entry.message],
        originalIndex: entry.originalIndex,
        isStreaming: entry.isStreaming,
      });
    }

    if (role === "user") {
      lastUserIndex = entry.originalIndex;
    }
  }

  return grouped;
}

export function buildConversationScrollKey(
  threadId: string,
  allMessages: GroupedMessageEntry[],
  isStreaming: boolean,
): string {
  const latest = allMessages[allMessages.length - 1];
  if (!latest) return `${threadId}:empty:${isStreaming}`;

  const lastMessage = latest.messages[latest.messages.length - 1];
  return [
    threadId,
    allMessages.length,
    isStreaming ? "streaming" : "settled",
    latest.role ?? "unknown",
    stringifyMessageContent(lastMessage).length,
    latest.messages.map(getMessageStructureKey).join(","),
  ].join(":");
}

function MessageBody({
  messages,
  isStreaming = false,
  activeMessages = [],
  traceDeckOpen,
  onTraceDeckOpenChange,
}: {
  messages: MessageLike[];
  isStreaming?: boolean;
  activeMessages?: MessageLike[];
  traceDeckOpen?: boolean;
  onTraceDeckOpenChange?: (open: boolean) => void;
}) {
  const role = messages[0]?.role;

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
            open={traceDeckOpen}
            defaultOpen={isStreaming}
            onOpenChange={onTraceDeckOpenChange}
          />
        )}

        {textBodyCombined.trim() && (
          <div className="prose prose-sm max-w-none prose-neutral dark:prose-invert">
            <MarkdownRenderer isStreaming={isStreaming}>{textBodyCombined}</MarkdownRenderer>
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

const ANSI_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");

function cleanRuntimeStatusText(text: string | null | undefined): string | null {
  const cleaned = text?.replace(ANSI_PATTERN, "").trim();
  return cleaned ? cleaned : null;
}

export function getRuntimeStatusItems(snapshot: AgentPanelSnapshot | null): string[] {
  if (!snapshot) return [];

  const items: string[] = [];
  if (snapshot.authRequiredMessage) items.push(snapshot.authRequiredMessage);
  if (snapshot.switchingAgent) items.push("Switching agent…");
  if (snapshot.workingVisible) {
    const workingMessage = cleanRuntimeStatusText(snapshot.workingMessage);
    if (workingMessage) items.push(workingMessage);
  }

  for (const value of Object.values(snapshot.status)) {
    const statusText = cleanRuntimeStatusText(value);
    if (statusText) items.push(statusText);
  }

  const hiddenThinkingLabel = cleanRuntimeStatusText(snapshot.hiddenThinkingLabel);
  if (hiddenThinkingLabel && snapshot.isStreaming) items.push(`Thinking: ${hiddenThinkingLabel}`);
  const editorText = cleanRuntimeStatusText(snapshot.editorText);
  if (editorText) items.push(`Draft: ${editorText}`);
  if (snapshot.isCompacting) items.push("Compacting");
  if (snapshot.isRetrying) items.push("Retrying");

  return items.filter((item, index, all) => all.indexOf(item) === index);
}

export function AgentPanel() {
  "use no memo";
  const queryClient = useQueryClient();
  const { activeProject } = useProjectStore();
  const {
    threads,
    pagesByProject,
    loadProjectThreads,
    renameThread,
    deleteThread,
    error: threadError,
  } = useThreadStore();
  const {
    snapshot,
    error: agentError,
    isConnecting,
    uiRequest,
    connect,
    refresh,
    sendPrompt,
    replacePrompt,
    abort,
    switchThread,
    createThread,
    respondToUiRequest,
    setModel,
    cycleThinkingLevel,
    canAttachImage,
  } = useAgentStore();
  const showImageAttach = canAttachImage();
  const [projectsList, setProjectsList] = useState<
    Array<{ id: string; name: string; icon: string }>
  >([]);
  const [inputValue, setInputValue] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [isRuntimeActionPending, setIsRuntimeActionPending] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [streamingBehavior, setStreamingBehavior] = useState<"followUp" | "steer">("followUp");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [editState, setEditState] = useState<{
    targetEntryId: string;
    images: ChatImageAttachment[];
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<ChatImageAttachment | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [pendingCreateProjectId, setPendingCreateProjectId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [dismissedAgentError, setDismissedAgentError] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [editingThreadOriginalTitle, setEditingThreadOriginalTitle] = useState("");
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [traceDeckOpenByKey, setTraceDeckOpenByKey] = useState<Record<string, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectListRef = useRef<HTMLDivElement>(null);
  const threadPaneRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const autoScrollPinnedRef = useRef(true);
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
        onClick={() => void handleCopy(msgId, bodyText)}
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

  const handleCopy = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(msgId);
      setTimeout(() => {
        setCopiedMessageId((prev) => (prev === msgId ? null : prev));
      }, 2000);
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Copy failed",
        description: err instanceof Error ? err.message : "Clipboard access was denied.",
      });
    }
  };

  const handleRegenerate = async (currentIndex: number) => {
    try {
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
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Regenerate failed",
        description: err instanceof Error ? err.message : "The agent did not accept the request.",
      });
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
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Rename failed",
        description: useThreadStore.getState().error ?? "The thread title was not updated.",
      });
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
    void useAgentRegistryStore.getState().load();
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
    setModelSearch("");
  }, [isModelDropdownOpen]);

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
      const gap = 8;
      const paneWidth = 320;
      const paneHeight = 420;
      const canFitRight = rect.right + gap + paneWidth <= window.innerWidth - gap;
      const left = canFitRight ? rect.right + gap : Math.max(gap, rect.left - paneWidth - gap);
      const top = Math.min(
        Math.max(gap, rect.top),
        Math.max(gap, window.innerHeight - paneHeight - gap),
      );
      setThreadPaneStyle({
        position: "fixed",
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
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
    if (!uiRequest?.timeoutMs) return;
    const timeout = window.setTimeout(() => {
      void respondToUiRequest({
        requestId: uiRequest.id,
        value: uiRequest.kind === "confirm" ? false : undefined,
      });
    }, uiRequest.timeoutMs + 250);
    return () => window.clearTimeout(timeout);
  }, [respondToUiRequest, uiRequest]);

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
    if (agentError && snapshot?.threadId) {
      setActiveTabId(snapshot.threadId);
    }
  }, [agentError, snapshot?.threadId]);

  useEffect(() => {
    if (requestedThreadId && snapshot?.threadId === requestedThreadId) {
      setRequestedThreadId(null);
    }
  }, [requestedThreadId, snapshot?.threadId]);

  useEffect(() => {
    if (requestedThreadId && agentError) {
      setRequestedThreadId(null);
    }
  }, [agentError, requestedThreadId]);

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

  const allMessages = useMemo(
    () =>
      groupConversationMessages(
        activeMessages as MessageLike[],
        streamingMessage as MessageLike | null,
      ),
    [activeMessages, streamingMessage],
  );

  const streamingTraceKey = useMemo(
    () =>
      allMessages.find(
        (entry) => entry.role === "assistant" && entry.isStreaming && hasTraceParts(entry.messages),
      )?.key ?? null,
    [allMessages],
  );

  useEffect(() => {
    if (!streamingTraceKey) return;
    setTraceDeckOpenByKey((current) =>
      current[streamingTraceKey] === undefined
        ? { ...current, [streamingTraceKey]: true }
        : current,
    );
  }, [streamingTraceKey]);

  const conversationVirtualizer = useVirtualizer({
    count: allMessages.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: (index) => (allMessages[index]?.role === "user" ? 96 : 180),
    getItemKey: (index) => allMessages[index]?.key ?? index,
    overscan: 6,
  });

  const latestConversationScrollKey = useMemo(
    () => buildConversationScrollKey(threadId, allMessages, isStreaming),
    [allMessages, isStreaming, threadId],
  );

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;

    const updatePinnedState = () => {
      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      autoScrollPinnedRef.current = distanceFromBottom <= 120;
    };

    updatePinnedState();
    scrollContainer.addEventListener("scroll", updatePinnedState, {
      passive: true,
    });
    return () => scrollContainer.removeEventListener("scroll", updatePinnedState);
  }, [threadId]);

  useEffect(() => {
    autoScrollPinnedRef.current = true;
  }, [threadId]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [threadId]);

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;

    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    const shouldScroll =
      !isStreaming ||
      autoScrollPinnedRef.current ||
      distanceFromBottom <= 120 ||
      allMessages.length === 0;
    if (!shouldScroll) return;

    if (!isStreaming) {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      requestAnimationFrame(() => {
        const el = messagesScrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        autoScrollPinnedRef.current = true;
      });
      return;
    }

    if (scrollRafRef.current !== null) return;

    function tick() {
      const el = messagesScrollRef.current;
      if (!el || !autoScrollPinnedRef.current) {
        scrollRafRef.current = null;
        return;
      }

      const dest = el.scrollHeight - el.clientHeight;
      const delta = dest - el.scrollTop;
      if (Math.abs(delta) <= 0.5) {
        el.scrollTop = dest;
        scrollRafRef.current = null;
        return;
      }

      el.scrollTop += delta * 0.2;
      scrollRafRef.current = requestAnimationFrame(tick);
    }

    scrollRafRef.current = requestAnimationFrame(tick);
  }, [latestConversationScrollKey, isStreaming, allMessages.length]);

  const handleSelectThread = async (id: string) => {
    setActiveTabId(id);
    if (id === snapshot?.threadId) return;
    setRequestedThreadId(id);
    await switchThread(id);
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
      setIsSubmitting(true);
      try {
        await abort();
        setInputValue("");
      } catch (err) {
        toast({
          icon: <WarningIcon className="size-5 text-red-500" />,
          title: "Abort failed",
          description: err instanceof Error ? err.message : "The agent did not stop.",
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    // Hardcoded /compact removed — agents advertise commands via available_commands_update.
    const operationThreadId = snapshot?.threadId;
    setIsSubmitting(true);
    try {
      const newImages = await Promise.all(files.map(fileToPromptImage));
      const retained = (editState?.images ?? []).map(({ type, data, mimeType }) => ({
        type,
        data,
        mimeType,
      }));
      const images = [...retained, ...newImages];
      if (images.length > MAX_AGENT_IMAGES) {
        toast({
          icon: <WarningIcon className="size-5 text-red-500" />,
          title: "Attachment rejected",
          description: `A prompt can contain at most ${MAX_AGENT_IMAGES} images.`,
        });
        return;
      }
      if (editState && operationThreadId)
        await replacePrompt({
          threadId: operationThreadId,
          targetUserEntryId: editState.targetEntryId,
          message: trimmed,
          images,
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
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: editState ? "Edit failed" : "Send failed",
        description: err instanceof Error ? err.message : "The agent did not accept the message.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFilesChange = (files: File[]) => {
    const { valid, errors } = partitionValidImageFiles(files, editState?.images.length ?? 0);
    setAttachedFiles(valid);
    if (errors.length)
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Attachment rejected",
        description: errors.join(" "),
      });
  };

  const handleFilesRejected = (files: File[], reason: "type" | "limit") => {
    const description =
      reason === "type"
        ? `${files.length} file${files.length === 1 ? "" : "s"} did not match the supported image types.`
        : `A prompt can contain at most ${MAX_AGENT_IMAGES} images.`;
    toast({
      icon: <WarningIcon className="size-5 text-red-500" />,
      title: "Attachment rejected",
      description,
    });
  };

  const handleAbort = async () => {
    if (isAborting) return;
    setIsAborting(true);
    try {
      await abort();
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Stop failed",
        description: err instanceof Error ? err.message : "The agent did not stop.",
      });
    } finally {
      setIsAborting(false);
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    if (thread.id === snapshot?.threadId && isStreaming) return;
    if (!window.confirm(`Permanently delete “${thread.title}” and its session history?`)) return;
    try {
      await deleteThread(thread.id);
      queryClient.setQueriesData<ThreadPage>(
        { queryKey: ["project-threads", thread.project_id] },
        (current) => {
          if (!current) return current;
          const hadThread = current.threads.some((item) => item.id === thread.id);
          return {
            ...current,
            threads: current.threads.filter((item) => item.id !== thread.id),
            nextOffset: hadThread ? Math.max(0, current.nextOffset - 1) : current.nextOffset,
          };
        },
      );
      queryClient.setQueryData<OpenTabsState & { openThreads: Thread[] }>(
        OPEN_TABS_QUERY_KEY,
        (current) => {
          if (!current) return current;
          const openThreadIds = current.openThreadIds.filter((id) => id !== thread.id);
          const openThreads = current.openThreads.filter((item) => item.id !== thread.id);
          return {
            ...current,
            openThreadIds,
            openThreads,
            activeThreadId:
              current.activeThreadId === thread.id
                ? (openThreadIds[0] ?? null)
                : current.activeThreadId,
          };
        },
      );
      setIsDropdownOpen(false);
      await queryClient.invalidateQueries({ queryKey: OPEN_TABS_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ["project-threads", thread.project_id],
      });
      const state = await window.omni.tabs.listOpen();
      if (state.activeThreadId) await handleSelectThread(state.activeThreadId);
      else setActiveTabId(null);
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Delete failed",
        description: err instanceof Error ? err.message : "The thread was not deleted.",
      });
    }
  };

  const applyCommand = (commandName: string) => {
    setInputValue(`/${commandName} `);
  };

  const formatThreadRecency = (timestamp: number) => {
    const time = typeof timestamp === "number" ? timestamp : Number(timestamp);
    if (Number.isNaN(time)) return "Unknown";

    const diffMs = Math.max(0, Date.now() - time);
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
    return Date.now() - fallbackDaysAgo * 24 * 60 * 60 * 1000;
  };

  const handleCreateThread = async (agentId?: string | null) => {
    const projectId = pendingCreateProjectId ?? hoveredProjectId ?? activeProject?.id;
    if (!projectId || isCreatingThread) return;
    const project = projectsList.find((item) => item.id === projectId);
    const nextCount = threads.filter((thread) => thread.project_id === projectId).length + 1;
    const title = `${project?.name ?? "Thread"} #${nextCount}`;
    setIsCreatingThread(true);
    setPendingCreateProjectId(null);
    setShowAgentPicker(false);
    try {
      const thread = await createThread(projectId, title, snapshot?.threadId ?? null, agentId ?? null);
      await loadProjectThreads(projectId, { reset: true });
      await handleSelectThread(thread.id);
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Create thread failed",
        description: err instanceof Error ? err.message : "The thread was not created.",
      });
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleRequestCreateThread = () => {
    const projectId = hoveredProjectId ?? activeProject?.id;
    if (!projectId || isCreatingThread) return;
    const registryAgents = useAgentRegistryStore.getState().agents;
    const selectedIds = useAgentRegistryStore.getState().selectedAgentIds;
    const availableAgents = registryAgents.filter(
      (a) => selectedIds.includes(a.id) && a.available,
    );
    if (availableAgents.length === 0) {
      toast({
        icon: <WarningIcon className="size-5 text-amber-500" />,
        title: "No agents selected",
        description: "Select a coding agent in the launch window first.",
      });
      return;
    }
    setPendingCreateProjectId(projectId);
    setShowAgentPicker(true);
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
  const hoveredThreadsHasMore = hoveredThreadPage
    ? hoveredThreadPage.hasMore
    : Boolean(hoveredProjectThreadsQuery.data?.hasMore);
  const runtimeStatusItems = useMemo(() => getRuntimeStatusItems(snapshot), [snapshot]);
  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models.filter(
      (model) =>
        !query ||
        String(model.name ?? "")
          .toLowerCase()
          .includes(query) ||
        String(model.modelId ?? "")
          .toLowerCase()
          .includes(query) ||
        formatProviderName(model.provider).toLowerCase().includes(query),
    );
  }, [modelSearch, models]);
  const visibleModelCount = visibleModels.length;
  const selectedModelProvider = snapshot?.model?.provider;
  const currentProject = projectsList.find((p) => p.id === snapshot?.projectId) || activeProject;
  const emptyStateSubject = currentProject?.name ?? "your project";
  const visibleAgentError = agentError && agentError !== dismissedAgentError ? agentError : null;
  const runtimeControlsDisabled =
    isRuntimeActionPending || isSwitchingThread || isConnecting || !snapshot;
  const composerDisabled =
    isSwitchingThread ||
    isConnecting ||
    !snapshot ||
    isSubmitting ||
    Boolean(editState && isStreaming);

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
                const agentLabel = thread.agent_id
                  ? (thread.agent_id.split("@")[0] ?? thread.agent_id)
                  : null;
                const tabTitle = thread.title ?? "New thread";
                const labelWithAgent = agentLabel ? `${tabTitle} · ${agentLabel}` : tabTitle;
                return (
                  <TabItem
                    key={thread.id}
                    value={thread.id}
                    label={labelWithAgent}
                    icon={Icon}
                    onClose={() => handleCloseThreadTab(thread.id)}
                    editing={isEditing}
                    editValue={isEditing ? editingThreadTitle : tabTitle}
                    onEditValueChange={setEditingThreadTitle}
                    onEditCommit={commitRenameThread}
                    onEditCancel={cancelRenameThread}
                    onDoubleClick={() => startRenameThread(thread.id, tabTitle)}
                    data-pipper-id={`thread-tab-${thread.id}`}
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
                        className="w-80 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-surface-1 shadow-surface-5 p-2"
                        ref={threadPaneRef}
                        style={threadPaneStyle}
                      >
                        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Threads
                        </div>
                        <div className="flex flex-col gap-1">
                          {threadError && (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-[12px] text-red-500">
                              {threadError}
                            </div>
                          )}
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
                              void loadProjectThreads(hoveredProjectId).then(() => {
                                const nextError = useThreadStore.getState().error;
                                if (nextError) {
                                  toast({
                                    icon: <WarningIcon className="size-5 text-red-500" />,
                                    title: "Threads failed to load",
                                    description: nextError,
                                  });
                                }
                              });
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
                            disabled={isCreatingThread}
                            onClick={async () => {
                              setIsDropdownOpen(false);
                              handleRequestCreateThread();
                            }}
                          >
                            {isCreatingThread ? "Creating..." : "Create new thread"}
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
                            title={
                              messages.length > 1
                                ? "Grouped messages cannot be edited together"
                                : "Edit message"
                            }
                            className={iconButtonClass}
                            disabled={
                              isStreaming ||
                              isSubmitting ||
                              messages.length > 1 ||
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
                              traceDeckOpen={traceDeckOpenByKey[msgId] ?? isStreaming}
                              onTraceDeckOpenChange={(open) =>
                                setTraceDeckOpenByKey((current) => ({
                                  ...current,
                                  [msgId]: open,
                                }))
                              }
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
              {visibleAgentError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                  <WarningIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{visibleAgentError}</span>
                  <button
                    type="button"
                    className="shrink-0 text-red-500/80 hover:text-red-500"
                    onClick={() => setDismissedAgentError(visibleAgentError)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {isConnecting && (
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted-foreground">
                  Connecting to agent runtime...
                </div>
              )}
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
                {snapshot?.plan && snapshot.plan.length > 0 && isStreaming ? (
                  <div
                    data-pipper-id="plan-popover"
                    className="absolute right-0 bottom-full mb-1.5 z-[240] w-[280px]"
                  >
                    <Elevated
                      offset={2}
                      shadowLevel={4}
                      className="rounded-xl border border-border/80 p-2"
                    >
                      <div className="px-1.5 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Plan
                      </div>
                      <ul className="flex flex-col gap-1">
                        {snapshot.plan.map((entry, index) => (
                          <li
                            key={`${entry.content}-${index}`}
                            className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-[12px] text-foreground"
                          >
                            <span className="mt-0.5 size-3.5 shrink-0 text-muted-foreground">
                              {entry.status === "completed" ? (
                                <ModelCheckIcon size={14} className="text-emerald-500" />
                              ) : (
                                <span className="inline-block size-2.5 rounded-full border border-border" />
                              )}
                            </span>
                            <span
                              className={
                                entry.status === "completed"
                                  ? "text-muted-foreground line-through"
                                  : undefined
                              }
                            >
                              {entry.content}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Elevated>
                  </div>
                ) : null}
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
                  placeholder={isConnecting ? "Connecting to agent runtime..." : "Type here"}
                  onSend={handleSend}
                  disabled={composerDisabled}
                  canSendWhenEmpty={Boolean(editState?.images.length)}
                  files={attachedFiles}
                  onFilesChange={handleFilesChange}
                  onFilesRejected={handleFilesRejected}
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  maxFiles={Math.max(0, MAX_AGENT_IMAGES - (editState?.images.length ?? 0))}
                  isStreaming={isStreaming}
                  onStop={() => void handleAbort()}
                  isStopping={isAborting}
                  sendLabel={isSubmitting ? "Sending" : "Send"}
                  leftSlot={({ openFilePicker }) =>
                    showImageAttach ? (
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
                    ) : null
                  }
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
                      {" "}
                      {snapshot?.thinkingLevel !== undefined &&
                        snapshot?.thinkingLevel !== null && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={runtimeControlsDisabled}
                            onClick={async () => {
                              if (runtimeControlsDisabled) return;
                              setIsRuntimeActionPending(true);
                              try {
                                await cycleThinkingLevel();
                              } catch (err) {
                                toast({
                                  icon: <WarningIcon className="size-5 text-red-500" />,
                                  title: "Reasoning level failed",
                                  description:
                                    err instanceof Error
                                      ? err.message
                                      : "The reasoning level was not changed.",
                                });
                              } finally {
                                setIsRuntimeActionPending(false);
                              }
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
                        disabled={models.length === 0 || runtimeControlsDisabled}
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setIsModelDropdownOpen((prev) => !prev);
                        }}
                      >
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          {selectedModelProvider && (
                            <ProviderMark
                              provider={selectedModelProvider}
                              className="h-3.5 w-3.5 opacity-85"
                            />
                          )}
                          <span className="truncate">{modelName}</span>
                        </span>
                      </Button>
                      {isModelDropdownOpen && models.length > 0 && (
                        <div
                          data-pipper-id="model-dropdown"
                          className="absolute right-0 bottom-full mb-1.5 z-[250]"
                        >
                          <Elevated
                            offset={2}
                            shadowLevel={5}
                            className="flex h-[360px] w-[320px] flex-col overflow-hidden rounded-xl border border-border/80 p-1.5"
                          >
                            <label className="flex h-9 shrink-0 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground">
                              <MagnifyingGlassIcon size={14} />
                              <input
                                value={modelSearch}
                                onChange={(event) => setModelSearch(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") setIsModelDropdownOpen(false);
                                }}
                                placeholder="Find a model"
                                aria-label="Find a model"
                                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
                                autoFocus
                              />
                            </label>
                            <div className="mx-2 border-t border-border/60" />
                            <div className="min-h-0 flex-1 overflow-y-auto py-1">
                              {visibleModels.map((model) => {
                                const isSelected =
                                  model.provider === snapshot?.model?.provider &&
                                  model.modelId === snapshot?.model?.modelId;
                                const providerLabel = formatProviderName(model.provider);
                                return (
                                  <button
                                    type="button"
                                    key={`${model.provider}:${model.modelId}`}
                                    aria-label={`${model.name}, ${providerLabel}`}
                                    title={`${model.name} · ${providerLabel}`}
                                    disabled={isRuntimeActionPending}
                                    className={cn(
                                      "group/model-row flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
                                      isSelected
                                        ? "bg-accent text-foreground"
                                        : "text-muted-foreground hover:bg-hover hover:text-foreground",
                                      isRuntimeActionPending && "opacity-50",
                                    )}
                                    onClick={async () => {
                                      if (isRuntimeActionPending) return;
                                      setIsRuntimeActionPending(true);
                                      try {
                                        const success = await setModel({
                                          provider: model.provider,
                                          modelId: model.modelId,
                                        });
                                        if (success) {
                                          setIsModelDropdownOpen(false);
                                        } else {
                                          toast({
                                            icon: <WarningIcon className="size-5 text-red-500" />,
                                            title: "Model change failed",
                                            description: "The selected model was not applied.",
                                          });
                                        }
                                      } catch (err) {
                                        toast({
                                          icon: <WarningIcon className="size-5 text-red-500" />,
                                          title: "Model change failed",
                                          description:
                                            err instanceof Error
                                              ? err.message
                                              : "The selected model was not applied.",
                                        });
                                      } finally {
                                        setIsRuntimeActionPending(false);
                                      }
                                    }}
                                  >
                                    <span
                                      className={cn(
                                        "flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                                        isSelected
                                          ? "border-border/70 bg-surface-4 text-foreground"
                                          : "border-transparent bg-transparent text-muted-foreground/70 group-hover/model-row:bg-surface-3 group-hover/model-row:text-foreground",
                                      )}
                                    >
                                      <ProviderMark provider={model.provider} />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">{model.name}</span>
                                    {isSelected && (
                                      <ModelCheckIcon
                                        className="shrink-0"
                                        size={13}
                                        weight="bold"
                                      />
                                    )}
                                  </button>
                                );
                              })}
                              {visibleModelCount === 0 && (
                                <div className="flex h-24 items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
                                  No matching models
                                </div>
                              )}
                            </div>
                          </Elevated>
                        </div>
                      )}
                    </div>
                  }
                />
              </div>

              <div
                data-pipper-id="stats-bar"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {runtimeStatusItems.map((item) => (
                    <span
                      key={item}
                      className="max-w-[260px] truncate rounded-md border border-border/60 bg-surface-2 px-2 py-1"
                      title={item}
                    >
                      {item}
                    </span>
                  ))}
                </div>
                {snapshot?.stats && (
                  <div className="ml-auto flex w-full items-center justify-between gap-2">
                    <ContextWindowRing
                      contextUsage={snapshot.stats.contextUsage}
                      contextWindowFallback={snapshot.model?.contextWindow}
                      modelName={snapshot.model?.name}
                      autoCompactionEnabled={snapshot.autoCompactionEnabled}
                      sessionTokens={snapshot.stats.tokens.total}
                      sessionCost={snapshot.stats.cost}
                    />
                    {snapshot.stats.cost > 0 && (
                      <span className="tabular-nums opacity-70">
                        (${snapshot.stats.cost.toFixed(4)})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Tabs>

      {showAgentPicker && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[300] flex items-center justify-center"
              onClick={() => {
                setShowAgentPicker(false);
                setPendingCreateProjectId(null);
              }}
            >
              <div className="absolute inset-0 bg-black/30" />
              <div
                className="relative z-10 w-72 rounded-xl border border-border bg-surface-1 shadow-surface-5 p-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Pick an agent for this thread
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  {useAgentRegistryStore
                    .getState()
                    .agents.filter(
                      (a) =>
                        useAgentRegistryStore.getState().selectedAgentIds.includes(a.id) &&
                        a.available,
                    )
                    .map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
                        onClick={() => {
                          void handleCreateThread(agent.id);
                        }}
                      >
                        <span className="flex-1 font-medium">{agent.displayName}</span>
                        <span className="text-[11px] text-muted-foreground">{agent.name}</span>
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  className="mt-1 w-full rounded-lg px-2 py-1.5 text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setShowAgentPicker(false);
                    setPendingCreateProjectId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
