# Agent Note: skills and Claude Code settings ship with the harness

Status: implemented

## Problem

A fresh clone of a factory project is not agent-ready. Claude Code starts with no permission
allowlist, so every gate command (`bun run check`, the hook-invoked `bunx axioms ...` commands)
stops the session for an approval, and each project grows its own hand-written
`.claude/settings.json` that drifts. Shared agent skills have no distribution path at all: a skill
written in one project reaches no other. The harness already solves this exact shape for the canon
and the Agent Note rules, but nothing under `.claude/` is covered.

## Decision

The harness owns two more whole-file copies, distributed like the notes README:

- `harness/skills/` is the factory's skills directory. `axioms sync` copies every file in it, its
  README included, into a project's `.claude/skills/`, where Claude Code discovers project skills.
  Each skill lands as an ordinary factory release; the ones that ship, and why, are in
  [the harness ships tdd, peer-review and pull-request skills](./2026-10-15-harness-skills-tdd-review-pr.md).
- `harness/claude.settings.json` is the source of a project's `.claude/settings.json`. It holds a
  permissions allowlist covering the project's own gate commands and nothing broader: the
  template's deterministic scripts (`bun run check`, `smoke`, `dev`, `lint`, `deploy:dry`,
  `ci:dry`) and the lefthook-invoked `bunx axioms ...` commands, plus `doctor` and `sync`, the two
  remedies doctor itself prescribes. `bun run deploy`, `axioms deploy` and argument-taking
  scaffolding such as `slice` stay out, so they still prompt a human. It configures no hooks.
- `axioms sync` installs both, so `axioms new` stamps them into every new project. The template
  also carries `template/.claude/settings.json`, byte-identical to the harness file, so the raw
  template matches what sync writes and the selftest's "sync changes nothing" step covers it.
- `axioms doctor` reports a `settings` finding when `.claude/settings.json` differs from the
  installed harness, and a `skills` finding for each harness-owned skill file that is missing or
  edited (`checkClaudeConfig` in `cli/doctor.core.ts`; `cli/commands/doctor.ts` reads the files,
  `harnessSkillFiles` in `cli/shell.ts` lists them). Files the harness does not own, such as a
  project's own skills, are left alone by both tools.
- Personal or per-machine permissions go in `.claude/settings.local.json`, which the template
  gitignores and sync never writes.

## Alternatives considered

**Merge project entries into the tracked settings instead of a whole-file copy.** Letting a
project add its own allow entries needs a parser-aware sync and a doctor that judges which entries
are local. The file is security-relevant, so prefer the strict copy: local additions go in
`.claude/settings.local.json`, which Claude Code merges on its own and which never reaches another
clone.

**Install skills into `.agents/skills/` instead of `.claude/skills/`.** Pi and DeepSeek-style
harnesses read skills from `.agents/skills`, and this user links Claude's and pi's skill folders
together at the machine level through `~/.agents/skills` symlinks. That is per-user setup, out of
scope for a repo the factory manages. The project copy goes to `.claude/skills/`, the location
Claude Code reads per project; another harness can be pointed at the same files later without
moving the source of truth out of `harness/skills/`.

**Allowlist by prefix (`Bash(bunx axioms:*)`).** One prefix covers every gate, but it also covers
`axioms deploy`. Exact entries per command keep a real deploy behind a human approval, at the cost
of editing `harness/claude.settings.json` when a gate is added. Only the two hook commands with
variable arguments (`commit-msg`, the staged-files biome run) use a prefix, and
`tests/claude-config.test.ts` pins that list.

**Move the Agent Note workflow into a distributed skill.**
[Agent Notes ship with the harness](./2026-10-15-agent-notes-in-the-harness.md) decided against a
skill because a skill loads only when the agent judges the task to match, and only in harnesses
that read the folder. That decision stands: the canon keeps the notes workflow, and this mechanism
carries skills that may stay optional.

**Wait for the first real skill before building the mechanism.** The settings file is useful now,
and an empty mechanism keeps the first skill a content-only change. The seeded README also gives
`sync` and `doctor` a real file to copy and check from day one.

## Consequences

- A fresh `axioms new` project, and a fresh clone of any synced project, runs its gates without
  permission prompts. Everything else still prompts.
- Existing projects fail `axioms doctor` (so `check` and CI) after upgrading, until they run
  `bunx axioms sync`. The notes README rolled out the same way.
- A project cannot extend the tracked settings file. The escape hatch is
  `.claude/settings.local.json`; a project that needs a shared entry changes
  `harness/claude.settings.json` in the factory.
- Removing a skill from `harness/skills/` stops the drift check for its files but does not delete
  project copies. No skill has been removed yet; revisit when the first removal happens.
- The allowlist names script invocations such as `bun run check`, so what they run is only as
  fixed as `package.json`. Doctor already pins the `check` and `smoke` scripts to
  `axioms check` and `axioms smoke`.

## Verification

- `bun run verify`: the `settings` and `skills` cases in `cli/doctor.core.test.ts` (missing and
  edited settings, missing and edited skill files, silent when the copies match) and
  `tests/claude-config.test.ts` (template copy byte-identical to the harness file; allowlist shape
  pinned: Bash rules only, no deploy, no install, no hooks, exactly two prefix wildcards).
- `bun run selftest`: `axioms new` leaves a project where a second `sync` changes nothing, so the
  settings and skills copies are in place from the first commit, and `check (fresh)` passes
  doctor with the new findings wired.
