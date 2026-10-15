# Agent Notes

An Agent Note records a decision or proposal that affects this codebase: why it was made and what
it gave up, the parts code and docs cannot carry. Sessions do not share memory. The notes are how
one session learns what an earlier one decided. `bunx axioms notes` enforces every rule marked
**gated**; `axioms check` and the pre-commit hook run it.

This file comes from the harness (`@pierre-mike/axioms`). `bunx axioms sync` rewrites it and
`axioms doctor` fails when it drifts. To change a rule, change `harness/notes.md` in the factory.

## Before you change anything

Search `.agents/notes/implemented/` and `.agents/notes/proposed/` for a note that already owns the
area you are about to touch, and read it. An implemented note is the current decision: follow it,
or write a new note that supersedes it. A rejected note records an idea that was turned down and
why. `archived/` is history, not authority.

## When to write one

Add or update a note in the same commit for lasting decision rationale that code, tests and docs
do not explain: new user-visible behavior, a contract shared across files, architecture, tooling or
process, test strategy, a data, wire or config format, a non-local bug fix, or any choice a
maintainer may reasonably revisit.

Mechanical or local edits are exempt: typos, formatting, local UI tweaks, a rename with no naming
rule behind it. Diff size is not the test.

- Substantial future work starts in `proposed/`.
- A decision already made in this change starts in `implemented/`.
- If a note already owns the decision, update it. Never write a parallel note.

## Layout and naming (gated)

Path: `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`.

- **Lifecycle** (top folder) is the note's status, and the note moves as it changes: `proposed`,
  `implemented`, `rejected`, plus `archived`.
- **Class** (nested folder) is the kind of decision. The set is closed (table below).
- **Filename:** `yyyy-mm-dd` is the day the topic was first proposed and never changes. The rest
  is a kebab-case topic.
- **No central index.** The folder tree is the index; `INDEX.md` is rejected.
- Folders appear with the first note in them. Do not create empty ones.
- Cross-references between notes are relative Markdown links, so the gate can check them.

| Class | Covers |
|---|---|
| `feature` | A new user-facing capability. |
| `bug-fix` | Corrects a defect or closes a gap a postmortem surfaced. |
| `simplification` | Removes code, behavior or surface area without adding capability. |
| `architecture` | How modules relate, slice boundaries, the runtime vocabulary. |
| `process` | Tooling, policy or workflow around the code: gates, package manager, CI. |
| `testing` | Test infrastructure and strategy. |

`refactor` is absent on purpose: "does observable behavior change?" already separates it from
`simplification`.

## The file format (gated)

The first lines are exactly:

```md
# Agent Note: <title>

Status: <status>

```

`Status:` must agree with the folder: `Status: proposed`, `Status: implemented`, or
`Status: rejected — <why, in one line>`. No dates and no authors: the filename holds the date and
git holds the rest.

Every note opens its body with `## Problem`, written so it stays true without the solution, and
every note has `## Alternatives considered`. Bespoke sections (schemas, wire contracts) may sit
between the required ones.

**`proposed/`**

```md
## Problem
## Proposal
## Alternatives considered
## Acceptance criteria
## Risks
```

Each acceptance criterion names an observable outcome and the check that could prove it false.
`## Risks` covers what could go wrong and what the change gives up.

**`implemented/`**

```md
## Problem
## Decision
## Alternatives considered
## Consequences
## Verification        (optional: the commands that pin the behavior, with results)
```

`## Decision` describes what shipped, in the present tense. `## Consequences` records what the
trade-off cost and bought. `## Proposal`, `## Plan`, `## Migration plan`, `## Acceptance criteria`
and `## Risks` may not appear here: they mean the proposal was never rewritten.

**`rejected/`** keeps the proposal as it was, with the verdict on the `Status:` line.

`## Alternatives considered` lists each real alternative and why it lost. Record alternatives,
never invent them: when there were none, say so in the section.

## Moving between lifecycles (gated)

A move updates `Status:` and satisfies the new folder's sections in the same commit.

- **proposed → implemented:** `git mv` the file and keep its date. Rewrite `## Proposal` into a
  present-tense `## Decision`, fold `## Acceptance criteria` and `## Risks` into
  `## Consequences` and `## Verification`, and replace plans with what shipped. Changing only the
  status word is not a promotion.
- **proposed → rejected:** add the reason to `Status:` and leave the rest as it was.
- Repair inbound links in the same commit: relative links out of active notes, and links from any
  Markdown file into a notes tree, must resolve.

## Keeping implemented notes current

When code later moves a file, renames a module or changes a default an implemented note names,
update the note in the same commit. Rewrite stale facts in place; do not append history.

Reversing a decision is not an update. It gets a new note, cross-linked both ways. Archive the old
one, or delete it once the successor keeps every rationale, alternative and consequence worth
keeping.

## Archiving and deletion

Judge a note by its future decision value, never by its age or length.

- **Delete** notes that only record a small UI tweak or a mechanical change.
- **Keep active** a note whose rationale, alternatives, data format, ownership boundary, security
  rule or reintroduction condition is likely to guide future work.
- **Archive** a finished, substantive decision that is unlikely to guide new work.
- **Never archive a proposal.** Reject it.
- **Keep a rejected note** only while its losing idea is still a tempting mistake.

To archive (gated): `git mv implemented/<class>/foo.md archived/<class>/foo.md`, insert
`Archived: YYYY-MM-DD` as line 4 below `Status: implemented` with no other edit, repair inbound
links, then run `bunx axioms notes --seal` to add the note's hash to `archived/manifest.json`.
Sealed notes are frozen: the gate fails on any later edit, move or deletion.
