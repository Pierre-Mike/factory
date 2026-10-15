# Agent Note: the harness ships tdd, peer-review and pull-request skills

Status: implemented

## Problem

[Skills and Claude Code settings ship with the harness](./2026-10-15-skill-config-distribution.md)
built a path that copies `harness/skills/` into every project, but nothing travels on it. Agents
in factory projects write tests, review diffs and open PRs with whatever general habits they
bring. Those habits don't know the project's three test layers, its canon, its Agent Notes, or the
`axioms pr-body` gate, which fails any PR whose body skips a template section. Good public skill
libraries exist, but each one assumes its own setup: other skills it calls, helper binaries, a
glossary file, a different PR template.

## Decision

`harness/skills/` holds three skills. Each is a folder with a `SKILL.md`, one reference file and a
`CREDITS.md`:

- `tdd/` (with `examples.md`): red, green and refactor in vertical slices; a fixed map from
  behavior to test layer (`*.core.test.ts`, `*.routes.test.ts`, `smoke/`), so the agent doesn't
  ask where a test goes; the "break the behavior, change the internals" check for every test;
  assertions on `_tag`, never messages; fakes only at `*.io.ts` services through
  `Layer.succeed`; a bug-fix path that reports the failing run and the passing run. It keeps the
  name `tdd`, so inside a factory project it takes precedence over a personal skill of the same
  name.
- `peer-review/` (with `briefs.md`): three axes reported separately and never reranked.
  Standards checks the canon and the notes rules, Spec checks the owning Agent Note, and Gate
  integrity looks for weakened checks. The gates run first (`bun run check`), and reviewers skip
  anything a gate enforces. Findings are filtered (traced hypotheticals, no preference findings,
  about five actions at most, a dismissed list), and every gate integrity finding goes to the
  human. The skill only reports and never edits code.
- `pull-request/` (with `example-body.md`): the body is built from the repo's own
  `.github/PULL_REQUEST_TEMPLATE.md` headings and the owning note, written to a file under the
  git dir, checked with `bunx axioms pr-body <file>` until it passes, and posted with
  `gh pr create --body-file` only after the user confirms. Titles follow the commit format. The
  skill stops rather than invent a note path.

None of them is vendored. Each adapts ideas from MIT-licensed libraries
([mattpocock/skills](https://github.com/mattpocock/skills),
[backnotprop/pstack](https://github.com/backnotprop/pstack) and
[garrytan/gstack](https://github.com/garrytan/gstack)). The copyright and permission notice
travels in each skill's `CREDITS.md`, because sync copies every file into every project.

`tests/skills.test.ts` pins the set:

- the folder names;
- frontmatter whose `name` matches the folder, a description, and model invocation left on;
- a `CREDITS.md` that `SKILL.md` links to;
- every relative link resolving inside its own folder;
- every `bunx axioms <cmd>` and `bun run <script>` named in a skill existing in the CLI and the
  template's `package.json`;
- `pull-request/example-body.md` passing `sectionProblems` against both shipped PR templates.

## Alternatives considered

**Vendor the upstream skills as they are.** Each one depends on something a project doesn't have.
Pocock's skills call his setup skill and other skills and read a `GLOSSARY.md`. pstack's are
manual-only (`disable-model-invocation`) and call sibling skills and a per-user model list.
gstack's call about twenty binaries under `~/.claude/skills/gstack/bin`, send telemetry, and are
generated files marked "do not edit". A text-only copy would ship broken references to every
project.

**A `note-to-tasks` skill that publishes a note's acceptance criteria to GitHub Issues or Azure
Boards.** It was designed (one task format, a reference file per tracker, a marker so a re-run
doesn't create duplicates) and then dropped from this release at the user's request. Nothing was
built.

**Name the PR skill `pr`.** It was renamed to `pull-request` before it shipped, so the name says
what it does.

**Prefix the skills (`factory-tdd`) so they don't shadow personal skills.** Shadowing is what we
want here: inside a factory project the project's version is the one that knows the layers and
the gates.

**Make sync delete skills removed from the harness in the same change.** No skill is removed here,
and the distribution note defers stale-copy cleanup until the first removal. It stays deferred.

## Consequences

- Every project gets the three skills on its next `bunx axioms sync` after upgrading, and
  `axioms doctor` fails until it runs, as with any harness copy.
- A project can't tune these skills locally. An edit is drift. It changes them in the factory, or
  keeps its own differently named skill next to them.
- The skills repeat a few canon facts (layer names, the gates that run). The command test catches
  a renamed command, but nothing catches prose drift. When the canon changes, check the skills
  too.
- The `tdd` layer map assumes the app template. In a lite repo the skill falls back to that
  repo's own test layout.
- `bunx axioms pr-body <file>` isn't in the permission allowlist, because its argument varies.
  The pull-request skill prompts once per run for it, and for `git push` and `gh pr create`,
  which should prompt anyway.

## Verification

- `bun test tests/skills.test.ts`: 18 pass. The command check was seen to fail first (it read
  `bun run check:` in prose as an unknown `check:` script) before its pattern was fixed.
- `bun run test`: 272 pass. `tsc --noEmit` and `axioms notes` are clean.
- `bun run selftest`: `axioms new` syncs the skills, and every gate, including doctor's `skills`
  check, passes on the generated project. `bun run selftest:adopt`: the lite profile's sync is
  stable, and its check passes with the skills installed.
