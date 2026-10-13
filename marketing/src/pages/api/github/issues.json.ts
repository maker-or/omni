import type { APIRoute } from "astro";
import { createIssue, parseIssueInput } from "../../../lib/github";
import { json, withGitHubToken } from "../../../lib/github-route";

export const prerender = false;

/**
 * POST /api/github/issues.json — file an issue.
 * Body: { owner, repo, title, body? }. The phone confirms with the user first.
 */
export const POST: APIRoute = (context) =>
  withGitHubToken(context, async (token) => {
    let raw: unknown;
    try {
      raw = await context.request.json();
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
    const input = parseIssueInput(raw);
    if (typeof input === "string") return json(400, { error: input });
    return json(201, { issue: await createIssue(token, input) });
  });
