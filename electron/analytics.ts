import { randomUUID } from "node:crypto";
import { app } from "electron";
import { PostHog } from "posthog-node";
import type {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsWindowType,
} from "./analytics-schema.ts";
import { sanitizeAnalyticsProperties } from "./analytics-sanitize.ts";

const sessionId = randomUUID();

let client: PostHog | null = null;
let distinctId: string | null = null;
let appOpenedSent = false;

function resolvePostHogKey(): string | null {
  if (process.env["ANALYTICS_ENABLED"] === "false") return null;
  return (
    process.env["PIPPER_POSTHOG_KEY"] ??
    process.env["POSTHOG_KEY"] ??
    import.meta.env.VITE_POSTHOG_KEY ??
    null
  );
}

function resolvePostHogHost(): string {
  return (
    process.env["PIPPER_POSTHOG_HOST"] ??
    process.env["POSTHOG_HOST"] ??
    import.meta.env.VITE_POSTHOG_HOST ??
    "https://us.i.posthog.com"
  );
}

function getClient(): PostHog | null {
  if (client) return client;
  const apiKey = resolvePostHogKey();
  if (!apiKey) return null;
  client = new PostHog(apiKey, {
    host: resolvePostHogHost(),
    flushAt: 10,
    flushInterval: 5000,
  });
  return client;
}

function buildBaseProperties(windowType: AnalyticsWindowType) {
  return {
    app_version: app.getVersion(),
    session_id: sessionId,
    window_type: windowType,
    platform: process.platform,
  };
}

export interface AnalyticsUserIdentity {
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

function buildPersonProperties(identity: AnalyticsUserIdentity): Record<string, string> {
  const properties: Record<string, string> = {};
  const email = identity.email?.trim();
  const name = identity.name?.trim();
  const avatar = identity.avatarUrl?.trim();
  if (email) properties.$email = email;
  if (name) properties.$name = name;
  if (avatar) properties.$avatar = avatar;
  return properties;
}

export function identifyAnalyticsUser(identity: AnalyticsUserIdentity): void {
  const trimmed = identity.providerUserId.trim();
  if (!trimmed) return;
  distinctId = trimmed;
  const posthog = getClient();
  if (!posthog) return;
  posthog.identify({
    distinctId,
    properties: buildPersonProperties(identity),
  });
  if (!appOpenedSent) {
    appOpenedSent = true;
    captureAnalytics("app_opened", { windowType: "launch" });
  }
}

export function captureAnalytics(
  name: AnalyticsEventName,
  event: Omit<AnalyticsEvent, "name"> = {},
): void {
  if (!distinctId) return;
  const posthog = getClient();
  if (!posthog) return;
  const properties: AnalyticsProperties = event.properties ?? {};
  posthog.capture({
    distinctId,
    event: name,
    properties: {
      ...buildBaseProperties(event.windowType ?? "background"),
      ...sanitizeAnalyticsProperties(properties),
    },
  });
}

export async function shutdownAnalytics(): Promise<void> {
  if (!client) return;
  await client.shutdown();
  client = null;
}
