import { SquaresFour, TreeStructure } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UiMode } from "@/store/ui-mode-store";

interface UiModeSelectorProps {
  onContinue: (mode: UiMode) => void;
}

const options: Array<{
  mode: UiMode;
  label: string;
  description: string;
  icon: typeof SquaresFour;
}> = [
  {
    mode: "basic",
    label: "Basic",
    description: "Use the current project and chat layout.",
    icon: SquaresFour,
  },
  {
    mode: "advanced",
    label: "Advanced",
    description: "Organize chats into isolated workspaces.",
    icon: TreeStructure,
  },
];

export function UiModeSelector({ onContinue }: UiModeSelectorProps) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Choose your workspace
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          How do you want to work?
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          You can change this later in settings.
        </p>
      </header>
      <div className="grid gap-2">
        {options.map(({ mode, label, description, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={cn(
              "group flex items-center gap-3 rounded-xl border border-border/60 bg-surface-1/50 px-3 py-3 text-left transition-colors",
              "hover:border-foreground/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            onClick={() => onContinue(mode)}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
              <Icon size={18} weight="duotone" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{label}</span>
              <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
            </span>
          </button>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => onContinue("basic")}
      >
        Continue with Basic
      </Button>
    </section>
  );
}
