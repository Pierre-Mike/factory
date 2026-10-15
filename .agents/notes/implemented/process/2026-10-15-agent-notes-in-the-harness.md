# Agent Note: Agent Notes ship with the harness

Status: implemented

## Problem

Agents build these projects across many sessions, and one session does not see what another
decided. The canon in AGENTS.md carries the rules every project shares, but nothing carries a
project's own decisions: why a slice is shaped the way it is, which option lost, what a choice
costs. A later session re-opens settled questions or quietly reverses a decision it never saw.

## Decision

Every project the factory generates keeps its decisions as Agent Notes in
`.agents/notes/{proposed,implemented,rejected,archived}/{class}/yyyy-mm-dd-topic.md`, and the
harness enforces their shape the same way it enforces the lint rules.

- `harness/notes.md` holds the rules. `axioms sync` (and so `axioms new`) writes it to
  `.agents/notes/README.md`, and `axioms doctor` fails when the copy drifts.
- The workflow is in `harness/canon.md`, in the "Decisions: Agent Notes" section, so it reaches
  every agent through AGENTS.md whatever tool runs it: read the notes that touch an area before
  changing it, update the owning note instead of writing a second one, record a lasting decision
  in the same commit, promote a proposal by rewriting it, and say which note owns the change. The
  section also lists the required header and sections, so an agent can write a valid note without
  opening the README.
- `axioms notes` is the gate. The logic is pure in `cli/notes.core.ts`; `cli/commands/notes.ts`
  lists files through git, reads Markdown and hashes archived notes. It checks structure (closed
  lifecycle and class folders, filenames, no `INDEX.md`), format (header block, `Status:` matching
  the folder, required sections, no proposal-era headings in implemented notes), links (relative
  links out of active notes and into any notes tree), and the archive (sealed hashes in
  `archived/manifest.json`; `axioms notes --seal` adds new ones).
- `axioms check` runs the gate, so CI and the pre-push hook do too. The harness pre-commit hook
  runs it whenever a Markdown file is staged.
- The class set is fixed in the factory (`CLASSES` in `cli/notes.core.ts`). Unlike the skill's
  gate, there is no per-project `config.json`: a project changes the rules in the factory, as it
  does for Biome.

The factory follows the same rules for itself: this note lives in its own `.agents/notes/`, and
`bun run verify` runs the gate.

## Alternatives considered

**Copy the skill's `check-notes.ts` into each project** (what the `agent-notes` skill's
`init-notes.ts` does). It works without the skill, but each project then owns a copy that drifts
and needs its own upgrade step. The harness exists so that a rule fixed once reaches every project
with a version bump, so the gate lives in the `axioms` CLI instead.

**Ship the workflow as a project skill.** A copy of the `agent-notes` skill, adapted and synced
into each project, was built and then dropped before release. Skills load from tool-specific
folders (`.claude/skills/` for Claude Code, `.agents/skills/` for DeepSeek Harness and others), so
some agents would never see it, and a skill loads only when the agent decides the task matches.
The point is that every agent reads and updates the notes, so the instructions go where every
agent already looks: AGENTS.md. The cost is a longer canon in every session's context.

**Rely on each user's personal `agent-notes` skill.** A project would only get the workflow on
machines that have the skill, and that skill's setup step installs a second gate
(`.agents/scripts/check-notes.ts`), an AGENTS.md section and a `lefthook.yml` job, which duplicate
`axioms notes` and which `axioms sync` overwrites. The canon tells agents not to copy a second
gate into the project.

**Rely on the skill alone, with no gate.** Agents without the skill installed, or that skip it,
would write notes in any shape, and the lifecycle (proposed, then rewritten as implemented) is the
part agents get wrong most. The repo's rule is that a rule with no enforcement does not go in the
canon.

**Keep the decisions themselves in AGENTS.md.** It is loaded into every session, so it would grow
with every decision and cost context on every task. AGENTS.md carries the workflow, which has a
fixed size; the notes are read on demand, by the area being changed.

## Consequences

- New and synced projects get `.agents/notes/README.md`; lifecycle folders appear with the first
  note. Existing projects pick this up on `bun update @pierre-mike/axioms` plus `bunx axioms sync`,
  and their `check` fails until they sync, since doctor wants the README.
- The notes travel with `@pierre-mike/axioms`: the canon block, the hooks and `axioms check`. A
  future template that does not install the harness gets none of it. When such a template exists,
  split the notes into their own part of the harness (a notes-only hook file and AGENTS.md
  section that `sync` installs for every template), not before.
- Writing a note is still a judgment call the gate cannot make. It checks the shape and the links,
  not whether a decision that needed a note got one. No judge (an LLM reviewing each change for a
  missing note) is added here: that belongs to an orchestration layer, which this repository does
  not provide. Until one exists, the AGENTS.md instructions carry that part.
- Projects cannot add a class or loosen a rule locally. A project that needs another class asks
  for it here.
- The pre-commit hook runs the gate on every commit that stages Markdown. It lists files through
  git and reads only Markdown, so it stays fast on a repository of this size.

## Verification

- `bun run verify`: lint, typecheck, unit tests including `cli/notes.core.test.ts` (structure,
  format, links, archive and seal cases) and the doctor's notes finding, then the gate on this
  repository.
- `bun run selftest`: on a generated project, `axioms notes` rejects a proposal promoted by its
  status word only and accepts the rewritten note; `sync` on a fresh project leaves no diff, so the
  README is in place from `axioms new`.
