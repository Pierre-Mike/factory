import { describe, expect, it } from "bun:test"
import { missingCoreTests } from "./colocation.core"

describe("missingCoreTests", () => {
  it("passes when every core has its test", () => {
    expect(missingCoreTests(["a/x.core.ts", "a/x.core.test.ts", "a/x.io.ts"])).toEqual([])
  })

  it("names the core and the expected test path", () => {
    expect(missingCoreTests(["a/x.core.ts", "b/y.core.tsx", "b/y.core.test.tsx"])).toEqual([
      "a/x.core.ts -> expected a/x.core.test.ts",
    ])
  })

  it("does not treat a test file as a core", () => {
    expect(missingCoreTests(["a/x.core.test.ts"])).toEqual([])
  })
})
