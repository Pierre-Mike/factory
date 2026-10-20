/**
 * Request bodies. `jsonBody(schema)` is the Hono validator for a JSON body: it decodes the body at
 * the edge with a Schema contract from shared/src, and a body that does not match answers the
 * registered 400 `InvalidBody` envelope before the handler runs. Because it is a Hono validator,
 * `hc<AppType>` types the body, so the web app calls `api.<x>[":id"].$post({ param, json })`.
 *
 * Malformed JSON never reaches the Schema: hono/validator throws an `HTTPException`, which
 * `onUnexpectedError` answers as a 400 `BadRequest`.
 */
import { Result, Schema } from "effect"
import { validator } from "hono/validator"
import { errorEnvelope } from "./http"

export const jsonBody = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownResult(schema)
  // Typing `value` as the Schema's encoded side is what `hc` reads as the request body type.
  return validator("json", (value: S["Encoded"], c) => {
    const result = decode(value)
    if (Result.isSuccess(result)) return result.success
    const invalid = { _tag: "InvalidBody", message: result.failure.message }
    const { body, status } = errorEnvelope(invalid)
    return c.json(body, status)
  })
}
