"use client";

// Adapted from Lina by SameerJS6 (https://lina.sameer.sh) — use-has-primary-touch.
// Detects touch-primary devices (coarse pointer + touch points), updating live
// on pointer-mode and media-query changes. Returns false on the server and the
// first client render, so the non-touch branch is the hydration-stable default.

import { useSyncExternalStore } from "react";

function getSnapshot() {
  if (typeof window === "undefined") return false;
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const prefersTouch = window.matchMedia("(pointer: coarse)").matches;
  return hasTouch && prefersTouch;
}

function getServerSnapshot() {
  return false;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  const controller = new AbortController();
  const { signal } = controller;

  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", callback, { signal });
  window.addEventListener("pointerdown", callback, { signal });

  return () => {
    controller.abort();
  };
}

export function useTouchPrimary() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
