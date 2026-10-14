import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, decodeHealthStatus } from "./index"

describe("decodeHealthStatus", () => {
  it("accepts the documented shape", () => {
    expect(decodeHealthStatus({ ok: true, version: "1.0.0", uptimeMs: 5 })).toEqual({
      ok: true,
      version: "1.0.0",
      uptimeMs: 5,
    })
  })

  it("rejects an undocumented field, so drift fails loudly", () => {
    expect(() => decodeHealthStatus({ ok: true, version: "1", uptimeMs: 1, extra: 1 })).toThrow()
  })
})

describe("decodeApiErrorBody", () => {
  it("keeps the tag-specific payload open", () => {
    const body = decodeApiErrorBody({ ok: false, error: { _tag: "X", received: "y" } })
    expect(body.error._tag).toBe("X")
  })
})
