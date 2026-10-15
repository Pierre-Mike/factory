---
name: pull-request
description: Open or update a pull request in a factory project with a body built from the repo's PULL_REQUEST_TEMPLATE.md and the owning Agent Note, checked by `axioms pr-body` before it is posted. Use when the user asks to open, create, raise or update a PR, write or fix a PR description, or ship a branch for review.
---

# Pull request

A factory PR body is the author's contract. CI's `axioms pr-body` gate fails a PR if its body is
missing any `##` section of `.github/PULL_REQUEST_TEMPLATE.md` or leaves one empty, and
`gh pr create` never fills the template on its own. This skill builds the body from the template,
checks it locally with the same gate, and only then posts it.

## 1. Check the branch is ready

- Don't open a PR from the default branch. Find the base (`main` unless the user names another)
  and check there are commits on top of it: `git log <base>..HEAD --oneline`.
- Commit or set aside any uncommitted work first, and ask the user which they want if it's
  unclear.
- Run `bun run check`, plus `bun run smoke` when routes or wiring changed. A failing gate is a
  reason to stop, not something to mention in the body. Suggest the `peer-review` skill if the
  branch hasn't been reviewed yet.

## 2. Read the template

Read `.github/PULL_REQUEST_TEMPLATE.md` and take the `##` headings from the file itself. Don't
assume the standard four (What changed, Why, Verification, Owning Agent Note), because a project
may add more, and the gate requires every heading the file has. Copy each heading exactly: the
gate matches heading text character for character, so `## What Changed` counts as missing.

The template's `<!-- ... -->` comments are hints for you. Delete them. The gate strips comments,
so a section holding only a hint counts as empty.

## 3. Find the owning note

Use the note the branch added or changed under `.agents/notes/` (`git diff --name-only
<base>...HEAD -- .agents/notes`). Otherwise use the implemented note that owns the area. Read it.

If the change makes a lasting decision (see "When you decide something" in the canon block of
`AGENTS.md`) and no note owns it, stop and say so. Write the note first. Never invent a note path.
Purely mechanical changes need no note: say so in that section, and give the reason.

## 4. Fill each section

Write in the project's domain words, and skip preambles.

- **What changed**: one or two sentences on what a reviewer is about to read. Group commits by
  theme instead of pasting the log. Add at most one small visual when it's shorter than the prose
  would be: a file tree for a layout change, a call tree for a control-flow change, or a short
  `diff` block showing the shape of the change.
- **Why**: the problem and the decision, taken from the note's `## Problem` and `## Decision` (or
  `## Proposal`), not reconstructed from commit messages. Close with one line of risk:
  `**Door:** two-way` when it's cheap to revert, or `one-way` when it isn't (a migration that
  drops data, a published contract, a deleted endpoint), plus what else it could break.
- **Verification**: the commands you actually ran and what they showed, such as
  `bun run check: all gates passed` or `bun run smoke: 4 pass`. For a bug fix, give the test that
  failed before the fix and passes after it. "Tests are green" is a claim, so name the command and
  what it printed. List a gate you didn't run as not run, and say why. Never write it up as passed.
- **Owning Agent Note**: the repo-relative path, and whether this change created, updated or
  promoted the note.

Fill any extra section the project's template adds the same way: from the diff, the note and the
commands you ran.

[example-body.md](example-body.md) is a body that passes the gate against the shipped template.

## 5. Check the body with the gate

Write the body to a file outside the working tree with your file-writing tool, for example
`$(git rev-parse --git-dir)/PR_BODY.md`. Never pass it through a shell string, `echo` or a
heredoc. Then run:

```sh
bunx axioms pr-body "$(git rev-parse --git-dir)/PR_BODY.md"
```

Fix the body until the command exits 0. Write the body fresh on every run, and never reuse an
earlier one.

## 6. Title

Use the commit format `type(scope)?: subject`, at most 150 characters, with a type from `feat`,
`fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`, `style` or `revert`. For a
single-commit branch, reuse that commit's subject. Never put a version number in the title:
releases are a `package.json` bump plus a `vX.Y.Z` tag.

## 7. Post, after the user confirms

Pushing and opening a PR are visible to others, so show the user the title and body first and
wait for a yes. Then:

```sh
git push -u origin HEAD
gh pr create --base main --title "<title>" --body-file "$(git rev-parse --git-dir)/PR_BODY.md"
```

Add `--draft` when the user asks for a draft. For an open PR on this branch
(`gh pr view --json number,url`), update it instead:
`gh pr edit <number> --title "<title>" --body-file <file>`. Never use `--fill`, which replaces
the template with commit messages and fails the gate.

Report the PR URL. Don't merge it and don't enable auto-merge unless the user asks.

Sources and licenses: [CREDITS.md](CREDITS.md).
