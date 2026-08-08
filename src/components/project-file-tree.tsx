import { useEffect, useState, type CSSProperties } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ProjectFileTreeSnapshot } from "../../contracts/projects.ts";

interface ProjectFileTreeProps {
  projectName: string;
  reloadKey: string;
}

const EMPTY_SNAPSHOT: ProjectFileTreeSnapshot = {
  paths: [],
  gitStatus: [],
};

const treeStyles = {
  height: "100%",
  minHeight: 0,
  "--trees-bg-override": "var(--surface-1)",
  "--trees-bg-muted-override": "var(--hover)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-border-color-override": "var(--border)",
  "--trees-selected-bg-override": "var(--active)",
  "--trees-selected-fg-override": "var(--foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": '"Inter Variable", sans-serif',
  "--trees-font-size-override": "12px",
  "--trees-padding-inline-override": "8px",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-padding-x-override": "7px",
  "--trees-border-radius-override": "6px",
} as CSSProperties;

function ProjectFileTreeContent({ snapshot }: { snapshot: ProjectFileTreeSnapshot }) {
  const { model } = useFileTree({
    paths: snapshot.paths,
    gitStatus: snapshot.gitStatus,
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    icons: "standard",
    density: "compact",
    search: false,
    dragAndDrop: false,
    renaming: false,
    stickyFolders: true,
    unsafeCSS: `
      button[data-item-type="file"] {
        cursor: default;
        pointer-events: none;
      }
    `,
  });

  return <FileTree model={model} style={treeStyles} aria-label="Project files" />;
}

export function ProjectFileTree({ projectName, reloadKey }: ProjectFileTreeProps) {
  const [snapshot, setSnapshot] = useState<ProjectFileTreeSnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void window.omni.projects
      .getFileTree()
      .then((nextSnapshot) => {
        if (!cancelled) setSnapshot(nextSnapshot);
      })
      .catch((reason) => {
        if (!cancelled) {
          setSnapshot(EMPTY_SNAPSHOT);
          setError(reason instanceof Error ? reason.message : "Could not load project files.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-1"
      data-pipper-id="project-file-tree"
    >
      <div className="min-h-0 flex-1 bg-surface-1">
        {isLoading ? (
          <div className="px-4 py-3 text-[12px] text-muted-foreground">Loading files…</div>
        ) : error ? (
          <div className="px-4 py-3 text-[12px] text-red-500">{error}</div>
        ) : snapshot.paths.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-muted-foreground">No project files found.</div>
        ) : (
          <ProjectFileTreeContent snapshot={snapshot} />
        )}
      </div>
    </div>
  );
}
