# Harness skills

This directory holds the agent skills every project gets. The source lives in `harness/skills/`
in the factory (`@pierre-mike/axioms`). `bunx axioms sync` copies every file in that directory,
this README included, into the project's `.claude/skills/`, where Claude Code discovers project
skills. `axioms doctor` fails when a copy is missing or differs from the installed harness.

A skill is a folder holding a `SKILL.md` and the files it references. To add or change one, edit
`harness/skills/` in the factory and tag a release. An edit to a harness-owned file under
`.claude/skills/` is drift. `doctor` reports it and the next `sync` overwrites it. Both tools
leave files alone that the harness does not own, so a project may keep its own skills in the same
directory.

The harness ships these skills:

- `tdd`: test-first work across the core, route and smoke test layers.
- `peer-review`: a report-only review on three axes: canon standards, the owning Agent Note, and
  gate integrity.
- `pull-request`: a PR body built from `.github/PULL_REQUEST_TEMPLATE.md`, checked with
  `axioms pr-body` before it is posted.

Each skill's `CREDITS.md` names the open-source skills it adapts and carries their licenses.
