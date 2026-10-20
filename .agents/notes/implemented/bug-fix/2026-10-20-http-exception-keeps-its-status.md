# Agent Note: Hono's HTTPException keeps its status at the boundary

Status: implemented

## Problem

The template's error handler (`onUnexpectedError` in `apps/server/src/platform/http.ts`) treats
every thrown error as a defect: it logs it and answers a redacted `InternalServerError` 500. Hono
and its middleware throw `HTTPException` on purpose for client errors. `hono/validator` throws a
400 on a malformed JSON body, `bodyLimit` a 413, the auth middleware a 401. Each of these reached
the client as a 500, and a malformed body looked like a server bug in the logs.

## Decision

`onUnexpectedError` checks for `HTTPException` first. `TAG_BY_HTTP_EXCEPTION_STATUS` maps the
statuses Hono's own middleware throws to a tag:

| Status | Tag |
|---|---|
| 400 | `BadRequest` |
| 401 | `Unauthorized` |
| 403 | `Forbidden` |
| 413 | `PayloadTooLarge` |

Each tag is registered in `STATUS_BY_TAG` at that status, and the handler answers through
`errorEnvelope`, so the body is the shared `ApiErrorBody` envelope and is not logged. An
`HTTPException` with any other status, and every other thrown error, stays a logged, redacted 500.
The exception's message is not sent: the tag is the contract.

The tags are created in `platform/http.ts`, which `axioms doctor` counts since
[allowlisted tags may be defined anywhere in server src](2026-10-20-allowlisted-tags-defined-anywhere-in-server-src.md).

## Alternatives considered

**Answer with `err.getResponse()`.** Hono's default. It sends plain text, so a client could no
longer rely on one envelope for every failure.

**Keep any 4xx status, with a generic tag.** It would cover statuses no current middleware throws
by giving them a tag the client cannot act on. A status gets a tag when a real case needs it;
until then it fails safe, like an unregistered tag.

**Forward the exception's message.** It is free text written for developers. Some middleware puts
internal detail in it.

## Consequences

- A malformed JSON body now answers 400 `BadRequest`, before any route code runs.
- Headers the exception carries in `err.res` (such as `WWW-Authenticate` from `basicAuth`) are
  dropped. A project that needs them adds them in the handler.
- A project that throws `HTTPException` with an unmapped status gets a 500 and a log line, and
  adds the status to the map with a registered tag.

## Verification

- `template/apps/server/src/platform/http.test.ts`: each mapped status answers itself with its tag
  and logs nothing; `{bad json` posted through `hono/validator` answers 400 `BadRequest`; a 418 or
  503 `HTTPException` and a plain `Error` answer a redacted 500 and are logged.
- `bun run selftest` runs `axioms check` on a generated project.
