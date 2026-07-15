import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { PostHog } from "posthog-node";
import type {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsWindowType,
} from "./analytics-schema.ts";
import { sanitizeAnalyticsProperties, sanitizeIdentifier } from "./analytics-sanitize.ts";

const sessionId = randomUUID();

let client: PostHog | null = null;
/** Clerk provider user id once authenticated; null before sign-in. */
let identifiedUserId: string | null = null;
/** Stable per-install id used as distinctId before sign-in (pre-auth funnel). */
let deviceId: string | null = null;
let appOpenedSent = false;

/**
 * Active agent context promoted onto the base properties of every ACP-scoped
 * event, so any event is sliceable by agent in PostHog without extra plumbing.
 */
let activeAgent: { agent_id?: string; agent_name?: string; model_id?: string } = {};

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
    ...activeAgent,
  };
}

/**
 * Set (or clear) the active agent promoted onto every subsequent event's base
 * properties. Pass `null` to clear. The connection manager calls this whenever
 * the active thread / agent changes.
 */
export function setActiveAgentContext(
  ctx: { agentId?: string | null; agentName?: string | null; modelId?: string | null } | null,
): void {
  if (!ctx) {
    activeAgent = {};
    return;
  }
  const next: { agent_id?: string; agent_name?: string; model_id?: string } = {};
  const agentId = sanitizeIdentifier(ctx.agentId);
  const agentName = sanitizeIdentifier(ctx.agentName);
  const modelId = sanitizeIdentifier(ctx.modelId);
  if (agentId) next.agent_id = agentId;
  if (agentName) next.agent_name = agentName;
  if (modelId) next.model_id = modelId;
  activeAgent = next;
}

/** The id events are attributed to: the signed-in user, else the device id. */
function currentDistinctId(): string | null {
  return identifiedUserId ?? deviceId ?? ensureDeviceId();
}

/**
 * Load-or-create a stable device id persisted under userData. Lets us attribute
 * pre-auth events; on identify we alias the device id to the user id so the
 * open → sign-in funnel stitches together.
 */
function ensureDeviceId(): string | null {
  if (deviceId) return deviceId;
  try {
    const path = join(app.getPath("userData"), "analytics-device.json");
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { deviceId?: string };
      if (parsed.deviceId) {
        deviceId = parsed.deviceId;
        return deviceId;
      }
    }
    deviceId = randomUUID();
    writeFileSync(path, `${JSON.stringify({ deviceId }, null, 2)}\n`);
    return deviceId;
  } catch {
    // If persistence fails, fall back to an in-memory id for this run.
    deviceId ??= randomUUID();
    return deviceId;
  }
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
  const previousId = deviceId ?? ensureDeviceId();
  identifiedUserId = trimmed;
  const posthog = getClient();
  if (!posthog) return;
  // Stitch pre-auth device activity onto the now-known user.
  if (previousId && previousId !== trimmed) {
    posthog.alias({ distinctId: trimmed, alias: previousId });
  }
  posthog.identify({
    distinctId: trimmed,
    properties: buildPersonProperties(identity),
  });
  if (!appOpenedSent) {
    appOpenedSent = true;
    captureAnalytics("app_opened", { windowType: "launch" });
  }
}

/**
 * Set person-level properties on the current distinct id (e.g. installed_version,
 * has_customizations). No-op before a distinct id is available.
 */
export function setAnalyticsPersonProperties(properties: Record<string, unknown>): void {
  const id = currentDistinctId();
  if (!id) return;
  const posthog = getClient();
  if (!posthog) return;
  posthog.capture({
    distinctId: id,
    event: "$set",
    properties: { $set: properties },
  });
}

export function captureAnalytics(
  name: AnalyticsEventName,
  event: Omit<AnalyticsEvent, "name"> = {},
): void {
  const id = currentDistinctId();
  if (!id) return;
  const posthog = getClient();
  if (!posthog) return;
  const properties: AnalyticsProperties = event.properties ?? {};
  posthog.capture({
    distinctId: id,
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
