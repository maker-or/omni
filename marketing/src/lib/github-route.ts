/// <reference types="@clerk/astro/env" />
import type { APIContext } from "astro";
import { clerkClient } from "@clerk/astro/server";
import { GitHubError } from "./github";

/**
 * Shared plumbing for /api/github/* — called by the iOS app's Siri intents.
 * Auth: `Authorization: Bearer <Clerk session token>` from the Clerk iOS SDK,
 * verified by Clerk's middleware. The GitHub token never leaves pipper.dev.
 */

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Run `handler` with the signed-in user's GitHub token, mapping failures to JSON errors. */
export async function withGitHubToken(
  context: APIContext,
  handler: (token: string) => Promise<Response>,
): Promise<Response> {
  const { isAuthenticated, userId } = context.locals.auth();
  if (!isAuthenticated || !userId) return json(401, { error: "Sign in to Pipper again." });

  let token: string | undefined;
  try {
    const tokens = await clerkClient(context).users.getUserOauthAccessToken(userId, "github");
    token = tokens.data[0]?.token;
  } catch (error) {
    console.error("[github] couldn't read the GitHub token:", error);
    return json(502, { error: "Couldn't reach your GitHub connection. Try again shortly." });
  }
  if (!token) return json(409, { error: "Sign in to Pipper with GitHub to use GitHub actions." });

  try {
    return await handler(token);
  } catch (error) {
    if (error instanceof GitHubError) return json(error.status, { error: error.message });
    console.error("[github] request failed:", error);
    return json(502, { error: "GitHub isn't responding right now. Try again shortly." });
  }
}
