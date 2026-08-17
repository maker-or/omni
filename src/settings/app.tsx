import { Keyboard, Monitor, Moon, Sun } from "lucide-react";
import { SleeplessControl } from "@/components/sleepless-control";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTheme, type Theme } from "@/lib/theme";

function modifierSymbol(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)
    ? "⌘"
    : "Ctrl";
}

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Sun;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[76px] items-center gap-4 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
        <Icon className="size-[18px]" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function SettingsApp() {
  const { theme } = useTheme();
  const ThemeIcon = THEME_ICONS[theme];

  return (
    <div className="min-h-screen bg-surface-1 text-foreground">
      <header
        className="flex h-[52px] items-center justify-center border-b border-border/60 bg-surface-2/80 select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          Settings
        </span>
      </header>

      <div className="mx-auto flex max-w-[760px] gap-7 px-7 py-8">
        <aside className="w-[148px] shrink-0 pt-1">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Pipper Code
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-[12px] font-medium text-foreground shadow-surface-1">
            <Sun className="size-3.5" />
            General
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5">
            <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-foreground">
              General
            </h1>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              Small preferences that shape how Pipper Code feels on your Mac.
            </p>
          </div>

          <section aria-labelledby="appearance-heading">
            <h2
              id="appearance-heading"
              className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70"
            >
              Appearance
            </h2>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-2 shadow-surface-2">
              <SettingRow
                icon={ThemeIcon}
                title="Theme"
                description={`${THEME_LABELS[theme]} appearance · click to cycle`}
              >
                <ThemeToggle className="size-9 rounded-lg bg-surface-3 shadow-surface-1" />
              </SettingRow>
            </div>
          </section>

          <section aria-labelledby="keyboard-heading" className="mt-7">
            <h2
              id="keyboard-heading"
              className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70"
            >
              Keyboard
            </h2>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-2 shadow-surface-2">
              <SettingRow
                icon={Keyboard}
                title="Switch tabs"
                description={`From the left of the tab bar, ${modifierSymbol()}1 opens the first tab, ${modifierSymbol()}2 the second, through ${modifierSymbol()}9.`}
              >
                <span className="rounded-md bg-surface-3 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-surface-1">
                  {modifierSymbol()}1–{modifierSymbol()}9
                </span>
              </SettingRow>
              <div className="h-px bg-border/70" />
              <SettingRow
                icon={Keyboard}
                title="New tab"
                description="Opens a new thread. The composer stays a draft until you send the first message."
              >
                <span className="rounded-md bg-surface-3 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-surface-1">
                  {modifierSymbol()}T
                </span>
              </SettingRow>
            </div>
          </section>

          <section aria-labelledby="power-heading" className="mt-7">
            <h2
              id="power-heading"
              className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70"
            >
              Power
            </h2>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-surface-2 shadow-surface-2">
              <SleeplessControl variant="settings" />
            </div>
            <p className="mt-2 px-1 text-[10px] leading-4 text-muted-foreground/70">
              Requires the Sleepless helper and Login Items permission on macOS.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
