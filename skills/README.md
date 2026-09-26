# Skills

Markdown protocols Pipper attaches to a prompt when it hands a task to an
agent (for example the workspace panel's **Save changes** or **Get latest**
buttons). They are bundled into the app at build time by
`src/lib/skill-bundle.ts`; agents never read these files from disk.

## Layout

```
skills/
  <group>/
    _common.md      # optional: shared rules prepended to every skill in the group
    <name>.md       # one skill per file
```

Every file needs frontmatter whose `name` matches the file name (without the
leading `_` for a preamble) and a one-line `description`:

```markdown
---
name: get-latest
description: Bring the base branch's new commits into this workspace.
---

Protocol prose goes here…
```

A malformed file fails the test suite (`src/lib/skill-bundle.test.ts`).

## Adding a skill

1. Create `skills/<group>/<name>.md` with the frontmatter above.
2. For a git skill, add `<name>` to `GIT_SKILL_IDS` in `src/lib/git-skills.ts`
   and write a `build…Prompt` in `src/lib/workspace-agent-prompt.ts` that
   supplies its facts through `contextBlock`. The bundle test fails if the id
   and the file disagree.

## Updating a skill

Edit the markdown and rebuild. The prose is the agent's behaviour, so a change
to what a button should do is usually a change here, not in code. Keep facts
(branch, paths, counts) out of the prose: they arrive in the
`workspace-context` block, where every string is a JSON literal, so
repository-controlled text can't be read as instructions.
