# factory

The harness, CLI and app template behind my agent-built apps. It replaces copying
`ts-axioms-template`: projects install this package instead, so a rule fixed here reaches every
project with a version bump.

```bash
bun ~/Github/factory/cli/main.ts new my-app   # stamp, pin v<version>, install, format, commit
cd my-app
bun run check     # every gate
bun run smoke     # the real worker over HTTP
bun run slice x   # add a feature slice
bun run deploy:dry  # bundle the worker + apply migrations locally (no Cloudflare account)
bun run ci:dry      # replay ci.yml on a clean clone; pre-push runs it when CI/CD files change
```

This repo is private. Projects pin the harness as
`git+ssh://git@github.com/Pierre-Mike/factory.git#vX.Y.Z`, because bun fetches `github:` specs
without credentials and gets a 404. Bun hands a `git+ssh` spec to git, so git's auth applies:

- On a machine with no GitHub SSH key, rewrite SSH to HTTPS once so the gh credential helper
  answers: `git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"`.
- In CI, each job's `harness-access` step does the same rewrite with the `HARNESS_TOKEN` repo
  secret: a fine-grained token with read-only Contents access to `Pierre-Mike/factory`. Set it in
  each project with `gh secret set HARNESS_TOKEN`.

`new` pins the tag of the CLI's own version, so that tag must exist. To try an unreleased
checkout, pass `--harness file:<path>` and set `AXIOMS_ALLOW_LOCAL_HARNESS=1`, as the selftest does.

Every project's CI runs `check`, `smoke`, `deploy-dry-run`, `workflow-lint` (actionlint + zizmor),
`secret-scan` (gitleaks, also on every commit via the pre-commit hook) and `pr-body` (the PR body
fills every section of the PR template). Locally the workflow linters and the secret scanner come
from `brew install actionlint zizmor gitleaks`. On a CI runner each scanner is downloaded at an
exact version and refused unless the archive matches the SHA256 pinned in `cli/tools.core.ts`;
every GitHub Action is pinned by commit SHA.

`axioms baseline` counts the checks Biome, the tests and the notes gate report and compares them to
`gate-baseline.json`. A drop fails; after adding checks on purpose, run `axioms baseline --update`
and commit the file. The factory's own CI runs it as the `gate-baseline` job.

## What is in here

| Path | What it is |
|---|---|
| `harness/biome.rules.ts` | Source of the shared Biome config. `bun run build:biome` writes `biome.shared.json`. |
| `harness/grit/` | Grit plugins: no `throw`/`await` in cores, one parameter per declared function, no `.json() as T`. |
| `harness/canon.md` | The rules every agent loads. `axioms sync` copies them into a project's AGENTS.md. |
| `harness/notes.md` | The Agent Note rules. `axioms sync` copies them to a project's `.agents/notes/README.md`; `axioms notes` enforces them. |
| `harness/github.rules.json` | The default branch's GitHub ruleset. `axioms rules --apply` writes it to the repo via `gh api`; `axioms doctor` fails when the live rules or auto-merge drift. |
| `harness/skills/` | Agent skills. `axioms sync` copies the directory into a project's `.claude/skills/`; `axioms doctor` fails on drift. Holds only its README until the first skill ships. |
| `harness/claude.settings.json` | Source of a project's `.claude/settings.json`: a Claude Code permission allowlist for the project's own gate commands, nothing broader. |
| `harness/lefthook.yml` | Git hooks: format and the notes gate on commit, conventional commit messages, `axioms check` on push. |
| `cli/` | The `axioms` command. Pure logic in `*.core.ts`, file and process work in `commands/`. |
| `template/` | The app: Hono + Effect on Cloudflare Workers, D1, Vite + React + TanStack served as assets. |
| `tests/rules.test.ts` | Lints fixtures through the shared config and checks each rule fires where it should. |
| `tests/selftest.ts` | `new`, `sync`, `check`, `slice`, `smoke`, the deploy dry run and the CI dry run on a throwaway project, plus a deliberately broken workflow the CI dry run must catch and a malformed Agent Note the notes gate must reject. |
| `tests/selftest-adopt.ts` | `adopt` on a throwaway plain git repository: refusals, live hooks, sync stability, the lite `check` and its evidence report, the PR body gate and the notes gate, with no wrangler anywhere. |

