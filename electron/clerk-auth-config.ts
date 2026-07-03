import {
  PIPPER_CLERK_SIGN_IN_URL,
  PIPPER_CLERK_SIGN_UP_URL,
} from "../contracts/launcher-release-urls.ts";

const ALLOWED_AUTH_HOSTS = ["clerk.com", "pipper.dev", "www.pipper.dev"];

export function resolveClerkSignInUrl(): string {
  return PIPPER_CLERK_SIGN_IN_URL;
}

export function resolveClerkSignUpUrl(): string {
  return PIPPER_CLERK_SIGN_UP_URL;
}

export function configuredClerkAuthHosts(): Set<string> {
  const hosts = new Set<string>(ALLOWED_AUTH_HOSTS);
  for (const inputUrl of [PIPPER_CLERK_SIGN_IN_URL, PIPPER_CLERK_SIGN_UP_URL]) {
    try {
      hosts.add(new URL(inputUrl).hostname.toLowerCase());
    } catch {
      // Ignore invalid URLs.
    }
  }
  return hosts;
}

export function isAllowedClerkAuthUrl(inputUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const hostname = parsed.hostname.toLowerCase();
  const configuredHosts = configuredClerkAuthHosts();
  return (
    configuredHosts.has(hostname) || hostname === "clerk.com" || hostname.endsWith(".clerk.com")
  );
}
