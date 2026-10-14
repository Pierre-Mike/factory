## Architecture: feature-first vertical slices

Code is organized by feature, not by layer. Each slice owns its full vertical:

```
apps/server/
  src/
    features/<feature>/
      <feature>.core.ts        # pure domain logic: no I/O, no Effect runtime
      <feature>.core.test.ts   # co-located unit test (data in, data out)
      <feature>.io.ts          # I/O as an Effect service (Context.Tag + Layer)
      <feature>.routes.ts      # Hono shell: impure read, pure core, respond
      <feature>.routes.test.ts # the route over an in-memory SQLite database
      <feature>.door.ts        # opt-in: the only file other slices may import
    platform/                  # runtime, typed config, HTTP errors, the SQL port
    api.ts                     # mounts every slice under /api, exports AppType
    worker.ts                  # composition root (Cloudflare Workers entry)
  migrations/                  # D1 migrations; tests run against the same files
  smoke/                       # HTTP checks against a running `wrangler dev`
apps/web/                      # Vite + React + TanStack Router + Query, served as Worker assets
shared/                        # effect Schema contracts used by server and web
```

## The impureim sandwich

- `*.core.ts` is pure. Failures are values: `Either`, `Option`, or `Data` tagged unions. No
  `Effect`, `Layer`, `Context`, async, I/O or clock. `Either`, `Option`, `Data` and `Schema` from
  `effect` are allowed.
- `*.io.ts` and `*.routes.ts` use Effect. Services are `Context.Tag`s, wiring is `Layer`s, and the
  runtime is a `ManagedRuntime` built in `platform/runtime.ts`.
- A route reads through the io service, calls the pure core, and responds. An `Either` from the
  core is `yield*`-ed inside `Effect.gen`, so a `Left` short-circuits as a typed failure.

## Rules (each one is enforced by a tool)

- Biome bans `Effect`/`Layer`/`Context`, `*.io` and `*.door` imports, `Date`, `Promise`,
  `console` and timers in `*.core.ts`. Grit plugins ban `throw` and `await` there.
- Functions you declare take at most one parameter. Pass an options object for more.
- No raw `fetch` and no `axios`. The web app calls the server through `hc<AppType>`. Only
  `*.io.ts` may call `fetch`, for external services.
- The app runs on Cloudflare Workers. `process` and `Bun` are banned in app code. Bun APIs are
  allowed only in `*.bun.ts` adapters, tests and tooling.
- Every `*.core.ts` has a sibling `*.core.test.ts`. Use fast-check for non-trivial pure logic.
- Configuration is decoded once from the Worker env in `platform/config.ts` with a Schema.
- Database rows are `unknown` until decoded with a Schema in the slice's `*.io.ts`.
- Failures cross HTTP as the shared `ApiErrorBody` envelope. `STATUS_BY_TAG` in
  `platform/http.ts` is an allowlist. An unregistered tag returns a redacted 500 and is logged.
- Shared Schema contracts live in `shared/src`. The web client decodes every response with them,
  and excess fields are rejected.
- Define `queryOptions` once. The route loader calls `ensureQueryData`, the component calls
  `useSuspenseQuery` on the same options.
- A slice may import another slice's `<feature>.door.ts` only, never its other files.
- Commits follow `type(scope)?: subject`. The commit-msg hook rejects anything else.
- `axioms doctor` fails when a part of this harness is missing or unwired.

## How to add a feature slice

1. `bun run slice <feature>` generates the files, mounts the route in `api.ts`, registers the
   Layer in `platform/runtime.ts` and the error tag in `platform/http.ts`. Never hand-copy a slice.
2. Add a migration in `apps/server/migrations/` if the slice stores data.
3. Write the pure logic in `<feature>.core.ts` and its test.
4. Replace the stub I/O in `<feature>.io.ts`.
5. Register new error tags in `platform/http.ts`.
6. Put contracts the web uses in `shared/src`.
7. (web) Add `<feature>.queries.ts` and `<feature>.route.tsx`.
8. Add a `smoke/<feature>.smoke.test.ts` that exercises the slice over real HTTP.
9. `bun run check`, then `bun run smoke`.

## Commands

```bash
bun install        # installs dependencies and git hooks
bun run dev        # wrangler dev (API, :8787) + vite (web, :5173)
bun run check      # lint, typecheck, co-location, doctor, tests, dead code and duplication
bun run smoke      # build the web app, start wrangler dev locally, run smoke/ over HTTP
bun run slice      # generate a feature slice
bun run deploy     # apply D1 migrations remotely, then wrangler deploy
bunx axioms sync   # rewrite this section and the hook config from the installed harness
```
