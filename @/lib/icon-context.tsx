"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";

import {
  iconMap,
  iconLibraryOrder,
  loadIconLibrary,
  getLoadedIconMap,
  type IconLibrary,
  type IconName,
  type IconComponent,
} from "@/lib/icon-map";

// Re-export types for consumers
export type { IconComponent, IconName, IconLibrary } from "@/lib/icon-map";
export { iconLibraryOrder } from "@/lib/icon-map";

interface IconContextValue {
  iconLibrary: IconLibrary;
  setIconLibrary: (lib: IconLibrary) => void;
  loadedLibrary: IconLibrary;
}

const IconContext = createContext<IconContextValue | null>(null);

/**
 * Returns the current icon library and setter.
 * Throws if used outside IconProvider.
 */
function useIconLibrary() {
  const ctx = useContext(IconContext);
  if (!ctx) throw new Error("useIconLibrary must be used within an IconProvider");
  return ctx;
}

/**
 * Returns a single icon component for the given name.
 * Falls back to Phosphor if no provider is present or during loading.
 */
function useIcon(name: IconName): IconComponent {
  const ctx = useContext(IconContext);
  if (!ctx) return getLoadedIconMap("phosphor")[name];
  return getLoadedIconMap(ctx.iconLibrary)[name];
}

/**
 * Returns the full icon map for the current library.
 * Falls back to Phosphor if no provider is present or during loading.
 */
function useIcons(): Record<IconName, IconComponent> {
  const ctx = useContext(IconContext);
  const lib = ctx?.iconLibrary ?? "phosphor";
  return getLoadedIconMap(lib);
}

function IconProvider({
  children,
  defaultLibrary = "phosphor",
}: {
  children: ReactNode;
  defaultLibrary?: IconLibrary;
}) {
  const [iconLibrary, setIconLibraryState] = useState<IconLibrary>(defaultLibrary);
  const [loadedLibrary, setLoadedLibrary] = useState<IconLibrary>(defaultLibrary);

  const setIconLibrary = useCallback((next: IconLibrary) => {
    setIconLibraryState(next);
  }, []);

  // Preload/load icon library dynamically when active selection changes
  useEffect(() => {
    let active = true;
    if (iconLibrary === "phosphor") {
      setLoadedLibrary("phosphor");
      return;
    }

    loadIconLibrary(iconLibrary).then(() => {
      if (active) {
        setLoadedLibrary(iconLibrary);
      }
    });

    return () => {
      active = false;
    };
  }, [iconLibrary]);

  // Global keyboard shortcut: I to cycle icon library
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "i" && e.key !== "I") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable)
        return;
      e.preventDefault();
      setIconLibraryState((prev) => {
        const idx = iconLibraryOrder.indexOf(prev);
        return iconLibraryOrder[(idx + 1) % iconLibraryOrder.length];
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({ iconLibrary, setIconLibrary, loadedLibrary }),
    [iconLibrary, setIconLibrary, loadedLibrary],
  );

  return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}

export interface IconProps extends ComponentProps<"svg"> {
  name: IconName;
}

export function Icon({ name, ...props }: IconProps) {
  const IconComponent = useIcon(name);
  return <IconComponent {...props} />;
}

export { IconProvider, useIcon, useIcons, useIconLibrary };
