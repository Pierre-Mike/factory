import { describe, expect, it } from "bun:test"
import { findSuppressions } from "./suppressions.core"

const at = (input: { readonly path: string; readonly text: string }) => findSuppressions([input])

describe("findSuppressions", () => {
  it("finds a biome-ignore in any of its forms", () => {
    const text = [
      "// biome-ignore lint/style/noRestrictedGlobals: needed",
      "const now = Date.now()",
      "/* biome-ignore-all lint: x */",
      "// biome-ignore-start lint: x",
    ].join("\n")
    expect(at({ path: "src/features/a/a.core.ts", text })).toEqual([
      "src/features/a/a.core.ts:1 biome-ignore",
      "src/features/a/a.core.ts:3 biome-ignore-all",
      "src/features/a/a.core.ts:4 biome-ignore-start",
    ])
  })

  it("finds TypeScript directives", () => {
    const text = '// @ts-ignore\nconst y: number = "s"\n  // @ts-expect-error\n/** @ts-nocheck */'
    expect(at({ path: "src/a.ts", text })).toEqual([
      "src/a.ts:1 @ts-ignore",
      "src/a.ts:3 @ts-expect-error",
      "src/a.ts:4 @ts-nocheck",
    ])
  })

  it("finds a directive at the end of a line of code", () => {
    expect(at({ path: "src/a.tsx", text: "const x = f() // @ts-ignore" })).toEqual([
      "src/a.tsx:1 @ts-ignore",
    ])
  })

  it("passes code without suppressions", () => {
    expect(at({ path: "src/a.ts", text: "// a normal comment\nexport const x = 1\n" })).toEqual([])
  })

  it("leaves tests and generated files alone", () => {
    const text = "// @ts-expect-error\n// biome-ignore lint: x"
    for (const path of [
      "src/a.test.ts",
      "web/a.test.tsx",
      "src/a.spec.ts",
      "web/src/routeTree.gen.ts",
      "apps/server/worker-configuration.d.ts",
    ]) {
      expect(at({ path, text })).toEqual([])
    }
  })
})
