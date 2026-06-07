import { useCallback, useState } from "react";
import { ArrowLeft, FolderOpen } from "lucide-react";
import type { Project } from "../../contracts/projects.ts";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/ui/icon-picker";
import { InputGroup, InputField } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

interface AddProjectFormProps {
  onBack: () => void;
  onCreated: (project: Project) => void;
}

export function AddProjectForm({ onBack, onCreated }: AddProjectFormProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | undefined>();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowse = useCallback(async () => {
    if (!window.omni?.dialog?.pickDirectory) return;
    setIsBrowsing(true);
    setError(null);
    try {
      const selected = await window.omni.dialog.pickDirectory();
      if (selected) setPath(selected);
    } catch (err) {
      console.error("Failed to pick directory:", err);
      setError("Could not open folder picker.");
    } finally {
      setIsBrowsing(false);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a project name.");
      return;
    }
    if (!icon) {
      setError("Select an icon.");
      return;
    }
    if (!path) {
      setError("Choose a project folder.");
      return;
    }
    if (!window.omni?.projects?.create) return;

    setIsSubmitting(true);
    try {
      const project = await window.omni.projects.create({
        name: trimmedName,
        path,
        icon,
      });
      onCreated(project);
    } catch (err) {
      console.error("Failed to create project:", err);
      setError(err instanceof Error ? err.message : "Could not create project. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [icon, name, onCreated, path]);

  const canSubmit = name.trim().length > 0 && icon != null && path.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className={cn(
            "inline-flex items-center justify-center size-8",
            "rounded-md text-muted-foreground hover:text-foreground hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            "transition-colors",
          )}
          aria-label="Back to projects"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">New project</h1>
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted-foreground pl-3">Icon</span>
        <IconPicker value={icon} onValueChange={setIcon} />
      </div>

      <InputGroup className="w-full">
        <InputField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="My project"
          disabled={isSubmitting}
          index={0}
        />

        <div className="flex items-end gap-2">
          <InputField
            label="Folder"
            value={path}
            onChange={() => {}}
            placeholder="No folder selected"
            disabled={isSubmitting || isBrowsing}
            readOnly
            onClick={handleBrowse}
            index={1}
            icon={FolderOpen}
            className="flex-1 cursor-pointer"
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="h-9 mb-[1px]"
            onClick={handleBrowse}
            disabled={isSubmitting || isBrowsing}
          >
            Browse
          </Button>
        </div>
      </InputGroup>

      {error != null && (
        <p className="text-sm text-destructive px-0.5" role="alert">
          {error}
        </p>
      )}

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={handleSubmit}
        disabled={!canSubmit || isSubmitting}
      >
        {isSubmitting ? "Creating…" : "Create project"}
      </Button>
    </div>
  );
}
