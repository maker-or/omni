import { describe, expect, test } from "vitest";
import {
  isAllowedClerkAuthUrl,
  resolveClerkSignInUrl,
  resolveClerkSignUpUrl,
} from "./clerk-auth-config.ts";
import {
  PIPPER_CLERK_SIGN_IN_URL,
  PIPPER_CLERK_SIGN_UP_URL,
} from "../contracts/launcher-release-urls.ts";

describe("clerk auth config", () => {
  test("uses hardcoded pipper.dev auth URLs", () => {
    expect(resolveClerkSignInUrl()).toBe(PIPPER_CLERK_SIGN_IN_URL);
    expect(resolveClerkSignUpUrl()).toBe(PIPPER_CLERK_SIGN_UP_URL);
  });

  test("allows pipper.dev auth URLs", () => {
    expect(isAllowedClerkAuthUrl("https://www.pipper.dev/auth?return_to=test")).toBe(true);
  });
});
