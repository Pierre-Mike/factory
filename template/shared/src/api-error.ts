/**
 * The shared error envelope. Every slice returns failures in this one shape —
 * `{ ok: false, error: { _tag, ... } }` — so clients (human or agent-written)
 * can rely on a single machine-parsable contract. Tags map to HTTP statuses in
 * apps/server/src/platform/http.ts; extra fields on `error` carry the tag's
 * payload (e.g. `received` on `InvalidVerboseFlag`) — `error` keeps an open
 * index signature because that payload is intentionally tag-specific and
 * isn't modeled per-tag here.
 */
import { Schema as S } from "effect"

export const ApiErrorBody = S.Struct({
  ok: S.Literal(false),
  error: S.Struct({ _tag: S.String }, S.Record({ key: S.String, value: S.Unknown })),
})

export type ApiErrorBody = S.Schema.Type<typeof ApiErrorBody>

/**
 * Runtime decode for RPC consumers asserting the envelope shape. Rejects
 * excess fields on the envelope itself (only `ok`/`error` are allowed) so a
 * drifted top-level field fails loudly instead of passing silently; the
 * tag-specific payload inside `error` stays open by design (see above).
 */
export const decodeApiErrorBody = S.decodeUnknownSync(ApiErrorBody, { onExcessProperty: "error" })
