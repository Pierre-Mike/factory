# Agent Note: the template ships a JSON body validator

Status: implemented

## Problem

The web app calls the server through `hc<AppType>`, which types a request body only when the route
validates it with a Hono validator. Nothing in the template or the slice generator showed one. In
the Zeeter eval, one agent wrote its own validator and its own `InvalidBody` tag; the other never
found the pattern and changed its API (it moved a path parameter into the body) to avoid sending
a typed body. The rules said "decode at the edge" with shared Schema contracts, but nothing
connected a Schema to a request body.

## Decision

The template ships `apps/server/src/platform/validate.ts` with `jsonBody(schema)`, a
`hono/validator` `json` validator that decodes the body with `Schema.decodeUnknownResult`. A body
that does not match answers the shared envelope `{ ok: false, error: { _tag: "InvalidBody",
message } }` at 400; `InvalidBody` is registered in `STATUS_BY_TAG`. `message` is the Schema
error's text, which describes the client's own input. The validator types its input as the
Schema's encoded side, which is the body type `hc` asks the client for. A body that is not JSON
at all never reaches the Schema: `hono/validator` throws, and the boundary answers 400
`BadRequest` (see
[Hono's HTTPException keeps its status](../bug-fix/2026-10-20-http-exception-keeps-its-status.md)).

`axioms slice <feature>` generates an example `POST /:id` that uses `jsonBody` with a body Schema
declared in the routes file, a route test that posts a matching and a non-matching body, and a
smoke test that posts malformed JSON through the real worker. The canon's impureim sandwich
section names `jsonBody`.

## Alternatives considered

**Document the pattern in the canon only.** Both eval agents read the rules and still built
different things. A file in the template and a generated example are found by reading the code.

**Generate the body Schema in `shared/src`.** That is where a contract the web app sends belongs,
but the generator would also have to edit `shared/src/index.ts`, and the example body is a stub.
The generated comment says to move it to `shared/src` once the web app sends it.

**Use `@hono/standard-validator` with Effect's Standard Schema support.** One more dependency,
and its failure body is not the shared envelope.

## Consequences

- Every new project can send typed bodies from the web app without writing its own validator.
- A request without a JSON `content-type` is decoded as `{}`, so it fails the Schema with
  `InvalidBody` rather than a content-type error.
- The generated `POST` echoes its body and does not call the io service. It shows the validator;
  replacing it is part of writing the slice, like replacing the stub core.

## Verification

- `template/apps/server/src/platform/validate.test.ts`: a matching body answers 200 through the
  typed client (`testClient`, the `hc` the web app uses); a `@ts-expect-error` proves the client
  rejects a body of the wrong type at compile time; a non-matching body and a body without a JSON
  content type answer 400 `InvalidBody`; `{bad json` answers 400 `BadRequest`.
- `cli/slice.core.test.ts`: the generated routes, route test and smoke test contain the example.
- `bun run selftest` generates a slice and runs its route and smoke tests.
