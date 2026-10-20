import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { errorEnvelope, onNotFound, onUnexpectedError, respond } from "./http"

const runtime = ManagedRuntime.make(Layer.empty)

// The redaction path logs on purpose. Capture the log so a green run prints no stack trace, and
// assert on it so the test fails if the boundary stops logging.
let consoleError: Mock<typeof console.error>
beforeEach(() => {
  consoleError = spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  consoleError.mockRestore()
})

describe("errorEnvelope", () => {
  it("passes a registered tag through at its status, without logging", () => {
    const error = { _tag: "InvalidVerboseFlag", received: "x" }
    expect(errorEnvelope(error)).toEqual({ body: { ok: false, error }, status: 400 })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("redacts an unregistered tag to a 500", () => {
    for (const _tag of ["SecretInternalThing", "constructor", "toString"]) {
      expect(errorEnvelope({ _tag })).toEqual({
        body: { ok: false, error: { _tag: "InternalServerError" } },
        status: 500,
      })
      expect(consoleError).toHaveBeenCalledWith("unregistered error tag reached the boundary:", {
        _tag,
      })
    }
  })
})

describe("respond", () => {
  const app = new Hono()
    .onError(onUnexpectedError)
    .notFound(onNotFound)
    .get("/ok", (c) => respond({ c, runtime, program: Effect.succeed({ a: 1 }), status: 201 }))
    .get("/fail", (c) =>
      respond({ c, runtime, program: Effect.fail({ _tag: "InvalidVerboseFlag" as const }) }),
    )
    .get("/defect", () => {
      throw new Error("boom")
    })

  it("answers the value with the given status", async () => {
    const res = await app.request("/ok")
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ a: 1 })
  })

  it("answers a typed failure with the envelope", async () => {
    const res = await app.request("/fail")
    expect(res.status).toBe(400)
  })

  it("redacts a defect", async () => {
    const res = await app.request("/defect")
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: { _tag: "InternalServerError" } })
    expect(consoleError).toHaveBeenCalledWith(
      "unexpected defect reached the http boundary:",
      expect.objectContaining({ message: "boom" }),
    )
  })

  it("answers an unknown route with the envelope", async () => {
    const res = await app.request("/nope")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: { _tag: "NotFound" } })
  })
})
