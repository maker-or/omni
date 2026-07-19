/**
 * Person-level identity for PostHog profiles (not event properties).
 *
 * PostHog person UI reads reserved `$email` / `$name` / `$avatar`. The Node SDK
 * examples also use bare `email` / `name`. We set both so profiles render in the
 * UI and filters on either key work.
 */

export interface AnalyticsUserIdentity {
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

/**
 * Build the `$set` payload for `posthog.identify`. Empty when nothing usable was
 * provided (caller still identifies by `providerUserId` as distinct id).
 */
export function buildPersonProperties(identity: AnalyticsUserIdentity): Record<string, string> {
  const properties: Record<string, string> = {};

  const email = identity.email?.trim();
  if (email) {
    properties.$email = email;
    properties.email = email;
  }

  const name = identity.name?.trim();
  if (name) {
    properties.$name = name;
    properties.name = name;
  }

  const avatar = identity.avatarUrl?.trim();
  if (avatar) {
    properties.$avatar = avatar;
    properties.avatar = avatar;
  }

  return properties;
}
