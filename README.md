# factory

The harness, CLI and app template behind my agent-built apps. It replaces copying
`ts-axioms-template`: projects install this package instead, so a rule fixed here reaches every
project with a version bump.

```bash
bun ~/Github/factory/cli/main.ts new my-app   # stamp, install, format, first commit
cd my-app
bun run check     # every gate
bun run smoke     # the real worker over HTTP
bun run slice x   # add a feature slice
bun run deploy:dry  # bundle the worker + apply migrations locally (no Cloudflare account)
bun run ci:dry      # replay ci.yml on a clean clone; pre-push runs it when CI/CD files change
```

Every project's CI runs `check`, `smoke`, `deploy-dry-run` and `workflow-lint` (actionlint +
zizmor). Locally the workflow linters come from `brew install actionlint zizmor`.

## What is in here

| Path | What it is |
|---|---|
| `harness/biome.rules.ts` | Source of the shared Biome config. `bun run build:biome` writes `biome.shared.json`. |
| `harness/grit/` | Grit plugins: no `throw`/`await` in cores, one parameter per declared function, no `.json() as T`. |
| `harness/canon.md` | The rules every agent loads. `axioms sync` copies them into a project's AGENTS.md. |
| `harness/lefthook.yml` | Git hooks: format on commit, conventional commit messages, `axioms check` on push. |
| `cli/` | The `axioms` command. Pure logic in `*.core.ts`, file and process work in `commands/`. |
| `template/` | The app: Hono + Effect on Cloudflare Workers, D1, Vite + React + TanStack served as assets. |
| `tests/rules.test.ts` | Lints fixtures through the shared config and checks each rule fires where it should. |
| `tests/selftest.ts` | `new`, `sync`, `check`, `slice`, `smoke`, the deploy dry run and the CI dry run on a throwaway project, plus a deliberately broken workflow the CI dry run must catch. |

## How a project uses it

A project depends on `@pierre-mike/axioms`, pinned to a release tag (`github:Pierre-Mike/factory#v0.5.0`), and owns only its app code:

- `biome.json` extends `@pierre-mike/axioms/biome` and may not add rules (`axioms doctor` checks).
- `lefthook.yml` extends the harness hooks.
- `AGENTS.md` holds a copy of `harness/canon.md` between markers; `CLAUDE.md` is `@AGENTS.md`.
- `tsconfig.base.json` extends `@pierre-mike/axioms/tsconfig`.

To roll out a harness change: tag a release here, bump the dependency in the project, run
`bunx axioms sync`, then `bun run check`.

## Changing the factory

```bash
bun install
bun run verify     # lint, typecheck, unit tests, rule fixtures
bun run selftest   # the full loop on a generated project (needs wrangler's local runtime)
```
