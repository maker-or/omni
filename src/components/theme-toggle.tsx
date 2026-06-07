import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/lib/theme";

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const LABELS: Record<Theme, string> = {
  light: "Light theme",
  dark: "Dark theme",
  system: "System theme",
};

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, cycleTheme } = useTheme();
  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={`${LABELS[theme]}. Click to cycle.`}
      title={LABELS[theme]}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md",
        "text-muted-foreground hover:text-foreground hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-colors",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
