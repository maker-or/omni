import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CircleNotch,
  GearSix,
  Monitor,
  Moon,
  Rows,
  Sun,
  WarningCircle,
} from "@phosphor-icons/react";
import { RemoteAccessSettings } from "@/components/remote-access-settings";
import { SleeplessControl } from "@/components/sleepless-control";
import { createProviderLogoIcon } from "@/components/provider-logos";
import { Elevated } from "@/lib/elevated";
import type { IconComponent } from "@/lib/icon-context";
import { useTheme, type Theme } from "@/lib/theme";
import { useUiModeStore } from "@/store/ui-mode-store";
import { useAgentRegistryStore } from "@/store/agent-registry-store";
import type { AcpAgentDescriptor } from "../../contracts/acp.ts";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";

function modifierSymbol(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)
    ? "⌘"
    : "Ctrl";
}

const THEME_TABS: Array<{ value: Theme; label: string; icon: IconComponent }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

type SectionId = "appearance" | "agents" | "workspace" | "keyboard" | "power" | "remote";

const NAV_ITEMS: Array<{ id: SectionId; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "agents", label: "Agents" },
  { id: "workspace", label: "Workspace" },
  { id: "keyboard", label: "Keyboard" },
  { id: "power", label: "Power" },
  { id: "remote", label: "Remote" },
];

/**
 * Registry id → anchor on the marketing setup guide (`/docs/agents`).
 * Same mapping as onboarding (`agent-selector.tsx`) so a failed check in
 * Settings links to the same install / sign-in steps.
 */
const SETUP_GUIDE_BASE_URL = "https://www.pipper.dev/docs/agents";

const SETUP_GUIDE_DOC_IDS: Record<string, string> = {
  "cursor-acp": "cursor",
  "codex-acp": "codex",
  "claude-agent-acp": "claude",
  "opencode-acp": "opencode",
  "grok-acp": "grok",
  "gemini-acp": "gemini",
  "copilot-acp": "copilot",
  "antigravity-acp": "antigravity",
  "devin-acp": "devin",
};

function setupGuideUrl(agentId: string): string | null {
  const docId = SETUP_GUIDE_DOC_IDS[agentId];
  return docId ? `${SETUP_GUIDE_BASE_URL}#${docId}` : null;
}

function agentLogoKey(agent: AcpAgentDescriptor): string {
  return agent.icon ?? agent.id ?? agent.name;
}

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: IconComponent;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[76px] items-center gap-4 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-surface-3 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-surface-1">
      {children}
    </span>
  );
}

function AgentCheckStatus({ agentId, displayName }: { agentId: string; displayName: string }) {
  const result = useAgentRegistryStore((s) => s.probeResults[agentId]);
  const probeAgents = useAgentRegistryStore((s) => s.probeAgents);

  const status = result?.status;
  const guideUrl = status === "ready" || status === undefined ? null : setupGuideUrl(agentId);

  const openSetupGuide = async () => {
    if (!guideUrl || !window.omni?.shell?.openExternal) return;
    try {
      await window.omni.shell.openExternal(guideUrl);
    } catch {
      // Link is a convenience — a blocked popup must never break Settings.
    }
  };

  if (!result || status === "probing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CircleNotch size={14} className="animate-spin" aria-label={`Checking ${displayName}`} />
        Checking…
      </span>
    );
  }

  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground">
        <CheckCircleIcon
          size={15}
          weight="fill"
          aria-label={`${displayName} is ready`}
          data-pipper-id={`settings-agent-ready-${agentId}`}
        />
        Ready
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className="inline-flex max-w-[220px] items-center gap-1.5 text-[11px] leading-4 text-amber-500"
        title={result.message ?? undefined}
      >
        <WarningCircle size={14} weight="fill" className="shrink-0" />
        <span className="truncate">
          {status === "needs-auth"
            ? "Sign-in required"
            : status === "needs-install"
              ? "Install required"
              : (result.message ?? "Needs attention")}
        </span>
      </span>
      {guideUrl && (
        <button
          type="button"
          onClick={() => void openSetupGuide()}
          aria-label={`Open setup guide for ${displayName}`}
          data-pipper-id={`settings-agent-guide-${agentId}`}
          className="text-[11px] text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          Setup guide
        </button>
      )}
      <Button
        type="button"
        variant="tertiary"
        size="icon-sm"
        aria-label={`Retry ${displayName} check`}
        title={result.message ?? `Retry ${displayName} check`}
        data-pipper-id={`settings-agent-retry-${agentId}`}
        onClick={() => void probeAgents([agentId])}
      >
        <ArrowsClockwiseIcon size={16} />
      </Button>
    </span>
  );
}

