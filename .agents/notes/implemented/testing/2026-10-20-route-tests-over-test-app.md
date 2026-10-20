# Agent Note: route tests run the real app over in-memory SQLite

Status: implemented

## Problem

The canon describes `<feature>.routes.test.ts` as "the route over an in-memory SQLite database",
and the template ships `platform/sql.bun.ts`, which applies the D1 migrations to a bun:sqlite
database. Nothing connects the two. A route test needs the app, a runtime, a config and a
database, and no file builds them, so each agent writes its own fixture in its own shape. The code
`axioms slice` generates did something else again: it built the slice's sub-app over
`Layer.succeed(<Feature>Io, { ... })`, so the generated route test never reached SQL, a migration
or `api.ts`. Agents that follow the canon and agents that copy the generated code disagree, and
neither has a shared fixture to reach for (issue #7).

## Decision

The template ships `apps/server/src/platform/test-app.bun.ts`. `testApp()` builds a fresh
`bunSql()` database, which applies every migration in `apps/server/migrations`, and returns
`{ request, db }`: `request` is `app.request` of the real `buildApp(makeAppRuntime(...))`, with
the config decoded from an empty env. Paths carry the `/api` prefix. `db` lets a test seed rows or
read what a request wrote. Each call gets its own database. `test-app.bun.test.ts` checks both.

`axioms slice` generates `<feature>.routes.test.ts` on top of it: `const { request } = testApp()`
and `request("/api/<feature>?id=abc")`, with no `Layer.succeed` or `ManagedRuntime`. The generated
`<feature>.io.ts` stub reads through `deps.db` (`SELECT ? AS id`, which needs no table) and
decodes the row with a Schema, so the generated route test goes through the SQL port from the
first run, and replacing the stub means changing one query. A row that fails to decode is a
defect (`Effect.orDie`), which the boundary logs and redacts to a 500.

The canon's slice tree and the `tdd` skill name `testApp()` as the way to run a route test; a
`ManagedRuntime` over test Layers stays for a service that has to be faked, such as the health
slice's clock.

## Alternatives considered

**Keep the stubbed Layer and fix the canon text instead.** The stub is quicker but tests nothing
the core test does not: no SQL, no migration, no mount in `api.ts`. The eval runs showed agents
wanting the documented shape, and building it twice.

**A fixture that returns the slice's sub-app over a runtime with the SQL port.** It needs a
per-slice runtime builder and drifts from `platform/runtime.ts`. The whole app costs nothing extra
in bun:sqlite and checks the mount too.

**Generate a migration and a table per slice.** It makes the route test hit a real table, but most
slices are not named after a table and some own none. The stub query needs no schema, and the
next steps say to add a migration when the slice stores data.

## Consequences

- Route tests print Hono's access log, since they run the real `api.ts` with its logger.
- A broken migration now fails every generated route test, not only `deploy --dry-run`.
- Existing projects keep their old generated tests; `testApp()` is available to them once they
  copy `test-app.bun.ts` from the template, which `axioms sync` does not manage.

## Verification

- `cli/slice.core.test.ts`: the generated route test imports `testApp` from
  `../../platform/test-app.bun`, requests `/api/items?id=abc`, and has no `Layer.succeed` or
  `ManagedRuntime`; the generated io stub calls `deps.db.first(` and decodes with a Schema.
- `bun run selftest`: after `axioms slice widgets` it adds `migrations/0001_widgets.sql` (a
  `widgets` table holding the row `abc`) and points the stub at `SELECT id FROM widgets WHERE id =
  ?`. The generated route test answers 200 for `abc` only if `testApp()` applied the migration, and
  `bun run smoke` only if wrangler's local D1 did.
