const KEY = "omni:remote-pending-submissions";
type Pending = Record<string, string>;

/** Keep uncertain submissions across reloads; only an acknowledgement clears them.
 * getRandomValues also works on plain-HTTP origins (randomUUID does not).
 */
export function submissionId(storage: Storage, scope: string[]): string {
  const pending: Pending = JSON.parse(storage.getItem(KEY) ?? "{}");
  const key = JSON.stringify(scope);
  if (pending[key]) return pending[key];
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  pending[key] = id;
  storage.setItem(KEY, JSON.stringify(pending));
  return id;
}

export function acknowledgeSubmission(storage: Storage, scope: string[], id: string): void {
  const pending: Pending = JSON.parse(storage.getItem(KEY) ?? "{}");
  const key = JSON.stringify(scope);
  if (pending[key] === id) {
    delete pending[key];
    storage.setItem(KEY, JSON.stringify(pending));
  }
}