## How a project uses it

A project depends on `@pierre-mike/axioms`, pinned to a release tag (`git+ssh://git@github.com/Pierre-Mike/factory.git#v0.10.0`), and owns only its app code:

- `biome.json` extends `@pierre-mike/axioms/biome` and may not add rules (`axioms doctor` checks).
- `lefthook.yml` extends the harness hooks.
- `AGENTS.md` holds a copy of `harness/canon.md` between markers; `CLAUDE.md` is `@AGENTS.md`.
- `.agents/notes/` holds the project's decisions as Agent Notes, so one agent session can find
  what an earlier one decided. Its `README.md` is a copy of `harness/notes.md`.
- `.claude/settings.json` and `.claude/skills/` are copies of `harness/claude.settings.json` and
  `harness/skills/` (`axioms doctor` checks); personal settings go in `.claude/settings.local.json`.
- `tsconfig.base.json` extends `@pierre-mike/axioms/tsconfig`.

To roll out a harness change: tag a release here, bump the dependency in the project, run
`bunx axioms sync`, then `bun run check`.

## Adopting an existing repo

`axioms adopt`, run at the root of any existing git repository, brings the lite harness there
without the app template: the gates, not the app.

```bash
cd some-existing-repo
bun ~/Github/factory/cli/main.ts adopt   # once released: bunx axioms adopt after pinning the tag
bun run check
git add -A && git commit -m "chore: adopt the axioms harness"
```

- Adopt stamps only the skeleton: the pinned `@pierre-mike/axioms` devDependency (same rules as
  `new`, including `--harness file:<path>` plus `AXIOMS_ALLOW_LOCAL_HARNESS=1` for testing), a
  `check` script, `"axioms": { "profile": "lite" }`, a CI workflow with the `check`,
  `secret-scan` and `pr-body` jobs, the template's `.github/PULL_REQUEST_TEMPLATE.md`,
  `.fallowrc.json`, and missing `.gitignore` entries. Every synced copy (AGENTS.md canon,
  CLAUDE.md, the notes rules, `.claude/settings.json` and `.claude/skills/`, biome.json,
  lefthook.yml) comes from `axioms sync`, which adopt runs.
- The `lite` profile changes `axioms doctor`: it checks the gates adopt installs (Biome, hooks,
  agent docs, notes rules, the Claude Code settings and skills, the pinned package, must-pass
  `check`, `secret-scan` and `pr-body` steps in CI) and skips the app-shaped ones (smoke, deploy,
  the tsconfig chain, workspace references, the Effect major).
- `axioms check` skips typecheck when the repo has no root `tsconfig.json` and the test run when
  there are no test files, each with a message; adopt never writes a tsconfig. A skipped gate
  passes, and `check --json` reports it with `"skipped"` and the reason. Every other gate runs as
  in a generated project, so expect findings in code the gates now cover.
- Adopting twice refuses and points to `bunx axioms sync`; outside a git repository it refuses.
  An existing ci.yml, PR template and `.fallowrc.json` are left alone, with a warning that says
  what the gates expect of them.

## License

All rights reserved. Versions up to v0.9.0 were published under the MIT license, and that grant
still covers copies of those versions.

## Changing the factory

```bash
bun install
bun run verify     # lint, typecheck, unit tests, rule fixtures
bun run selftest   # the full loop on a generated project (needs wrangler's local runtime)
bun run lock:template  # refresh template/bun.lock to the latest matching versions, then selftest
```

`template/bun.lock` pins the versions the selftest ran against. New projects start from it, so an
upstream release cannot break the factory's CI or a fresh project until the lockfile is refreshed.
