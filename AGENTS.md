# AGENTS.md: factory

This repo is the harness that other projects install. A change here changes every project that
upgrades, so each change needs a test that proves it.

- A new or changed lint rule: edit `harness/biome.rules.ts`, run `bun run build:biome`, and add
  fixtures to `tests/rules.test.ts` for both the file shape it should catch and one it should not.
- A rule agents must follow: put it in `harness/canon.md` and name the tool that enforces it. A rule
  with no enforcement does not go in.
- CLI logic is pure in `cli/*.core.ts` with a co-located `*.core.test.ts`. File and process work
  lives in `cli/commands/`.
- Template changes: run `bun run selftest`. It generates a project and runs every gate plus the
  smoke test against `wrangler dev`.
- Functions you declare take one parameter (an options object when you need more).
- Commits follow `type(scope)?: subject`.
- Bump `version` in package.json and tag `vX.Y.Z` for anything projects should pick up.
