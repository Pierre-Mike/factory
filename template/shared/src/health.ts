/**
 * The `health` contract — single source of truth for the shape crossing the
 * client/server boundary. One effect `Schema` yields the runtime codec AND the
 * static type, so server and client can never drift silently: the web client
 * decodes responses with `decodeHealthStatus`, turning any drift into a loud
 * runtime `ParseError` instead of a quiet UI bug.
 */
import { Schema as S } from "effect"

export const HealthStatus = S.Struct({
  ok: S.Boolean,
  version: S.String,
  uptimeMs: S.Number,
  /** Present (and `true`) only when the request set `?verbose=1`/`?verbose=true`. */
  verbose: S.optional(S.Boolean),
})

export type HealthStatus = S.Schema.Type<typeof HealthStatus>

/**
 * Runtime decode for RPC consumers; throws a ParseError on contract drift —
 * including undocumented excess fields, so a server field added without a
 * matching contract change fails loudly instead of passing silently.
 */
export const decodeHealthStatus = S.decodeUnknownSync(HealthStatus, { onExcessProperty: "error" })
