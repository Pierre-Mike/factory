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

`new` pins the GitHub tag of the CLI's own version, so that tag must exist. To try an unreleased
checkout, pass `--harness file:<path>` and set `AXIOMS_ALLOW_LOCAL_HARNESS=1`, as the selftest does.

Every project's CI runs `check`, `smoke`, `deploy-dry-run`, `workflow-lint` (actionlint + zizmor)
and `pr-body` (the PR body fills every section of the PR template). Locally the workflow linters
come from `brew install actionlint zizmor`.

## What is in here

| Path | What it is |
|---|---|
| `harness/biome.rules.ts` | Source of the shared Biome config. `bun run build:biome` writes `biome.shared.json`. |
| `harness/grit/` | Grit plugins: no `throw`/`await` in cores, one parameter per declared function, no `.json() as T`. |
| `harness/canon.md` | The rules every agent loads. `axioms sync` copies them into a project's AGENTS.md. |
| `harness/notes.md` | The Agent Note rules. `axioms sync` copies them to a project's `.agents/notes/README.md`; `axioms notes` enforces them. |
| `harness/lefthook.yml` | Git hooks: format and the notes gate on commit, conventional commit messages, `axioms check` on push. |
| `cli/` | The `axioms` command. Pure logic in `*.core.ts`, file and process work in `commands/`. |
| `template/` | The app: Hono + Effect on Cloudflare Workers, D1, Vite + React + TanStack served as assets. |
| `tests/rules.test.ts` | Lints fixtures through the shared config and checks each rule fires where it should. |
| `tests/selftest.ts` | `new`, `sync`, `check`, `slice`, `smoke`, the deploy dry run and the CI dry run on a throwaway project, plus a deliberately broken workflow the CI dry run must catch and a malformed Agent Note the notes gate must reject. |

## How a project uses it

A project depends on `@pierre-mike/axioms`, pinned to a release tag (`github:Pierre-Mike/factory#v0.6.1`), and owns only its app code:

- `biome.json` extends `@pierre-mike/axioms/biome` and may not add rules (`axioms doctor` checks).
- `lefthook.yml` extends the harness hooks.
- `AGENTS.md` holds a copy of `harness/canon.md` between markers; `CLAUDE.md` is `@AGENTS.md`.
- `.agents/notes/` holds the project's decisions as Agent Notes, so one agent session can find
  what an earlier one decided. Its `README.md` is a copy of `harness/notes.md`.
- `tsconfig.base.json` extends `@pierre-mike/axioms/tsconfig`.

To roll out a harness change: tag a release here, bump the dependency in the project, run
`bunx axioms sync`, then `bun run check`.

## Changing the factory

```bash
bun install
bun run verify     # lint, typecheck, unit tests, rule fixtures
bun run selftest   # the full loop on a generated project (needs wrangler's local runtime)
bun run lock:template  # refresh template/bun.lock to the latest matching versions, then selftest
```

`template/bun.lock` pins the versions the selftest ran against. New projects start from it, so an
upstream release cannot break the factory's CI or a fresh project until the lockfile is refreshed.
