import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/** True while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Runs `task` now and then every `intervalMs` while the screen is focused and
 * the app is in the foreground, never overlapping two runs. Stops when
 * `enabled` turns false.
 */
export function usePolling(task: () => Promise<void>, intervalMs: number, enabled = true): void {
  const active = useAppActive();
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  });

  useFocusEffect(
    useCallback(() => {
      if (!active || !enabled) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        try {
          await latest.current();
        } finally {
          if (!cancelled) timer = setTimeout(tick, intervalMs);
        }
      };
      void tick();
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [active, enabled, intervalMs]),
  );
}
