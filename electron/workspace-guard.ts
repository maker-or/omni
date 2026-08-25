import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Path guard for ACP sessions: maps an agent session id to the filesystem
 * roots that session may touch. Seeded with the session's cwd (the worktree or
 * project root) so a worktree-bound agent can't read or write into a sibling
 * worktree. A target whose session is absent from the map is rejected —
 * registration is part of session establishment, so an unregistered session id
 * must not silently bypass containment. See docs/worktree.md "Threat model".
 */
export class WorkspaceGuard {
  private readonly rootsBySession = new Map<string, Set<string>>();

  /** Seed (or re-seed) the allowed roots for an ACP session with its cwd root. */
  register(agentSessionId: string, cwd: string): void {
    let root = resolve(cwd);
    try {
      root = realpathSync(root);
    } catch {
      // cwd may not exist yet in exotic cases; fall back to the resolved path.
    }
    this.rootsBySession.set(agentSessionId, new Set([root]));
  }

  release(agentSessionId: string | null | undefined): void {
    if (agentSessionId) this.rootsBySession.delete(agentSessionId);
  }

  clear(): void {
    this.rootsBySession.clear();
  }

  /**
   * Reject an agent file/terminal target that escapes its session's workspace
   * root(s). No-op when there is no session id (callers that never bind a
   * session). Uses `path.relative` — not `startsWith`, which would let
   * `/proj-evil` escape root `/proj`.
   */
  assertWithin(agentSessionId: string | undefined, targetPath: string): void {
    if (!agentSessionId) return;

    const roots = this.rootsBySession.get(agentSessionId);
    if (!roots || roots.size === 0) {
      throw new Error("Path outside workspace");
    }
    const resolved = this.resolveExistingPrefix(targetPath);
    for (const root of roots) {
      const rel = relative(root, resolved);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
    }
    throw new Error("Path outside workspace");
  }

  /**
   * Resolve a target path through its deepest *existing* ancestor's realpath so
   * a not-yet-created file still resolves through symlink-free parents (defeats
   * `../worktree-b` and a symlinked parent), then re-append the missing tail.
   */
  private resolveExistingPrefix(targetPath: string): string {
    let current = resolve(targetPath);
    const tail: string[] = [];
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) break;
      tail.unshift(basename(current));
      current = parent;
    }
    let real = current;
    try {
      real = realpathSync(current);
    } catch {
      // keep the resolved (non-real) path
    }
    return tail.length ? join(real, ...tail) : real;
  }
}
