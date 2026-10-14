import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, decodeHealthStatus } from "@app/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HealthClock } from "./health.io"
import { buildHealthApp } from "./health.routes"

const FrozenClock = Layer.succeed(HealthClock, {
  now: () => Effect.succeed(5_000),
  startedAt: 2_000,
  version: "9.9.9",
})

const app = buildHealthApp(ManagedRuntime.make(FrozenClock))

describe("GET /health", () => {
  it("returns a body that decodes against the shared contract", async () => {
    const res = await app.request("/")
    expect(res.status).toBe(200)
    expect(decodeHealthStatus(await res.json())).toEqual({
      ok: true,
      version: "9.9.9",
      uptimeMs: 3_000,
    })
  })

  it("echoes the verbose flag when requested", async () => {
    const res = await app.request("/?verbose=1")
    expect(decodeHealthStatus(await res.json()).verbose).toBe(true)
  })

  it("maps an invalid verbose flag to the shared 400 envelope", async () => {
    const res = await app.request("/?verbose=banana")
    expect(res.status).toBe(400)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("InvalidVerboseFlag")
  })
})
