import { describe, expect, it } from "bun:test"
import { decodeConfig } from "./config"

describe("decodeConfig", () => {
  it("applies defaults to an empty env", () => {
    expect(decodeConfig({})).toEqual({ version: "0.0.0", environment: "development" })
  })

  it("reads vars and ignores bindings", () => {
    expect(decodeConfig({ APP_VERSION: "1.2.3", ENVIRONMENT: "production", DB: {} })).toEqual({
      version: "1.2.3",
      environment: "production",
    })
  })

  it("fails loudly on a malformed env", () => {
    expect(() => decodeConfig({ ENVIRONMENT: "staging" })).toThrow()
  })
})
