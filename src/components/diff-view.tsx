import { useMemo, useState, type CSSProperties } from "react";
import { CodeView } from "@pierre/diffs/react";
import { parseDiffFromFile, type CodeViewDiffItem } from "@pierre/diffs";
import { RowsIcon, ColumnsIcon } from "@phosphor-icons/react";
import { useDiffStore } from "@/store/diff-store";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { Elevated } from "@/lib/elevated";

// Matches the Shiki theme pair used elsewhere for code (see shiki-code-block.tsx)
// so diff syntax highlighting stays visually consistent with the rest of the app.
const DIFF_THEMES = { light: "github-light", dark: "github-dark" } as const;

// The library's own theme layer re-declares --diffs-bg/-fg (and the
// color-mix()'d variants derived from them) after our light/dark overrides,
// so pin them from the highest-priority "unsafe" CSS layer instead of
// fighting the cascade with plain custom properties.
const DIFF_UNSAFE_CSS = `
  :host {
    --diffs-bg: var(--surface-2) !important;
    --diffs-bg-buffer: var(--surface-2) !important;
    --diffs-bg-context: var(--surface-2) !important;
    --diffs-bg-context-gutter: var(--surface-2) !important;
    --diffs-bg-separator: var(--surface-2) !important;
    --diffs-fg: var(--foreground) !important;
  }
`;

export function DiffView() {
  const files = useDiffStore((state) => state.files);
  const order = useDiffStore((state) => state.order);
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const { resolvedTheme } = useTheme();

  // Stack every changed file (across every turn), not just the most recently
  // touched one — an agent that edits file A then file B should still show
  // both, not have B replace A.
  const items: CodeViewDiffItem[] = useMemo(() => {
    return order
      .map((path) => files[path])
      .filter((file): file is NonNullable<typeof file> => Boolean(file))
      .map((file) => ({
        id: file.path,
        type: "diff" as const,
        fileDiff: parseDiffFromFile(
          { name: file.path, contents: file.oldText },
          { name: file.path, contents: file.newText },
        ),
      }));
  }, [order, files]);

  if (order.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[13px] text-muted-foreground">
        No file changes yet.
      </div>
    );
  }

  return (
    <Elevated
      offset={1}
      className="flex h-full w-full min-h-0 rounded-none"
      style={
        {
          "--diffs-font-family": "var(--font-mono)",
          colorScheme: resolvedTheme,
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 flex-1 flex-col ">
        <div className="flex h-9 shrink-0 items-center justify-between rounded-2xl px-3">
          <span className="truncate text-[12px] text-muted-foreground">
            {order.length} file{order.length === 1 ? "" : "s"} changed
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              active={layout === "split"}
              title="Split view"
              onClick={() => setLayout("split")}
            >
              <ColumnsIcon size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              active={layout === "unified"}
              title="Stacked view"
              onClick={() => setLayout("unified")}
            >
              <RowsIcon size={14} />
            </Button>
          </div>
        </div>
        {/* CodeView manages its own internal virtualized scroll container —
            wrapping it in another `overflow-auto` div creates a competing
            scroll region and breaks scrolling, so this is just a sizing box. */}
        <div className="min-h-0 flex-1">
          <CodeView
            items={items}
            options={{
              diffStyle: layout,
              theme: DIFF_THEMES,
              themeType: resolvedTheme,
              unsafeCSS: DIFF_UNSAFE_CSS,
              stickyHeaders: true,
            }}
            className="h-full w-full"
          />
        </div>
      </div>
    </Elevated>
  );
}
