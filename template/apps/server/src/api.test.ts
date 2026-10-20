/** The middleware api.ts puts in front of every route, through the whole app. */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody } from "@app/shared"
import { MAX_BODY_BYTES } from "./api"
import { testApp } from "./platform/test-app.bun"

const { request } = testApp()

const post = (body: string) =>
  request("/api/health", { method: "POST", headers: { "content-type": "application/json" }, body })

describe("body limit", () => {
  it("answers a body over MAX_BODY_BYTES with the shared 413 envelope", async () => {
    const res = await post(JSON.stringify({ pad: "a".repeat(MAX_BODY_BYTES) }))
    expect(res.status).toBe(413)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("PayloadTooLarge")
  })

  it("lets a body under the limit through to the router", async () => {
    const res = await post(JSON.stringify({ pad: "a".repeat(MAX_BODY_BYTES / 2) }))
    expect(res.status).toBe(404)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("NotFound")
  })
})
