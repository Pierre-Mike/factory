import { describe, expect, it } from "bun:test"
import {
  doorFiles,
  doorNextSteps,
  isSliceName,
  mountRoute,
  nextSteps,
  parseSliceArgs,
  pascalCase,
  planSlice,
  registerLayer,
  registerTag,
  SLICE_USAGE,
  sliceFiles,
  unusedExportHints,
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

  it("shows a POST that validates its JSON body with jsonBody, tested and smoked", () => {
    for (const io of [true, false]) {
      const files = sliceFiles({ name: "items", door: false, io })
      expect(files["src/features/items/items.routes.ts"]).toContain(
        '.post("/:id", jsonBody(ItemsInput), (c) =>',
      )
      const test = files["src/features/items/items.routes.test.ts"]
      expect(test).toContain('request("/api/items/abc", {')
      expect(test).not.toContain("app.request")
      expect(test).toContain('.toBe("InvalidBody")')
      expect(files["smoke/items.smoke.test.ts"]).toContain('body: "{bad json"')
    }
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
    expect(nextSteps({ name: "items", io: true, door: false })).toContain("items.io.ts")
    expect(nextSteps({ name: "items", io: false, door: false })).not.toContain("items.io.ts")
  })

  it("says to remove the stub tag once the core no longer defines it", () => {
    expect(nextSteps({ name: "items", io: false, door: false })).toContain("remove InvalidItemsId")
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

describe("planSlice", () => {
  const args = { name: "posts", door: false, io: true }

  it("generates a new slice when none exists", () => {
    expect(planSlice({ args, existing: null })).toEqual({ ok: true, plan: "slice" })
  })

  it("adds only the door to an existing slice that has an io file", () => {
    expect(
      planSlice({ args: { ...args, door: true }, existing: { io: true, door: false } }),
    ).toEqual({ ok: true, plan: "door" })
  })

  it("refuses an existing slice without --door, and points at --door", () => {
    const result = planSlice({ args, existing: { io: true, door: false } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("slice already exists: posts")
    expect(result.error).toContain("axioms slice posts --door")
  })

  it("refuses a door for a slice with no io file, naming the missing file", () => {
    const result = planSlice({
      args: { ...args, door: true },
      existing: { io: false, door: false },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("posts has no posts.io.ts")
  })

  it("refuses a second door", () => {
    const result = planSlice({ args: { ...args, door: true }, existing: { io: true, door: true } })
    expect(result).toEqual({ ok: false, error: "posts already has posts.door.ts" })
  })
})

describe("doorFiles", () => {
  it("is the one door file sliceFiles adds with --door", () => {
    const door = doorFiles({ name: "posts" })
    expect(Object.keys(door)).toEqual(["src/features/posts/posts.door.ts"])
    expect(door["src/features/posts/posts.door.ts"]).toContain(
      'export { PostsIo } from "./posts.io"',
    )
    expect(sliceFiles({ name: "posts", door: true, io: true })).toMatchObject(door)
  })
})

describe("doorNextSteps", () => {
  it("tells the agent to import the door from its consumer in the same change", () => {
    const steps = doorNextSteps({ name: "posts" })
    expect(steps).toContain('import { PostsIo } from "../posts/posts.door"')
    expect(steps).toContain("RouteRuntime<PostsIo>")
    expect(steps).toContain("fallow")
  })

  it("is part of the next steps of a new slice generated with --door", () => {
    expect(nextSteps({ name: "posts", io: true, door: true })).toContain(
      'import { PostsIo } from "../posts/posts.door"',
    )
    expect(nextSteps({ name: "posts", io: true, door: false })).not.toContain("posts.door")
  })
})

describe("unusedExportHints", () => {
  it("names the import that a door export with no consumer is missing", () => {
    const output = `● Unused exports (1)
  apps/server/src/features/posts/posts.door.ts (1)
    :5 PostsIo (re-export)
`
    const hints = unusedExportHints(output).join("\n")
    expect(hints).toContain("posts.door.ts")
    expect(hints).toContain('import from "../posts/posts.door" in the slice that uses it')
    expect(hints).toContain("a door exports only what another slice already imports")
  })

  it("names the door once when no slice imports it, which fallow reports as an unused file", () => {
    const output = `● Unused files (1)
  apps/server/src/features/posts/posts.door.ts
`
    expect(unusedExportHints(output)).toHaveLength(1)
    expect(unusedExportHints(output)[0]).toContain('import from "../posts/posts.door"')
  })

  it("says a type used only in an exported signature stays unexported", () => {
    const hints = unusedExportHints(`● Unused type exports (1)
  apps/server/src/features/auth/auth.io.ts
    :27 OpenSession
`).join("\n")
    expect(hints).toContain("drop its `export`")
  })

  it("adds nothing for other dead code", () => {
    expect(unusedExportHints("● Unused files (1)\n  apps/server/src/x.ts\n")).toEqual([])
  })
})
