import { clerkMiddleware } from "@clerk/astro/server";
import type { MiddlewareHandler } from "astro";

const clerk = clerkMiddleware();

/**
 * Routes that authenticate themselves with a non-Clerk bearer token. Clerk's
 * middleware treats any `Authorization: Bearer` header as a Clerk session
 * token and throws while decoding a laptop credential, so it must not run
 * here (these routes never use Astro.locals.auth()).
 */
export function bypassesClerk(pathname: string): boolean {
  return pathname.startsWith("/api/remote/");
}

export const onRequest: MiddlewareHandler = (context, next) =>
  bypassesClerk(context.url.pathname) ? next() : clerk(context, next);
