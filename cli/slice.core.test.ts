import { describe, expect, it } from "bun:test"
import {
  isSliceName,
  mountRoute,
  nextSteps,
  parseSliceArgs,
  pascalCase,
  registerLayer,
  registerTag,
  SLICE_USAGE,
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
    expect(Object.keys(sliceFiles({ name: "items", door: false, io: true })).sort()).toEqual([
      "smoke/items.smoke.test.ts",
      "src/features/items/items.core.test.ts",
      "src/features/items/items.core.ts",
      "src/features/items/items.io.ts",
      "src/features/items/items.routes.test.ts",
      "src/features/items/items.routes.ts",
    ])
  })

  it("adds the door only when asked", () => {
    expect(Object.keys(sliceFiles({ name: "items", door: true, io: true }))).toContain(
      "src/features/items/items.door.ts",
    )
  })

  it("runs the route test over the shared in-memory SQLite app, not a stubbed service", () => {
    for (const io of [true, false]) {
      const test = sliceFiles({ name: "items", door: false, io })[
        "src/features/items/items.routes.test.ts"
      ]
      expect(test).toContain('import { testApp } from "../../platform/test-app.bun"')
      expect(test).toContain('request("/api/items?id=abc")')
      expect(test).not.toContain("Layer.succeed")
      expect(test).not.toContain("ManagedRuntime")
    }
  })

  it("writes no io file and a route that uses no service with io off", () => {
    const files = sliceFiles({ name: "items", door: false, io: false })
    expect(Object.keys(files).sort()).toEqual([
      "smoke/items.smoke.test.ts",
      "src/features/items/items.core.test.ts",
      "src/features/items/items.core.ts",
      "src/features/items/items.routes.test.ts",
      "src/features/items/items.routes.ts",
    ])
    const routes = files["src/features/items/items.routes.ts"]
    expect(routes).toContain("runtime: RouteRuntime<never>")
    expect(routes).not.toContain("ItemsIo")
    expect(routes).not.toContain("items.io")
  })

  it("reads the stub io through the SQL port and decodes the row with a Schema", () => {
    const io = sliceFiles({ name: "items", door: false, io: true })[
      "src/features/items/items.io.ts"
    ]
    expect(io).toContain("deps.db.first(")
    expect(io).toContain("Schema.decodeUnknownEffect(ItemsRow)")
  })
})

describe("parseSliceArgs", () => {
  it("reads the name and both flags in any order", () => {
    expect(parseSliceArgs(["--no-io", "search"])).toEqual({
      ok: true,
      name: "search",
      door: false,
      io: false,
    })
    expect(parseSliceArgs(["posts", "--door"])).toEqual({
      ok: true,
      name: "posts",
      door: true,
      io: true,
    })
  })

  it("refuses an unknown flag, a bad name, and a door with nothing to publish", () => {
    expect(parseSliceArgs(["posts", "--io"])).toEqual({
      ok: false,
      error: `unknown flag --io\n${SLICE_USAGE}`,
    })
    expect(parseSliceArgs(["Posts"])).toEqual({ ok: false, error: SLICE_USAGE })
    const both = parseSliceArgs(["search", "--door", "--no-io"])
    expect(both.ok).toBe(false)
    if (both.ok) return
    expect(both.error).toContain("--door publishes the io service")
  })

  it("names --no-io in the usage line", () => {
    expect(SLICE_USAGE).toContain("axioms slice <feature> [--door] [--no-io]")
  })
})

describe("nextSteps", () => {
  it("drops the io step when the slice has none", () => {
    expect(nextSteps({ name: "items", io: true })).toContain("items.io.ts")
    expect(nextSteps({ name: "items", io: false })).not.toContain("items.io.ts")
  })

  it("says to remove the stub tag once the core no longer defines it", () => {
    expect(nextSteps({ name: "items", io: false })).toContain("remove InvalidItemsId")
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
    const result = wireSlice({ sources, name: "items", io: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sources.api).toContain('.route("/items", buildItemsApp(runtime))')
    expect(result.sources.runtime).toContain("ItemsIoLive(deps)")
    expect(result.sources.http).toContain("InvalidItemsId: 400")
  })

  it("leaves runtime.ts unchanged when the slice has no io", () => {
    const result = wireSlice({ sources, name: "items", io: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sources.runtime).toBe(RUNTIME)
    expect(result.sources.api).toContain('.route("/items", buildItemsApp(runtime))')
    expect(result.sources.http).toContain("InvalidItemsId: 400")
  })

  it("does not need a mergeAll anchor when the slice has no io", () => {
    expect(wireSlice({ sources: { ...sources, runtime: "" }, name: "items", io: false }).ok).toBe(
      true,
    )
  })

  it("fails with the first missing anchor and returns no edits, even when it is the last file", () => {
    const result = wireSlice({ sources: { ...sources, http: "" }, name: "items", io: true })
    expect(result).toEqual({
      ok: false,
      error: "platform/http.ts: no `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {`",
    })
  })
})
