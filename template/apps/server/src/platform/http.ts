/**
 * HTTP error mapping and the one way a route answers.
 *
 * `STATUS_BY_TAG` is an allowlist. Registering a tag declares it safe to show the client at its
 * status. An unregistered tag, or a defect caught by `onUnexpectedError`, becomes a redacted
 * `InternalServerError` 500 and the real error is logged. Forgetting to register a tag fails safe.
 * Hono's own `HTTPException` (thrown by `hono/validator` on malformed JSON, by `bodyLimit`, by the
 * auth middleware) keeps its 4xx status through a tag in `TAG_BY_HTTP_EXCEPTION_STATUS`.
 */
import { Effect, type ManagedRuntime, Result } from "effect"
import type { Context, ErrorHandler, NotFoundHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export interface TaggedError {
  readonly _tag: string
}

/** The part of the runtime a route needs. Tests pass a runtime built over stub layers. */
export type RouteRuntime<R> = Pick<ManagedRuntime.ManagedRuntime<R, never>, "runPromise">

const INTERNAL_SERVER_ERROR = { _tag: "InternalServerError" } as const

const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
  InvalidBody: 400,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  PayloadTooLarge: 413,
}

/** The tag an `HTTPException` answers with, by its status. Each one is registered above. */
const TAG_BY_HTTP_EXCEPTION_STATUS: Readonly<Record<number, string>> = {
  400: "BadRequest",
  401: "Unauthorized",
  403: "Forbidden",
  413: "PayloadTooLarge",
}

export const errorEnvelope = (error: TaggedError) => {
  // hasOwn, so a tag named like an Object.prototype key ("constructor") is not "registered".
  const status = Object.hasOwn(STATUS_BY_TAG, error._tag) ? STATUS_BY_TAG[error._tag] : undefined
  if (status === undefined) {
    console.error("unregistered error tag reached the boundary:", error)
    return {
      body: { ok: false as const, error: INTERNAL_SERVER_ERROR },
      status: 500 as ContentfulStatusCode,
    }
  }
  return { body: { ok: false as const, error }, status }
}

/** Run a route's program and answer: the value as JSON, or the shared error envelope. */
export const respond = async <A, E extends TaggedError, R>(input: {
  readonly c: Context
  readonly runtime: RouteRuntime<R>
  readonly program: Effect.Effect<A, E, R>
  readonly status?: ContentfulStatusCode
}) => {
  const result = await input.runtime.runPromise(Effect.result(input.program))
  if (Result.isFailure(result)) {
    const { body, status } = errorEnvelope(result.failure)
    return input.c.json(body, status)
  }
  return input.c.json(result.success, input.status ?? 200)
}

/** An unknown /api route answers with the same envelope, so a client never parses plain text. */
export const onNotFound: NotFoundHandler = (c) =>
  c.json({ ok: false as const, error: { _tag: "NotFound" } as const }, 404)

/**
 * A thrown error bypassed the Result boundary. An `HTTPException` with a tagged status answers at
 * that status; anything else is a defect and gets the same redact-and-log treatment as an
 * unregistered tag.
 */
export const onUnexpectedError: ErrorHandler = (err, c) => {
  const tag = err instanceof HTTPException ? TAG_BY_HTTP_EXCEPTION_STATUS[err.status] : undefined
  if (tag !== undefined) {
    const { body, status } = errorEnvelope({ _tag: tag })
    return c.json(body, status)
  }
  console.error("unexpected defect reached the http boundary:", err)
  return c.json({ ok: false as const, error: INTERNAL_SERVER_ERROR }, 500)
}
