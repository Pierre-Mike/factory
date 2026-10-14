import { describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { errorEnvelope, onUnexpectedError, respond } from "./http"

const runtime = ManagedRuntime.make(Layer.empty)

describe("errorEnvelope", () => {
  it("passes a registered tag through at its status", () => {
    const error = { _tag: "InvalidVerboseFlag", received: "x" }
    expect(errorEnvelope(error)).toEqual({ body: { ok: false, error }, status: 400 })
  })

  it("redacts an unregistered tag to a 500", () => {
    expect(errorEnvelope({ _tag: "SecretInternalThing" })).toEqual({
      body: { ok: false, error: { _tag: "InternalServerError" } },
      status: 500,
    })
  })
})

describe("respond", () => {
  const app = new Hono()
    .onError(onUnexpectedError)
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
  })
})
