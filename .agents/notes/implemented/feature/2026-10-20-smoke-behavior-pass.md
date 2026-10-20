# Agent Note: `axioms smoke` runs a behavior pass over every write route

Status: implemented

## Problem

The factory's gates check the shape of the code: pure cores, doors, the typed client, the
one-parameter rule. The A/B eval (#11) found no audited difference in quality between apps built
with and without the factory. The checks that did separate apps were about behavior, and every
app passes or fails them the same way whatever it does: a malformed or 1 MB body answered 500 in
run A (#12), error bodies can carry a stack trace or SQL, write routes accepted requests without a
session, and none of the 13 audited app versions rate-limited its login (#15).

## Decision

`axioms smoke` ends with a fifth gate, `behavior`, which runs against the same `wrangler dev`
after the project's smoke tests. `cli/commands/behavior.ts` does the I/O and `cli/behavior.core.ts`
holds every rule.

**Routes.** A Bun child imports `apps/server/src/api.ts` and prints
`buildApp(undefined).routes`. `AppType` is `ReturnType<typeof buildApp>`, so this is the route
list `AppType` describes, with the `/api` base path and every slice mount applied. Building the
app only wires handlers, so it needs no runtime. The gate keeps `POST`, `PUT`, `PATCH` and
`DELETE` routes, once each (a route with a validator appears once per handler), and drops `ALL`
entries, which are middleware. Every path parameter and wildcard becomes `1`.

**Probes.** Each write route gets two requests with `content-type: application/json` and no
cookie or authorization header: `{bad json`, and a well-formed JSON object of just over 1 MB. Each
answer must be a 4xx whose body is the `ApiErrorBody` envelope (`{ ok: false, error: { _tag } }`
with a string `_tag`). No body may contain a V8 stack frame (`at fn (file:line:col)`) or SQL: the
upper-case statement keywords (`SELECT … FROM`, `INSERT INTO`, `UPDATE x SET`, `DELETE FROM`,
`CREATE`/`DROP`/`ALTER TABLE`) or the database error texts `D1_ERROR`, `SQLITE_*` and
`no such table/column`. Every problem is printed as `✖ <METHOD> <path> (<probe>): <problem>`, so
the gate's evidence in `--json` names the route.

**Body limit.** The template's `api.ts` mounts `hono/body-limit` with `MAX_BODY_BYTES` (100 KiB)
in front of every route. Without it, on `wrangler dev`, a 1 MB body that matches the generated
slice's Schema answered 200 and echoed the megabyte back. The 1 MB probe passed only because its
key did not match the Schema. With the limit, the 1 MB probe tests the limit itself: `bodyLimit`
throws a 413 `HTTPException`, which `onUnexpectedError` answers as `PayloadTooLarge`.

**Sessions.** The template has no auth, so the session check turns itself on. The malformed-JSON
probe carries no session. Once any write route answers it with 401 or 403, the app has sessions,
and every other write route must answer 401 or 403 too, unless it is public. That also fixes the
order: a route checks the session before it reads the body, so an anonymous caller never gets a
body parsed. A fresh project has no route that answers 401, so the check reports itself off and
passes.

**Public routes.** A write route that needs no session, such as a login, is listed in
`apps/server/public-routes.json`: one JSON object of `"<METHOD> <path>": "<Agent Note path>"`,
with the path as Hono mounts it (`"POST /api/login"`) and the note under `.agents/notes/`. The
gate fails when the file has another shape, when a listed route is not a write route of the app,
when the note does not exist, or when the note does not contain the route string. The reason for
every opt-out is therefore in a note that one search finds. A public route still gets both body
probes.

**Login rate limiting is out of scope.** It is the fourth finding in #15. The template has no
login, and a limit is a property of one route's middleware rather than something a generic pass
can probe without knowing the credentials format. Once the template ships auth, the limit belongs
in that middleware with its own route test.

## Alternatives considered

**Read the routes statically.** `AppType` is a type, so a static read means either the TypeScript
compiler resolving Hono's schema type (slow and tied to Hono's internal type shape) or a regex
over `.post(` calls, which misses the `basePath` and every `.route()` prefix. The runtime list has
the full paths for free and is the same object `AppType` is the type of.

**Ask the running worker for its routes.** It would need a route the app exposes in production,
or a dev-only one the worker build has to strip. Importing `api.ts` under Bun runs the same code
`worker.ts` mounts.

**Turn the session check on with an explicit flag.** A `"sessions": true` in a config file would
catch an app that has auth on no write route at all. It is one more setting that an agent adding
auth must remember to flip, and a fresh project could not show it working. Detecting a 401 needs
no setting, and its blind spot is the same app the explicit flag misses when nobody flips it.

**Mark public routes in code** (a `public()` wrapper or a comment marker). The gate would have to
read source files to find them, and a marker carries no reason. One JSON file is a single place to
review, and the note link makes the reason checkable.

**Require 413 for the 1 MB body.** That would make the body limit itself the rule. The issue asks
for any 4xx with the envelope, and a project may reasonably reject a large body earlier, for
example at a session check.

## Consequences

- Every write route a project adds is probed by `axioms smoke` and in CI, with no test written
  for it. A route that parses its body with a raw `c.req.json()` answers 500 on malformed JSON
  and fails the gate by name; `jsonBody(schema)` passes.
- A route whose path parameter has a regex that `1` does not match answers the 404 envelope. That
  passes, so the probe then tested the router's edge, not the handler.
- Routes mounted outside `buildApp` (for example straight in `worker.ts`) are not probed.
- A project whose `buildApp` reads its runtime while it builds the app makes the route listing
  throw; the gate then fails with the error.
- Every request body is capped at 100 KiB. A route that needs more raises `MAX_BODY_BYTES`.
- The session check cannot catch an app with no session on any write route; that app looks the
  same as a fresh project.
- The probes may reach handlers in the throwaway smoke database. A route that writes on a
  malformed or oversized body has already failed the 4xx rule.

## Verification

- `cli/behavior.core.test.ts`: the route list, the probe paths and bodies, the verdicts, leak
  detection, the public routes file and the session check.
- `template/apps/server/src/api.test.ts`: a body over `MAX_BODY_BYTES` answers 413
  `PayloadTooLarge`, and one under it reaches the router.
- `bun run selftest`: `axioms smoke --json` on a project with a generated slice reports a passing
  `behavior` gate. A planted `POST /planted` that calls `c.req.json()` fails it, and the gate's
  evidence names `POST /api/planted`.
- By hand on a generated project: an auth middleware answering 401 on `POST /api/widgets/:id` and
  an open `POST /api/open` failed the gate, naming `POST /api/open`. Listing it in
  `apps/server/public-routes.json` with a note that names it passed.
