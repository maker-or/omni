---
name: get-latest
description: Bring the base branch's new commits into this workspace, resolving conflicts.
---

Bring this workspace up to date with its base branch. The context block at the end names the base ref and the branch. Assume there will be conflicts and be ready to resolve them — that is the normal case, not an error.

Steps, in order:

1. `git fetch origin <base>` so the comparison is against what the team actually has.
2. Check for uncommitted work with `git status`. If the tree is dirty, commit it first on the current branch (a plain descriptive message is fine) so nothing can be lost by the merge. Never stash, and never discard changes.
3. Merge the base into this branch with `git merge <base-ref> --no-edit`. Use merge, never rebase: rebasing rewrites commits that may already be pushed.

If the merge reports conflicts:

- Resolve every conflicted file yourself. Open each one, understand what both sides intended, and write the version that keeps both intents. Do not blanket-resolve with `--ours` or `--theirs`, and never delete someone else's work to make a conflict go away.
- For lockfiles and generated files, prefer regenerating them with the project's own tooling over hand-editing.
- After resolving, run the project's checks (build, lint, tests) for the affected areas. A merge that compiles but breaks tests is not resolved.
- Stage the resolved files and complete the merge with `git commit --no-edit`.
- If you genuinely cannot resolve a conflict safely, run `git merge --abort` to put the workspace back exactly as it was, and explain what is in conflict and what the user needs to decide. Leaving the workspace mid-merge is not an acceptable outcome.

Do not push. Report, in plain language: what came in from the base, which files conflicted and how you resolved them, and whether the checks passed. If you committed the user's uncommitted work in step 2, say so and name the commit.
