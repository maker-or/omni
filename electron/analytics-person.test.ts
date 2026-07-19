import { describe, expect, test } from "vitest";
import { buildPersonProperties } from "./analytics-person.ts";

describe("buildPersonProperties", () => {
  test("sets reserved $keys and bare aliases for PostHog person profiles", () => {
    expect(
      buildPersonProperties({
        providerUserId: "user_abc",
        email: "  you@example.com ",
        name: " Ada Lovelace ",
        avatarUrl: " https://img.clerk.com/avatar.png ",
      }),
    ).toEqual({
      $email: "you@example.com",
      email: "you@example.com",
      $name: "Ada Lovelace",
      name: "Ada Lovelace",
      $avatar: "https://img.clerk.com/avatar.png",
      avatar: "https://img.clerk.com/avatar.png",
    });
  });

  test("omits blank optional fields", () => {
    expect(
      buildPersonProperties({
        providerUserId: "user_abc",
        email: "you@example.com",
        name: "   ",
        avatarUrl: null,
      }),
    ).toEqual({
      $email: "you@example.com",
      email: "you@example.com",
    });
  });

  test("returns empty object when no profile fields are present", () => {
    expect(
      buildPersonProperties({
        providerUserId: "user_abc",
        email: null,
        name: undefined,
        avatarUrl: "",
      }),
    ).toEqual({});
  });
});
