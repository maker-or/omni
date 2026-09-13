import posthog from "posthog-js";

/**
 * Renderer-side PostHog (article: posthog-js full bundle via bundler).
 * Complements electron/analytics.ts (posthog-node in main): main keeps all
 * trusted custom events; renderer adds autocapture + $pageview + session
 * replay for reliability/observability. No custom main events are moved here,
 * so there is no double-capture: renderer tags source:"renderer".
 */

let initialized = false;

export interface RendererAnalyticsConfig {
  key: string;
  host: string;
  distinctId: string | null;
}

async function resolveConfig(): Promise<RendererAnalyticsConfig | null> {
  // Prefer main-process config (single source of truth, honors
  // ANALYTICS_ENABLED=false). Fall back to build-time env for web preview.
  try {
    const api = window.omni?.analytics as
      | { getConfig?: () => Promise<RendererAnalyticsConfig | null> }
      | undefined;
    if (api?.getConfig) {
      const config = await api.getConfig();
      if (config) return config;
      return null; // main explicitly disabled or keyless: stay off.
    }
  } catch {
    // fall through to env (e.g. browser preview without preload)
  }
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return null;
  const host =
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";
  return { key, host, distinctId: null };
}

export async function initRendererAnalytics(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const config = await resolveConfig();
    if (!config) return;
    posthog.init(config.key, {
      api_host: config.host,
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: true,
      // Session replay is the reliability win from the article; keep masking
      // strict since the app renders terminals, file paths, and prompts.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "[data-ph-mask], .xterm, pre, code",
      },
      // Main-process posthog-node remains the source of truth for custom
      // events; tag renderer traffic so funnels can split by origin.
      loaded: (ph) => {
        if (config.distinctId) ph.identify(config.distinctId);
        ph.register({ source: "renderer" });
      },
    });
  } catch {
    // Analytics must never break app boot.
  }
}

/** Keep renderer identity stitched to main's deviceId → userId alias chain. */
export function identifyRendererAnalytics(distinctId: string): void {
  try {
    if (!initialized) return;
    posthog.identify(distinctId);
  } catch {
    // no-op
  }
}
