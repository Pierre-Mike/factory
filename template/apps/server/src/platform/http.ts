/**
 * HTTP error mapping and the one way a route answers.
 *
 * `STATUS_BY_TAG` is an allowlist. Registering a tag declares it safe to show the client at its
 * status. An unregistered tag, or a defect caught by `onUnexpectedError`, becomes a redacted
 * `InternalServerError` 500 and the real error is logged. Forgetting to register a tag fails safe.
 */
import { Effect, type ManagedRuntime, Result } from "effect"
import type { Context, ErrorHandler, NotFoundHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export interface TaggedError {
  readonly _tag: string
}

/** The part of the runtime a route needs. Tests pass a runtime built over stub layers. */
export type RouteRuntime<R> = Pick<ManagedRuntime.ManagedRuntime<R, never>, "runPromise">

const INTERNAL_SERVER_ERROR = { _tag: "InternalServerError" } as const

const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
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

/** Defects (throws that bypass the Result boundary) get the same redact-and-log treatment. */
export const onUnexpectedError: ErrorHandler = (err, c) => {
  console.error("unexpected defect reached the http boundary:", err)
  return c.json({ ok: false as const, error: INTERNAL_SERVER_ERROR }, 500)
}