function AgentSettingsRow({ agent }: { agent: AcpAgentDescriptor }) {
  const selected = useAgentRegistryStore((s) => s.selectedAgentIds.includes(agent.id));
  const toggleAgent = useAgentRegistryStore((s) => s.toggleAgent);
  const probeAgents = useAgentRegistryStore((s) => s.probeAgents);
  const BrandIcon = useMemo(
    () => createProviderLogoIcon(agentLogoKey(agent), agent.displayName),
    [agent.id, agent.icon, agent.name, agent.displayName],
  );

  return (
    <div className="flex min-h-[76px] items-center gap-4 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
        <BrandIcon size={18} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{agent.displayName}</div>
        {selected && (
          <div className="mt-1.5">
            <AgentCheckStatus agentId={agent.id} displayName={agent.displayName} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <Switch
          label={selected ? `Disable ${agent.displayName}` : `Enable ${agent.displayName}`}
          checked={selected}
          onToggle={() => {
            void (async () => {
              await toggleAgent(agent.id);
              const nowSelected = useAgentRegistryStore
                .getState()
                .selectedAgentIds.includes(agent.id);
              // Toggling on activates the agent; the handshake check runs in
              // the background so the row flips immediately to Checking….
              if (nowSelected) void probeAgents([agent.id]);
            })();
          }}
          // Hide only the text label (last child span). Do not target the
          // switch root — Base UI renders it as a span too.
          className="gap-0 px-0 py-0 [&>span:last-of-type]:sr-only"
          data-pipper-id={`settings-agent-switch-${agent.id}`}
        />
      </div>
    </div>
  );
}

function AgentsSettingsSection() {
  const agents = useAgentRegistryStore((s) => s.agents);
  const selectedAgentIds = useAgentRegistryStore((s) => s.selectedAgentIds);
  const probeResults = useAgentRegistryStore((s) => s.probeResults);
  const load = useAgentRegistryStore((s) => s.load);
  const probeAgents = useAgentRegistryStore((s) => s.probeAgents);
  const error = useAgentRegistryStore((s) => s.error);
  const probedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void load();
  }, [load]);

  // Background checks: whenever the activated set changes, probe any
  // activated agent we haven't checked yet. Never blocks the toggle.
  useEffect(() => {
    const pending = selectedAgentIds.filter(
      (id) => !probedRef.current.has(id) && probeResults[id]?.status !== "probing",
    );
    if (pending.length === 0) return;
    pending.forEach((id) => probedRef.current.add(id));
    void probeAgents(pending);
  }, [selectedAgentIds, probeResults, probeAgents]);

  const visibleAgents = useMemo(() => {
    const visible = agents.filter((agent) => {
      if (agent.installKind !== "mock") return true;
      const anyReady = agents.some((a) => a.available && a.installKind !== "mock");
      return !anyReady;
    });
    // Activated first, then the rest toggled off — one group.
    return [...visible].sort((a, b) => {
      const aOn = selectedAgentIds.includes(a.id) ? 0 : 1;
      const bOn = selectedAgentIds.includes(b.id) ? 0 : 1;
      return aOn - bOn;
    });
  }, [agents, selectedAgentIds]);

  if (agents.length === 0) {
    return (
      <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70">
        <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
          {error ?? "No ACP agents in the registry."}
        </div>
      </Elevated>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-[11px] leading-4 text-muted-foreground">
        {selectedAgentIds.length > 0 ? (
          <>
            <span className="font-medium text-foreground">{selectedAgentIds.length} activated</span>{" "}
            · checks run in the background after you toggle an agent on
          </>
        ) : (
          "Toggle an agent on to activate it — its check runs in the background."
        )}
      </div>
      <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70">
        <div className="divide-y divide-border/70">
          {visibleAgents.map((agent) => (
            <AgentSettingsRow key={agent.id} agent={agent} />
          ))}
        </div>
      </Elevated>
      {error && (
        <p className="px-1 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const SECTION_META: Record<SectionId, { title: string; blurb: string }> = {
  appearance: {
    title: "Appearance",
    blurb: "Control how Pipper Code looks on your Mac.",
  },
  agents: {
    title: "Agents",
    blurb: "Choose which coding agents Pipper can use.",
  },
  workspace: {
    title: "Workspace",
    blurb: "Shape the layout Pipper opens with.",
  },
  keyboard: {
    title: "Keyboard",
    blurb: "Shortcuts for moving fast around Pipper.",
  },
  power: {
    title: "Power",
    blurb: "Keep agents running when your Mac would rather sleep.",
  },
  remote: {
    title: "Remote access",
    blurb: "Pair your phone to drive Pipper from anywhere.",
  },
};

function AppearanceView() {
  const { theme, setTheme } = useTheme();
  return (
    <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70">
      <SettingRow
        icon={theme === "light" ? Sun : theme === "dark" ? Moon : Monitor}
        title="Theme"
        description="Applies instantly and follows the system when set to System"
      >
        <Tabs value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <TabsList>
            {THEME_TABS.map((t) => (
              <Tooltip key={t.value} content={t.label} side="bottom">
                <TabItem value={t.value} icon={t.icon} label={t.label} iconOnly />
              </Tooltip>
            ))}
          </TabsList>
        </Tabs>
      </SettingRow>
    </Elevated>
  );
}

function WorkspaceView() {
  const { mode, setMode } = useUiModeStore();
  return (
    <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70">
      <SettingRow
        icon={Rows}
        title="Workspace mode"
        description={
          mode === "advanced"
            ? "Advanced layout with the full control panel"
            : "Basic layout with the essentials"
        }
      >
        <Switch
          label={mode === "advanced" ? "Advanced" : "Basic"}
          checked={mode === "advanced"}
          onToggle={() => setMode(mode === "advanced" ? "basic" : "advanced")}
        />
      </SettingRow>
    </Elevated>
  );
}

function KeyboardView() {
  const mod = modifierSymbol();
  return (
    <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70 px-1 py-1">
      <Table>
        <TableBody>
          <TableRow index={0}>
            <TableCell>
              <span className="font-medium text-foreground">Switch tabs</span>
              <span className="mt-0.5 block text-[11px] leading-4">
                From the left of the tab bar, {mod}1 opens the first tab through {mod}9.
              </span>
            </TableCell>
            <TableCell className="w-[1%] text-right whitespace-nowrap">
              <Kbd>
                {mod}1–{mod}9
              </Kbd>
            </TableCell>
          </TableRow>
          <TableRow index={1}>
            <TableCell>
              <span className="font-medium text-foreground">New tab</span>
              <span className="mt-0.5 block text-[11px] leading-4">
                Opens a new thread. The composer stays a draft until you send the first message.
              </span>
            </TableCell>
            <TableCell className="w-[1%] text-right whitespace-nowrap">
              <Kbd>{mod}T</Kbd>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Elevated>
  );
}

function PowerView() {
  return (
    <>
      <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70">
        <SleeplessControl variant="settings" />
      </Elevated>
      <Accordion type="single" collapsible className="mt-2 w-full">
        <AccordionItem value="power-requirements">
          <AccordionTrigger>System requirements</AccordionTrigger>
          <AccordionContent>
            Requires the Sleepless helper and Login Items permission on macOS.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}

function RemoteView() {
  return (
    <>
      <Elevated offset={1} className="overflow-hidden rounded-xl border border-border/70">
        <RemoteAccessSettings />
      </Elevated>
      <Accordion type="single" collapsible className="mt-2 w-full">
        <AccordionItem value="remote-requirements">
          <AccordionTrigger>About pairing tokens</AccordionTrigger>
          <AccordionContent>
            Regenerating the token unpairs all phones — scan the new code to re-link.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}

export function SettingsApp() {
  const [section, setSection] = useState<SectionId>("appearance");
  const meta = SECTION_META[section];

  return (
    <SidebarProvider defaultOpen width="15rem">
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-1 text-foreground">
        <header
          className="flex h-[52px] shrink-0 items-center justify-center border-b border-border/60 bg-surface-2/80 select-none"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
            <GearSix size={16} className="text-muted-foreground" />
            Settings
          </span>
        </header>

        <div className="flex min-h-0 flex-1">
          <Sidebar collapsible="none" rail={false} variant="sidebar" side="left">
            <SidebarHeader>
              <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                Pipper Code
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>General</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {NAV_ITEMS.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={section === item.id}
                          onClick={() => setSection(item.id)}
                        >
                          {item.label}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
              <div className="px-2 pb-1 text-[10px] leading-4 text-muted-foreground/60">
                Small preferences that shape how Pipper Code feels.
              </div>
            </SidebarFooter>
          </Sidebar>

          <SidebarInset className="bg-surface-1">
            <ScrollArea className="h-full min-h-0 flex-1" scrollFade cueSize="tight">
              <main className="mx-auto w-full max-w-[640px] min-w-0 flex-1 px-7 py-8 pb-12">
                <div className="mb-5">
                  <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-foreground">
                    {meta.title}
                  </h1>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{meta.blurb}</p>
                </div>

                {section === "appearance" && <AppearanceView />}
                {section === "agents" && <AgentsSettingsSection />}
                {section === "workspace" && <WorkspaceView />}
                {section === "keyboard" && <KeyboardView />}
                {section === "power" && <PowerView />}
                {section === "remote" && <RemoteView />}
              </main>
            </ScrollArea>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
