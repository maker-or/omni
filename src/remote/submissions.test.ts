import { expect, it } from "vitest";
import { acknowledgeSubmission, submissionId } from "./submissions.ts";

it("reuses uncertain submissions across reloads and only clears the acknowledged request", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } as unknown as Storage;
  const scope = ["create", "project", "agent", "Fix login"];
  const first = submissionId(storage, scope);
  expect(submissionId(storage, scope)).toBe(first);
  expect(submissionId(storage, ["prompt", "thread", "Fix login"])).not.toBe(first);
  acknowledgeSubmission(storage, scope, "wrong-id");
  expect(submissionId(storage, scope)).toBe(first);
  acknowledgeSubmission(storage, scope, first);
  expect(submissionId(storage, scope)).not.toBe(first);
});
