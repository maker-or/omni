import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "omni:theme";

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

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = NEXT_THEME[current];
      window.localStorage.setItem(STORAGE_KEY, next);
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
