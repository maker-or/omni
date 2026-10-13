import type { APIRoute } from "astro";
import { listRepos } from "../../../lib/github";
import { json, withGitHubToken } from "../../../lib/github-route";

export const prerender = false;

/** GET /api/github/repos.json — repositories the user can file issues in. */
export const GET: APIRoute = (context) =>
  withGitHubToken(context, async (token) => json(200, { repos: await listRepos(token) }));
