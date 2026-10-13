import { afterEach, describe, expect, test, vi } from "vitest";

const getUserOauthAccessToken = vi.fn();
vi.mock("@clerk/astro/server", () => ({
  clerkClient: () => ({ users: { getUserOauthAccessToken } }),
}));

const { createIssue, githubError, listMyPullRequests, parseIssueInput, toPullRequest, toRepo } =
  await import("./github.ts");
const { POST: postIssue } = await import("../pages/api/github/issues.json.ts");
const { GET: getPulls } = await import("../pages/api/github/pulls.json.ts");

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("GitHub shaping", () => {
  test("repos skip archived ones and ones with issues turned off", () => {
    const base = { id: 1, name: "omni", full_name: "maker-or/omni", owner: { login: "maker-or" } };
    expect(toRepo({ ...base, private: true })).toEqual([
      { id: 1, owner: "maker-or", name: "omni", fullName: "maker-or/omni", isPrivate: true },
    ]);
    expect(toRepo({ ...base, archived: true })).toEqual([]);
    expect(toRepo({ ...base, has_issues: false })).toEqual([]);
    expect(toRepo({ name: "broken" })).toEqual([]);
  });

  test("pull requests carry draft status, repo, and a trimmed description", () => {
    const [pr] = toPullRequest({
      number: 41,
      title: "Add Siri intents",
      body: `${"x".repeat(600)}`,
      draft: true,
      html_url: "https://github.com/maker-or/omni/pull/41",
      repository_url: "https://api.github.com/repos/maker-or/omni",
      user: { login: "harshith" },
    });
    expect(pr).toMatchObject({
      number: 41,
      author: "harshith",
      status: "draft",
      repository: "maker-or/omni",
    });
    expect(pr!.description.length).toBe(501);
    expect(toPullRequest({ number: 1, title: "t" })).toEqual([]);
  });

  test("the PR search asks only for the user's own open PRs, capped", async () => {
    const { impl, calls } = stubFetch(200, { items: [] });
    await listMyPullRequests("tok", impl);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/search/issues");
    expect(url.searchParams.get("q")).toBe("is:pr is:open author:@me archived:false");
    expect(url.searchParams.get("per_page")).toBe("10");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  test("issue input requires owner, repo, and title; body is optional", () => {
    expect(parseIssueInput({ owner: "maker-or", repo: "omni", title: "  Crash  " })).toEqual({
      owner: "maker-or",
      repo: "omni",
      title: "Crash",
      body: null,
    });
    expect(parseIssueInput({ owner: "maker-or", repo: "omni", title: " " })).toBe(
      "An issue title is required.",
    );
    expect(parseIssueInput({ owner: "../etc", repo: "omni", title: "x" })).toBe(
      "A valid repository owner is required.",
    );
    expect(typeof parseIssueInput({ owner: "a", repo: "b", title: "x", body: 3 })).toBe("string");
  });

  test("createIssue posts only title and body to the chosen repo", async () => {
    const { impl, calls } = stubFetch(201, {
      number: 7,
      title: "Crash",
      html_url: "https://github.com/a/b/issues/7",
    });
    const issue = await createIssue(
      "tok",
      { owner: "a", repo: "b", title: "Crash", body: null },
      impl,
    );
    expect(issue).toEqual({
      number: 7,
      title: "Crash",
      repository: "a/b",
      url: "https://github.com/a/b/issues/7",
    });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/a/b/issues");
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ title: "Crash" });
  });

  test("GitHub failures become messages the phone can speak", () => {
    expect(githubError(401).status).toBe(409);
    expect(githubError(404).message).toContain("approve Pipper");
    expect(githubError(410).message).toContain("turned off");
    expect(githubError(500).status).toBe(502);
  });
});

describe("/api/github routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getUserOauthAccessToken.mockReset();
  });

  function context(auth: { isAuthenticated: boolean; userId?: string }, body?: unknown) {
    return {
      locals: { auth: () => auth },
      request: new Request("https://www.pipper.dev/api/github/issues.json", {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    } as never;
  }

  test("signed-out callers get 401 and never touch GitHub", async () => {
    const res = await getPulls(context({ isAuthenticated: false }));
    expect(res.status).toBe(401);
    expect(getUserOauthAccessToken).not.toHaveBeenCalled();
  });

  test("users without a GitHub connection are told to sign in with GitHub", async () => {
    getUserOauthAccessToken.mockResolvedValue({ data: [] });
    const res = await getPulls(context({ isAuthenticated: true, userId: "user_1" }));
    expect(res.status).toBe(409);
    expect(getUserOauthAccessToken).toHaveBeenCalledWith("user_1", "github");
  });

  test("filing an issue uses the user's GitHub token and returns its link", async () => {
    getUserOauthAccessToken.mockResolvedValue({ data: [{ token: "gh-token" }] });
    const { impl, calls } = stubFetch(201, {
      number: 9,
      title: "Crash",
      html_url: "https://github.com/a/b/issues/9",
    });
    vi.stubGlobal("fetch", impl);
    const res = await postIssue(
      context(
        { isAuthenticated: true, userId: "user_1" },
        { owner: "a", repo: "b", title: "Crash" },
      ),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      issue: {
        number: 9,
        title: "Crash",
        repository: "a/b",
        url: "https://github.com/a/b/issues/9",
      },
    });
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer gh-token",
    );
  });

  test("bad issue input is rejected before calling GitHub", async () => {
    getUserOauthAccessToken.mockResolvedValue({ data: [{ token: "gh-token" }] });
    const { impl, calls } = stubFetch(201, {});
    vi.stubGlobal("fetch", impl);
    const res = await postIssue(
      context({ isAuthenticated: true, userId: "user_1" }, { owner: "a", repo: "b" }),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
