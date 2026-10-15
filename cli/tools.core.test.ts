import { describe, expect, test } from "bun:test"
import { checkDigest, PINS, pinnedAsset, type ToolName } from "./tools.core"

const TOOLS = Object.keys(PINS) as ToolName[]

describe("pinned scanners", () => {
  test("every asset is an exact version with a full SHA256 and a versioned release URL", () => {
    for (const tool of TOOLS) {
      for (const asset of Object.values(PINS[tool])) {
        expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(asset.version).toMatch(/^\d+\.\d+\.\d+$/)
        expect(asset.url).toStartWith("https://github.com/")
        expect(asset.url).toContain(`v${asset.version}/`)
        expect(asset.url).not.toContain("latest")
      }
    }
  })

  test("every tool is pinned for linux-x64, the CI runner", () => {
    for (const tool of TOOLS) {
      expect(pinnedAsset({ tool, platform: "linux", arch: "x64" })).toBeDefined()
    }
  })

  test("an unknown platform has no asset", () => {
    expect(pinnedAsset({ tool: "gitleaks", platform: "win32", arch: "x64" })).toBeUndefined()
  })
})

describe("checkDigest", () => {
  const asset = pinnedAsset({ tool: "gitleaks", platform: "linux", arch: "x64" })
  if (asset === undefined) throw new Error("gitleaks linux-x64 is not pinned")
  const other = "0".repeat(64)

  test("passes when the digest is the pin", () => {
    expect(checkDigest({ asset, digest: asset.sha256 })).toBeUndefined()
  })

  test("fails with both digests when the archive differs", () => {
    const problem = checkDigest({ asset, digest: other })
    expect(problem).toContain("SHA256 mismatch")
    expect(problem).toContain(asset.sha256)
    expect(problem).toContain(other)
  })
})
