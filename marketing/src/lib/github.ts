/**
 * GitHub calls behind the phone's Siri intents. The user's GitHub token comes
 * from their Clerk GitHub connection (OAuth, `repo` scope); this module only
 * talks to api.github.com and shapes the replies the iOS app decodes.
 */

const GITHUB_API = "https://api.github.com";
/** Kept small on purpose: Siri summarizes this list aloud. */
export const MAX_PULL_REQUESTS = 10;
/** Descriptions are trimmed so the whole list stays short for Siri. */
const MAX_DESCRIPTION_CHARS = 500;
const MAX_TITLE_CHARS = 256;
const MAX_BODY_CHARS = 65_536;
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export interface GitHubRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  author: string;
  description: string;
  status: "open" | "draft";
  repository: string;
  url: string;
}

export interface CreatedIssue {
  number: number;
  title: string;
  repository: string;
  url: string;
}

export interface IssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string | null;
}

/** A failure the phone can show as-is: `status` is the HTTP status to return. */
export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Fetch = typeof fetch;

async function github(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: Fetch = fetch,
): Promise<unknown> {
  const res = await fetchImpl(`${GITHUB_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pipper.dev",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return res.json();
  throw githubError(res.status);
}

/** Map GitHub's status to a message the phone can speak. */
export function githubError(status: number): GitHubError {
  switch (status) {
    case 401:
      return new GitHubError(
        409,
        "Your GitHub connection expired. Sign in to Pipper with GitHub again.",
      );
    case 403:
    case 404:
      // 403/404 also cover organizations that haven't approved the OAuth app.
      return new GitHubError(
        403,
        "GitHub didn't allow that. If the repository belongs to an organization, ask its owner to approve Pipper on GitHub.",
      );
    case 410:
      return new GitHubError(422, "Issues are turned off for that repository.");
    case 422:
      return new GitHubError(422, "GitHub rejected the issue. Check the title and try again.");
    default:
      return new GitHubError(502, "GitHub isn't responding right now. Try again shortly.");
  }
}

/** Repositories the user can file issues in, most recently pushed first. */
export async function listRepos(token: string, fetchImpl?: Fetch): Promise<GitHubRepo[]> {
  const data = await github(
    token,
    "/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member",
    {},
    fetchImpl,
  );
  return Array.isArray(data) ? data.flatMap(toRepo) : [];
}

export function toRepo(raw: unknown): GitHubRepo[] {
  const r = raw as {
    id?: unknown;
    name?: unknown;
    full_name?: unknown;
    private?: unknown;
    archived?: unknown;
    has_issues?: unknown;
    owner?: { login?: unknown };
  };
  if (
    typeof r?.id !== "number" ||
    typeof r.name !== "string" ||
    typeof r.full_name !== "string" ||
    typeof r.owner?.login !== "string" ||
    r.archived === true ||
    r.has_issues === false
  ) {
    return [];
  }
  return [
    {
      id: r.id,
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      isPrivate: r.private === true,
    },
  ];
}

/** The user's own open pull requests across every repository, newest first. */
export async function listMyPullRequests(
  token: string,
  fetchImpl?: Fetch,
): Promise<GitHubPullRequest[]> {
  const q = encodeURIComponent("is:pr is:open author:@me archived:false");
  const data = (await github(
    token,
    `/search/issues?q=${q}&sort=updated&order=desc&per_page=${MAX_PULL_REQUESTS}`,
    {},
    fetchImpl,
  )) as { items?: unknown };
  return Array.isArray(data?.items) ? data.items.flatMap(toPullRequest) : [];
}

export function toPullRequest(raw: unknown): GitHubPullRequest[] {
  const i = raw as {
    number?: unknown;
    title?: unknown;
    body?: unknown;
    draft?: unknown;
    html_url?: unknown;
    repository_url?: unknown;
    user?: { login?: unknown };
  };
  if (
    typeof i?.number !== "number" ||
    typeof i.title !== "string" ||
    typeof i.html_url !== "string" ||
    typeof i.repository_url !== "string"
  ) {
    return [];
  }
  const description = typeof i.body === "string" ? i.body.trim() : "";
  return [
    {
      number: i.number,
      title: i.title,
      author: typeof i.user?.login === "string" ? i.user.login : "",
      description:
        description.length > MAX_DESCRIPTION_CHARS
          ? `${description.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…`
          : description,
      status: i.draft === true ? "draft" : "open",
      // https://api.github.com/repos/{owner}/{repo} → owner/repo
      repository: i.repository_url.replace(/^.*\/repos\//, ""),
      url: i.html_url,
    },
  ];
}

/** Validate the phone's issue request; returns a message on bad input. */
export function parseIssueInput(raw: unknown): IssueInput | string {
  const b = raw as { owner?: unknown; repo?: unknown; title?: unknown; body?: unknown };
  if (typeof b?.owner !== "string" || !NAME_RE.test(b.owner))
    return "A valid repository owner is required.";
  if (typeof b.repo !== "string" || !NAME_RE.test(b.repo))
    return "A valid repository name is required.";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return "An issue title is required.";
  if (title.length > MAX_TITLE_CHARS) return `Keep the title under ${MAX_TITLE_CHARS} characters.`;
  if (b.body != null && typeof b.body !== "string") return "The issue body must be text.";
  const body = typeof b.body === "string" && b.body.trim() ? b.body.trim() : null;
  if (body && body.length > MAX_BODY_CHARS) return "The issue body is too long.";
  return { owner: b.owner, repo: b.repo, title, body };
}

export async function createIssue(
  token: string,
  input: IssueInput,
  fetchImpl?: Fetch,
): Promise<CreatedIssue> {
  const data = (await github(
    token,
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`,
    {
      method: "POST",
      body: input.body ? { title: input.title, body: input.body } : { title: input.title },
    },
    fetchImpl,
  )) as { number?: unknown; title?: unknown; html_url?: unknown };
  if (typeof data?.number !== "number" || typeof data.html_url !== "string") {
    throw new GitHubError(502, "GitHub created the issue but sent an unexpected reply.");
  }
  return {
    number: data.number,
    title: typeof data.title === "string" ? data.title : input.title,
    repository: `${input.owner}/${input.repo}`,
    url: data.html_url,
  };
}
