---
name: commit
description: Save the workspace's current changes as a commit, optionally pushing.
---

Commit the current changes in this workspace. The context block at the end lists what Pipper already knows; use it instead of guessing.

Staging:

- If the context lists `files-to-stage`, stage exactly those paths (new files included) and nothing else. Do not use `git add -A`, `git add .`, or any other blanket staging.
- If the context says `files-list-complete: false`, the list was cut short. Run `git status` first and review every changed path (new files included) before staging.
- If the context lists `files-that-look-like-secrets`, these changed paths look like secrets and must stay out of the commit. Do not stage them.

Committing:

- Write a concise commit message that describes what changed and why, in the imperative mood. Follow the repository's existing message style if one is evident from `git log`.
- Commit with `git commit -m` so nothing opens an editor.
- If a pre-commit hook or check fails (formatting, lint, type errors, tests), fix the underlying problem, re-stage the affected files, and commit again.

Pushing:

- If the context says `push: true`, push the branch to origin, setting the upstream if it has none (`git push -u origin <branch>`). If a pre-push hook fails, fix it and push again.
- If the context says `push: false`, do not push.

Report the commit hash and, when pushing, whether the push succeeded.
