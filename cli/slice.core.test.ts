import { describe, expect, it } from "bun:test"
import {
  isSliceName,
  mountRoute,
  pascalCase,
  registerLayer,
  registerTag,
  sliceFiles,
  wireSlice,
} from "./slice.core"

const API = `import { Hono } from "hono"
import { buildHealthApp } from "./features/health/health.routes"
import type { AppRuntime } from "./platform/runtime"

export const buildApp = (runtime: AppRuntime) =>
  new Hono()
    .basePath("/api")
    .route("/health", buildHealthApp(runtime))
`

const RUNTIME = `import { Layer } from "effect"
import { HealthClockLive } from "../features/health/health.io"

export const makeAppLayer = (deps: AppDeps) => Layer.mergeAll(HealthClockLive(deps), LoggerLive)
`

const HTTP = `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
}
`

describe("names", () => {
  it("accepts kebab-case only", () => {
    expect(isSliceName("user-profile")).toBe(true)
    expect(isSliceName("items")).toBe(true)
    expect(isSliceName("UserProfile")).toBe(false)
    expect(isSliceName("-items")).toBe(false)
    expect(isSliceName("")).toBe(false)
  })

  it("pascal-cases kebab names", () => {
    expect(pascalCase("user-profile")).toBe("UserProfile")
  })
})

describe("sliceFiles", () => {
  it("emits the canonical slice plus a smoke test", () => {
    expect(Object.keys(sliceFiles({ name: "items", door: false })).sort()).toEqual([
      "smoke/items.smoke.test.ts",
      "src/features/items/items.core.test.ts",
      "src/features/items/items.core.ts",
      "src/features/items/items.io.ts",
      "src/features/items/items.routes.test.ts",
      "src/features/items/items.routes.ts",
    ])
  })

  it("shows a POST that validates its JSON body with jsonBody, tested and smoked", () => {
    const files = sliceFiles({ name: "items", door: false })
    expect(files["src/features/items/items.routes.ts"]).toContain(
      '.post("/:id", jsonBody(ItemsInput), (c) =>',
    )
    expect(files["src/features/items/items.routes.test.ts"]).toContain('.toBe("InvalidBody")')
    expect(files["smoke/items.smoke.test.ts"]).toContain('body: "{bad json"')
  })

  it("adds the door only when asked", () => {
    expect(Object.keys(sliceFiles({ name: "items", door: true }))).toContain(
      "src/features/items/items.door.ts",
    )
  })
})

describe("mountRoute", () => {
  it("adds the import and the route after the last ones", () => {
    const result = mountRoute({ api: API, name: "user-profile" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain(
      'import { buildUserProfileApp } from "./features/user-profile/user-profile.routes"\nimport type',
    )
    expect(result.text).toContain(
      '.route("/health", buildHealthApp(runtime))\n    .route("/user-profile", buildUserProfileApp(runtime))',
    )
  })

  it("fails with a reason when the anchors are gone", () => {
    expect(mountRoute({ api: "export const x = 1", name: "items" }).ok).toBe(false)
  })
})

describe("registerLayer", () => {
  it("imports the layer and adds it to mergeAll", () => {
    const result = registerLayer({ runtime: RUNTIME, name: "items" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain('import { ItemsIoLive } from "../features/items/items.io"')
    expect(result.text).toContain("Layer.mergeAll(ItemsIoLive(deps), HealthClockLive(deps)")
  })

  it("fails without mergeAll", () => {
    expect(registerLayer({ runtime: "", name: "items" }).ok).toBe(false)
  })
})

describe("registerTag", () => {
  it("adds the tag to the allowlist", () => {
    const result = registerTag({ http: HTTP, tag: "InvalidItemsId", status: 400 })
    expect(result).toEqual({
      ok: true,
      text: HTTP.replace("{\n", "{\n  InvalidItemsId: 400,\n"),
    })
  })

  it("fails without the allowlist", () => {
    expect(registerTag({ http: "", tag: "X", status: 400 }).ok).toBe(false)
  })
})

describe("wireSlice", () => {
  const sources = { api: API, runtime: RUNTIME, http: HTTP }

  it("returns all three edited files together", () => {
    const result = wireSlice({ sources, name: "items" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sources.api).toContain('.route("/items", buildItemsApp(runtime))')
    expect(result.sources.runtime).toContain("ItemsIoLive(deps)")
    expect(result.sources.http).toContain("InvalidItemsId: 400")
  })

  it("fails with the first missing anchor and returns no edits, even when it is the last file", () => {
    const result = wireSlice({ sources: { ...sources, http: "" }, name: "items" })
    expect(result).toEqual({
      ok: false,
      error: "platform/http.ts: no `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {`",
    })
  })
})
