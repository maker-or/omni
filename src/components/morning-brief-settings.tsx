import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ClockIcon,
  KeyIcon,
  NewspaperIcon,
  PlugsConnectedIcon,
  SunHorizonIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  BriefConnection,
  BriefSettingsPatch,
  BriefSettingsView,
} from "../../contracts/brief.ts";

function Row({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[64px] items-center gap-4 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

const Divider = () => <div className="h-px bg-border/70" />;

function KeyField({
  label,
  configured,
  source,
  status: statusOverride,
  onSave,
}: {
  label: string;
  configured: boolean;
  source?: "settings" | "env" | "none";
  status?: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const status =
    statusOverride ??
    (configured
      ? source === "env"
        ? "Using Pipper's built-in key"
        : "Using your key"
      : "Not configured");
  return (
    <Row
      icon={<KeyIcon weight="duotone" className="size-[18px]" />}
      title={label}
      description={status}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving) return;
          setSaving(true);
          void onSave(value.trim())
            .then(() => setValue(""))
            .finally(() => setSaving(false));
        }}
      >
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={configured ? "Replace key…" : "Paste key…"}
          aria-label={label}
          className="w-44 rounded-md bg-surface-3 px-2 py-1.5 text-[12px] text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/60 focus:ring-ring"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!value.trim() || saving}>
          Save
        </Button>
        {source === "settings" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => void onSave("")}
          >
            Reset
          </Button>
        )}
      </form>
    </Row>
  );
}

/** Settings → Morning Brief: schedule, connected tools, and API keys. */
export function MorningBriefSettings() {
  const [settings, setSettings] = useState<BriefSettingsView | null>(null);
  const [connections, setConnections] = useState<BriefConnection[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await window.omni.brief.getSettings());
      setConnections(await window.omni.brief.getConnections());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Morning Brief settings.");
    }
  }, []);

  useEffect(() => {
    void load();
    // Pick up connections completed in the browser while this window was open.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const update = async (patch: BriefSettingsPatch) => {
    try {
      setSettings(await window.omni.brief.updateSettings(patch));
      if ("composioApiKey" in patch) setConnections(await window.omni.brief.getConnections());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  if (!settings) {
    return (
      <div className="px-4 py-3 text-[12px] text-muted-foreground">
        {error ?? "Loading Morning Brief…"}
      </div>
    );
  }

  return (
    <div>
      <Row
        icon={<NewspaperIcon weight="duotone" className="size-[18px]" />}
        title="Daily brief"
        description="Pipper assembles your to-dos, context and one thing it can move forward, every morning."
      >
        <Switch
          label="Daily brief"
          checked={settings.enabled}
          onToggle={() => void update({ enabled: !settings.enabled })}
        />
      </Row>
      <Divider />
      <Row
        icon={<ClockIcon weight="duotone" className="size-[18px]" />}
        title="Scheduled time"
        description="While Pipper is open, a fresh brief is prepared at this time each day."
      >
        <input
          type="time"
          value={settings.scheduleTime}
          disabled={!settings.enabled}
          onChange={(event) => {
            if (event.target.value) void update({ scheduleTime: event.target.value });
          }}
          aria-label="Scheduled time"
          className="rounded-md bg-surface-3 px-2 py-1.5 text-[12px] tabular-nums text-foreground outline-none ring-1 ring-border focus:ring-ring disabled:opacity-50"
        />
      </Row>
      <Divider />
      <Row
        icon={<SunHorizonIcon weight="duotone" className="size-[18px]" />}
        title="Open on first launch"
        description="Show the brief when you open Pipper for the first time each day."
      >
        <Switch
          label="Open on first launch"
          checked={settings.openOnLaunch}
          disabled={!settings.enabled}
          onToggle={() => void update({ openOnLaunch: !settings.openOnLaunch })}
        />
      </Row>
      <Divider />
      {connections.map((connection, index) => (
        <div key={connection.source}>
          <Row
            icon={<PlugsConnectedIcon weight="duotone" className="size-[18px]" />}
            title={connection.label}
            description={
              connection.connected
                ? "Connected through Composio"
                : connection.pending || connecting === connection.source
                  ? "Finish signing in from your browser"
                  : "Not connected"
            }
          >
            {connection.connected ? (
              <span className="text-[11px] font-medium text-emerald-500">Connected</span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={!settings.hasComposioKey || connecting === connection.source}
                onClick={() => {
                  setConnecting(connection.source);
                  void window.omni.brief
                    .connect(connection.source)
                    .catch((err: unknown) =>
                      setError(err instanceof Error ? err.message : "Could not connect."),
                    )
                    .finally(() => setConnecting(null));
                }}
              >
                Connect
              </Button>
            )}
          </Row>
          {index < connections.length - 1 && <Divider />}
        </div>
      ))}
      <Divider />
      <KeyField
        label="Composio API key"
        configured={settings.hasComposioKey}
        source={settings.composioKeySource}
        onSave={(value) => update({ composioApiKey: value })}
      />
      <Divider />
      <KeyField
        label="TypeSafe API key (Jev)"
        configured={settings.hasTypesafeKey}
        source={settings.typesafeKeySource}
        onSave={(value) => update({ typesafeApiKey: value })}
      />
      <Divider />
      <KeyField
        label="Claude API key (optional)"
        configured={settings.hasWriterKey}
        status={
          settings.hasWriterKey
            ? "Brief prose is written with Claude (API key or your local Claude Code)."
            : "Without it, Pipper writes the brief itself from Jev's analysis."
        }
        onSave={(value) => update({ anthropicApiKey: value })}
      />
      {error && <div className="px-4 pb-3 text-[11px] text-red-500">{error}</div>}
    </div>
  );
}
