import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "pipper:theme";

interface ThemeContextValue {
  /** User's selected preference (light/dark/system). */
  theme: Theme;
  /** Concrete theme actually applied to the document (resolves "system"). */
  resolvedTheme: ResolvedTheme;
  /** Set the preference; persists to localStorage. */
  setTheme: (theme: Theme) => void;
  /** Cycle: light → dark → system → light. */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function normalizeTheme(theme: string | null | undefined): Theme | null {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : null;
}

function isCompanionStage(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("stage") === "companion";
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    getStoredTheme() === "system" ? getSystemTheme() : (getStoredTheme() as ResolvedTheme),
  );

  useEffect(() => {
    if (!window.omni?.theme) return;

    if (isCompanionStage()) {
      const getCurrentTheme = window.omni.theme.getCurrent;
      if (!getCurrentTheme) return;
      let cancelled = false;
      void getCurrentTheme().then((currentTheme) => {
        if (cancelled) return;
        const normalized = normalizeTheme(currentTheme);
        if (!normalized) return;
        setThemeState(normalized);
        window.localStorage.setItem(STORAGE_KEY, normalized);
      });
      return () => {
        cancelled = true;
      };
    }

    window.omni.theme.changed?.(theme);
  }, []);

  useEffect(() => {
    const resolved: ResolvedTheme = theme === "system" ? getSystemTheme() : theme;
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved: ResolvedTheme = media.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    if (!window.omni?.theme?.onChanged) return;
    const unsubscribe = window.omni.theme.onChanged((nextTheme) => {
      const normalized = normalizeTheme(nextTheme);
      if (!normalized) return;
      setThemeState((current) => {
        if (current !== normalized) {
          window.localStorage.setItem(STORAGE_KEY, normalized);
          return normalized;
        }
        return current;
      });
    });
    return unsubscribe;
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    if (window.omni?.theme?.changed) {
      window.omni.theme.changed(next);
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = NEXT_THEME[current];
      window.localStorage.setItem(STORAGE_KEY, next);
      if (window.omni?.theme?.changed) {
        window.omni.theme.changed(next);
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
