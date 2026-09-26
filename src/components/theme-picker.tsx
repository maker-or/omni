import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/lib/theme";
import { PreviewOption } from "@/components/preview-option";

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Palette for the miniature app previews. */
const SURFACES = {
  light: {
    bg: "#ffffff",
    sidebar: "#f1f1f2",
    avatar: "#dcdcdd",
    line: "#e2e2e3",
    bullet: "#d5d5d6",
  },
  dark: {
    bg: "#1b1b1d",
    sidebar: "#242426",
    avatar: "#3c3c3f",
    line: "#333336",
    bullet: "#3c3c3f",
  },
} as const;

const LIST_WIDTHS = [70, 85, 60, 78];

function TrafficLights() {
  return (
    <div className="absolute left-[6px] top-[6px] flex items-center gap-[2px]" aria-hidden="true">
      <span className="size-[3px] rounded-full bg-[#ff5f57]" />
      <span className="size-[3px] rounded-full bg-[#febc2e]" />
      <span className="size-[3px] rounded-full bg-[#28c840]" />
    </div>
  );
}

/** A miniature app window: sidebar plus a checklist-style content pane. */
function Preview({ scheme }: { scheme: "light" | "dark" }) {
  const surface = SURFACES[scheme];
  return (
    <div
      className="relative h-[74px] w-[96px] overflow-hidden"
      style={{ backgroundColor: surface.bg }}
    >
      <TrafficLights />
      <div className="absolute inset-x-[6px] bottom-[6px] top-[18px] flex gap-[5px]">
        <div
          className="flex w-[34px] shrink-0 flex-col gap-[3px] rounded-[4px] p-[4px]"
          style={{ backgroundColor: surface.sidebar }}
        >
          <span className="size-[7px] rounded-full" style={{ backgroundColor: surface.avatar }} />
          <span
            className="mt-[2px] h-[3px] w-[82%] rounded-full"
            style={{ backgroundColor: surface.line }}
          />
          <span
            className="h-[3px] w-[64%] rounded-full"
            style={{ backgroundColor: surface.line }}
          />
          <span
            className="h-[3px] w-[74%] rounded-full"
            style={{ backgroundColor: surface.line }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-[4px]">
            <span
              className="size-[8px] shrink-0 rounded-full"
              style={{ backgroundColor: surface.avatar }}
            />
            <span
              className="h-[3px] w-[58%] rounded-full"
              style={{ backgroundColor: surface.line }}
            />
          </div>
          <div className="mt-[6px] flex flex-col gap-[4px]">
            {LIST_WIDTHS.map((width, index) => (
              <div key={index} className="flex items-center gap-[3px]">
                <span
                  className="size-[3px] shrink-0 rounded-[1px]"
                  style={{ backgroundColor: surface.bullet }}
                />
                <span
                  className="h-[3px] rounded-full"
                  style={{ width: `${width}%`, backgroundColor: surface.line }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** System preview: a single window split down the middle into light and dark. */
function SplitPreview() {
  return (
    <div className="relative h-[74px] w-[96px] overflow-hidden">
      <div className="absolute inset-0" style={{ clipPath: "inset(0 50% 0 0)" }}>
        <Preview scheme="light" />
      </div>
      <div className="absolute inset-0" style={{ clipPath: "inset(0 0 0 50%)" }}>
        <Preview scheme="dark" />
      </div>
    </div>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  if (theme === "system") return <SplitPreview />;
  return <Preview scheme={theme} />;
}

/** Visual theme chooser: three app previews, the active one ringed and checked. */
export function ThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div role="radiogroup" aria-label="Theme" className={cn("flex items-start gap-3", className)}>
      {THEME_OPTIONS.map((option) => (
        <PreviewOption
          key={option.value}
          name="pipper-theme"
          value={option.value}
          label={option.label}
          selected={theme === option.value}
          onSelect={() => setTheme(option.value)}
        >
          <ThemePreview theme={option.value} />
        </PreviewOption>
      ))}
    </div>
  );
}
