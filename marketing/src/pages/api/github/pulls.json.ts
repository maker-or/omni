import type { APIRoute } from "astro";
import { listMyPullRequests } from "../../../lib/github";
import { json, withGitHubToken } from "../../../lib/github-route";

export const prerender = false;

/** GET /api/github/pulls.json — the user's own open pull requests (a short list). */
export const GET: APIRoute = (context) =>
  withGitHubToken(context, async (token) =>
    json(200, { pullRequests: await listMyPullRequests(token) }),
  );
