import { describe, expect, test, vi } from "vitest";

const clerkHandler = vi.fn(async () => new Response("clerk"));
vi.mock("@clerk/astro/server", () => ({ clerkMiddleware: () => clerkHandler }));

const { onRequest, bypassesClerk } = await import("../middleware.ts");

function run(pathname: string) {
  const next = vi.fn(async () => new Response("route"));
  const context = { url: new URL(`https://www.pipper.dev${pathname}`) };
  return { result: onRequest(context as never, next), next };
}

describe("site middleware", () => {
  test("laptop API routes skip Clerk (it would choke on their bearer credential)", async () => {
    clerkHandler.mockClear();
    const { result, next } = run("/api/remote/tunnel.json");
    expect(await (await result)!.text()).toBe("route");
    expect(next).toHaveBeenCalled();
    expect(clerkHandler).not.toHaveBeenCalled();
  });

  test("every other route still goes through Clerk", async () => {
    for (const path of ["/", "/auth", "/auth/complete", "/api/subscribe.json", "/api/remotex"]) {
      clerkHandler.mockClear();
      run(path);
      expect(clerkHandler, path).toHaveBeenCalled();
    }
    expect(bypassesClerk("/api/remote")).toBe(false);
  });
});
