/**
 * Slice generator, pure. Produces the files of a new feature slice and the edits that wire it into
 * api.ts, platform/runtime.ts and platform/http.ts. The shell (commands/slice.ts) does the reads
 * and writes. Generating the shape beats a prose recipe: people and agents get the same,
 * gate-passing slice every time.
 */

export type Patch =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string }

const SLICE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export const isSliceName = (name: string): boolean => SLICE_NAME.test(name)

export const pascalCase = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")

export const SLICE_USAGE =
  "usage: axioms slice <feature> [--door] [--no-io]   (kebab-case, e.g. user-profile)\n" +
  "  --door   publish <feature>.door.ts, the one file other slices may import; on an existing\n" +
  "           slice it adds only the door. Add it with its first consumer.\n" +
  "  --no-io  no <feature>.io.ts and no Layer in runtime.ts, for a slice that owns no data"

export type SliceArgs =
  | { readonly ok: true; readonly name: string; readonly door: boolean; readonly io: boolean }
  | { readonly ok: false; readonly error: string }

const SLICE_FLAGS = ["--door", "--no-io"]

export const parseSliceArgs = (args: ReadonlyArray<string>): SliceArgs => {
  const unknownFlag = args.find((a) => a.startsWith("-") && !SLICE_FLAGS.includes(a))
  if (unknownFlag !== undefined)
    return { ok: false, error: `unknown flag ${unknownFlag}\n${SLICE_USAGE}` }
  const name = args.find((a) => !a.startsWith("-")) ?? ""
  if (!isSliceName(name)) return { ok: false, error: SLICE_USAGE }
  const door = args.includes("--door")
  const io = !args.includes("--no-io")
  if (door && !io) {
    return {
      ok: false,
      error: `--door publishes the io service, and --no-io writes none\n${SLICE_USAGE}`,
    }
  }
  return { ok: true, name, door, io }
}

export const sliceFiles = (input: {
  readonly name: string
  readonly door: boolean
  /** false: no *.io.ts, and a route that uses no service. */
  readonly io: boolean
}): Record<string, string> => {
  const { name } = input
  const P = pascalCase(name)
  const files: Record<string, string> = {
    [`src/features/${name}/${name}.core.ts`]: `/**
 * Functional core for the \`${name}\` slice. Pure: plain data in, plain data out, failures are
 * values (Result). The shell (*.io.ts / *.routes.ts) reads the world and passes it in.
 */
import { Result } from "effect"

export interface ${P}Result {
  readonly id: string
  readonly message: string
}

export interface Invalid${P}Id {
  readonly _tag: "Invalid${P}Id"
  readonly received: string
}

/** Parse the \`?id=\` query param. Invalid input is a failure, never a throw. */
export const parse${P}Id = (raw: string | undefined): Result.Result<string, Invalid${P}Id> => {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return Result.fail({ _tag: "Invalid${P}Id", received: raw ?? "" })
  return Result.succeed(trimmed)
}

/** Build the response payload from already-read inputs. Pure, total. */
export const build${P} = (input: { readonly id: string }): ${P}Result => ({
  id: input.id,
  message: "${name} works",
})
`,
    [`src/features/${name}/${name}.core.test.ts`]: `import { describe, expect, it } from "bun:test"
import { Result } from "effect"
import { build${P}, parse${P}Id } from "./${name}.core"

describe("parse${P}Id", () => {
  it("accepts a non-empty id", () => {
    expect(parse${P}Id("abc")).toEqual(Result.succeed("abc"))
  })

  it("returns a tagged failure for a missing id", () => {
    expect(Result.isFailure(parse${P}Id(undefined))).toBe(true)
  })
})

describe("build${P}", () => {
  it("echoes the id", () => {
    expect(build${P}({ id: "abc" })).toEqual({ id: "abc", message: "${name} works" })
  })
})
`,
    [`src/features/${name}/${name}.io.ts`]: `/**
 * I/O port for the \`${name}\` slice. Routes depend only on the Tag. deps.db is the SQL port: D1 in
 * the worker, in-memory SQLite with the real migrations in tests.
 */
import { Context, Effect, Layer, Schema } from "effect"
import type { AppDeps } from "../../platform/deps"

// The stub needs no table. Replace it with a query against your migration.
const FIND_BY_ID = "SELECT ? AS id"

const ${P}Row = Schema.Struct({ id: Schema.String })

export class ${P}Io extends Context.Service<
  ${P}Io,
  { readonly findById: (id: string) => Effect.Effect<{ readonly id: string }> }
>()("${P}Io") {}

export const ${P}IoLive = (deps: AppDeps): Layer.Layer<${P}Io> =>
  Layer.succeed(${P}Io, {
    // A row that fails to decode is a defect: the boundary logs it and answers a redacted 500.
    findById: (id) =>
      Effect.promise(() => deps.db.first({ sql: FIND_BY_ID, params: [id] })).pipe(
        Effect.flatMap((row) => Schema.decodeUnknownEffect(${P}Row)(row)),
        Effect.orDie,
      ),
  })
`,
    [`src/features/${name}/${name}.routes.ts`]: `/**
 * Hono shell for the \`${name}\` slice: impure read through the io service, pure core in the
 * middle, shared error envelope on a failure. Core results are lifted with \`Effect.fromResult\`.
 * A JSON body is decoded by \`jsonBody(schema)\`, which also lets \`hc<AppType>\` type it.
 */
import { Effect, Schema } from "effect"
import { Hono } from "hono"
import { type RouteRuntime, respond } from "../../platform/http"
import { jsonBody } from "../../platform/validate"
import { build${P}, parse${P}Id } from "./${name}.core"
import { ${P}Io } from "./${name}.io"

/** The body \`POST /:id\` accepts. Move it to shared/src once the web app sends it. */
const ${P}Input = Schema.Struct({ message: Schema.String })

export const build${P}App = (runtime: RouteRuntime<${P}Io>) =>
  new Hono()
    .get("/", (c) =>
      respond({
        c,
        runtime,
        program: Effect.gen(function* () {
          const id = yield* Effect.fromResult(parse${P}Id(c.req.query("id")))
          const io = yield* ${P}Io
          const entity = yield* io.findById(id)
          return build${P}({ id: entity.id })
        }),
      }),
    )
    .post("/:id", jsonBody(${P}Input), (c) =>
      respond({
        c,
        runtime,
        program: Effect.succeed({ id: c.req.param("id"), message: c.req.valid("json").message }),
      }),
    )
`,
    [`src/features/${name}/${name}.routes.test.ts`]: `/** The route through the real app, over in-memory SQLite with every migration applied. */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody } from "@app/shared"
import { testApp } from "../../platform/test-app.bun"

// One database for the file. Call testApp() inside a test that writes rows, to start clean.
const { request } = testApp()

describe("GET /api/${name}", () => {
  it("returns the payload for a valid id", async () => {
    const res = await request("/api/${name}?id=abc")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "abc", message: "${name} works" })
  })

  it("maps a missing id to the shared 400 error envelope", async () => {
    const res = await request("/api/${name}")
    expect(res.status).toBe(400)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("Invalid${P}Id")
  })
})

describe("POST /api/${name}/:id", () => {
  const post = (body: unknown) =>
    request("/api/${name}/abc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  it("answers a body that matches the Schema", async () => {
    const res = await post({ message: "hi" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "abc", message: "hi" })
  })

  it("maps a body that does not match to the shared 400 InvalidBody envelope", async () => {
    const res = await post({ message: 1 })
    expect(res.status).toBe(400)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("InvalidBody")
  })
})
`,
    [`smoke/${name}.smoke.test.ts`]: `/** Runs only under \`bun run smoke\`, against a real \`wrangler dev\`. */
import { describe, expect, it } from "bun:test"

const BASE = process.env.SMOKE_URL

describe.skipIf(BASE === undefined)("smoke: /api/${name}", () => {
  it("answers a valid request", async () => {
    const res = await fetch(\`\${BASE}/api/${name}?id=abc\`)
    expect(res.status).toBe(200)
  })

  it("returns the shared 400 envelope for a missing id", async () => {
    const res = await fetch(\`\${BASE}/api/${name}\`)
    expect(res.status).toBe(400)
  })

  it("returns the shared 400 envelope for malformed JSON", async () => {
    const res = await fetch(\`\${BASE}/api/${name}/abc\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    })
    expect(res.status).toBe(400)
  })
})
`,
  }
  if (!input.io) return withoutIo({ files, name })
  return input.door ? { ...files, ...doorFiles({ name }) } : files
}

/**
 * The door: the one file another slice may import. Generated with the slice (`--door`) or added
 * later, when its first consumer appears (`axioms slice <feature> --door` on an existing slice).
 */
export const doorFiles = (input: { readonly name: string }): Record<string, string> => {
  const { name } = input
  return {
    [`src/features/${name}/${name}.door.ts`]: `/**
 * Published door for the \`${name}\` slice: the one file another slice may import. Consumers
 * depend on the Tag, never on the implementation. Keep it narrow: export only what another slice
 * already imports, and re-export the shared Schema contract for any data that crosses it.
 */
export { ${pascalCase(name)}Io } from "./${name}.io"
`,
  }
}

/** What to generate for `axioms slice`: a new slice, only the door of an existing one, or why not. */
export const planSlice = (input: {
  readonly args: { readonly name: string; readonly door: boolean; readonly io: boolean }
  /** What the slice folder already holds, or null when it does not exist. */
  readonly existing: { readonly io: boolean; readonly door: boolean } | null
}):
  | { readonly ok: true; readonly plan: "slice" | "door" }
  | { readonly ok: false; readonly error: string } => {
  const { name, door } = input.args
  const existing = input.existing
  if (existing === null) return { ok: true, plan: "slice" }
  if (!door) {
    return {
      ok: false,
      error: `slice already exists: ${name}\n  to publish its door for a new consumer: axioms slice ${name} --door`,
    }
  }
  if (existing.door) return { ok: false, error: `${name} already has ${name}.door.ts` }
  if (!existing.io) {
    return {
      ok: false,
      error: `${name} has no ${name}.io.ts, so there is no service for a door to publish. Add the io file and its Layer in platform/runtime.ts first.`,
    }
  }
  return { ok: true, plan: "door" }
}

/** The import a consuming slice adds, in the same change as the door, so no export is ever unused. */
export const doorNextSteps = (input: { readonly name: string }): string => {
  const { name } = input
  const P = pascalCase(name)
  return `in the slice that needs ${name}, in this same change: import { ${P}Io } from "../${name}/${name}.door" in its *.routes.ts and name ${P}Io in RouteRuntime<${P}Io>. Until a slice imports it, fallow (the dead code gate of axioms check) fails ${name}.door.ts`
}

const DOOR_FILE = /features\/([a-z][a-z0-9-]*)\/\1\.door\.ts/g

/**
 * What the dead code gate adds under fallow's report when it lists a door (as an unused file when
 * no slice imports it, as unused exports when one imports part of it) or an unused type export:
 * the rule from the canon and the edit that satisfies it.
 */
export const unusedExportHints = (output: string): ReadonlyArray<string> => {
  const doors = [...new Set([...output.matchAll(DOOR_FILE)].map((m) => m[1] ?? ""))]
  const doorHints = doors.map(
    (name) =>
      `${name}.door.ts: a door exports only what another slice already imports. In this change, import from "../${name}/${name}.door" in the slice that uses it, or delete the unused export (or the whole door) until a slice needs it.`,
  )
  const typeHint = output.includes("Unused type exports")
    ? [
        "unused type export: a type used only inside an exported signature (a Context.Service shape) stays unexported, so drop its `export`; delete a type nothing uses.",
      ]
    : []
  return [...doorHints, ...typeHint]
}

/** A slice that owns no data: the route calls the pure core and nothing else. */
const withoutIo = (input: {
  readonly files: Record<string, string>
  readonly name: string
}): Record<string, string> => {
  const { name } = input
  const P = pascalCase(name)
  const files = Object.fromEntries(
    Object.entries(input.files).filter(([path]) => path !== `src/features/${name}/${name}.io.ts`),
  )
  files[`src/features/${name}/${name}.routes.ts`] = `/**
 * Hono shell for the \`${name}\` slice, which owns no data: pure core in the middle, shared error
 * envelope on a failure. To read through another slice, import its \`<feature>.door\` and name its
 * service in \`RouteRuntime<...>\`. Core results are lifted with \`Effect.fromResult\`.
 * A JSON body is decoded by \`jsonBody(schema)\`, which also lets \`hc<AppType>\` type it.
 */
import { Effect, Schema } from "effect"
import { Hono } from "hono"
import { type RouteRuntime, respond } from "../../platform/http"
import { jsonBody } from "../../platform/validate"
import { build${P}, parse${P}Id } from "./${name}.core"

/** The body \`POST /:id\` accepts. Move it to shared/src once the web app sends it. */
const ${P}Input = Schema.Struct({ message: Schema.String })

export const build${P}App = (runtime: RouteRuntime<never>) =>
  new Hono()
    .get("/", (c) =>
      respond({
        c,
        runtime,
        program: Effect.gen(function* () {
          const id = yield* Effect.fromResult(parse${P}Id(c.req.query("id")))
          return build${P}({ id })
        }),
      }),
    )
    .post("/:id", jsonBody(${P}Input), (c) =>
      respond({
        c,
        runtime,
        program: Effect.succeed({ id: c.req.param("id"), message: c.req.valid("json").message }),
      }),
    )
`
  return files
}

/** What the shell prints after generating a slice. */
export const nextSteps = (input: {
  readonly name: string
  readonly io: boolean
  readonly door: boolean
}): string => {
  const { name } = input
  const steps = [
    ...(input.io ? [`add a migration in apps/server/migrations/ if ${name} stores data`] : []),
    `write the pure logic in ${name}.core.ts and its test`,
    ...(input.io ? [`replace the stub query in ${name}.io.ts (deps.db is the SQL port)`] : []),
    `register new error tags in platform/http.ts, and remove Invalid${pascalCase(name)}Id once ${name}.core.ts no longer defines it`,
    `make smoke/${name}.smoke.test.ts check the real behaviour`,
    ...(input.door ? [doorNextSteps({ name })] : []),
    "bun run check && bun run smoke",
  ]
  return `next steps:\n${steps.map((step, i) => `  ${i + 1}. ${step}`).join("\n")}`
}

const FEATURE_IMPORT =
  /import \{ build\w+App \} from "\.\/features\/[^\n]*\n(?![\s\S]*import \{ build\w+App \})/
const LAST_ROUTE = /\n(\s*)\.route\("[^"]+", build\w+App\(runtime\)\)(?![\s\S]*\.route\()/

export const mountRoute = (input: { readonly api: string; readonly name: string }): Patch => {
  const P = pascalCase(input.name)
  const lastImport = input.api.match(FEATURE_IMPORT)
  if (!lastImport || lastImport.index === undefined) {
    return { ok: false, error: 'api.ts: no `import { build<X>App } from "./features/..."` line' }
  }
  const importEnd = lastImport.index + lastImport[0].length
  const withImport = `${input.api.slice(0, importEnd)}import { build${P}App } from "./features/${input.name}/${input.name}.routes"\n${input.api.slice(importEnd)}`
  const lastRoute = withImport.match(LAST_ROUTE)
  if (!lastRoute || lastRoute.index === undefined) {
    return { ok: false, error: 'api.ts: no `.route("/<x>", build<X>App(runtime))` call' }
  }
  const routeEnd = lastRoute.index + lastRoute[0].length
  const indent = lastRoute[1] ?? "  "
  return {
    ok: true,
    text: `${withImport.slice(0, routeEnd)}\n${indent}.route("/${input.name}", build${P}App(runtime))${withImport.slice(routeEnd)}`,
  }
}

export const registerLayer = (input: {
  readonly runtime: string
  readonly name: string
}): Patch => {
  const P = pascalCase(input.name)
  if (!input.runtime.includes("Layer.mergeAll(")) {
    return { ok: false, error: "platform/runtime.ts: no `Layer.mergeAll(` call" }
  }
  const lastImport = input.runtime.match(
    /import \{ \w+Live \} from "\.\.\/features\/[^\n]*\n(?![\s\S]*import \{ \w+Live \})/,
  )
  if (!lastImport || lastImport.index === undefined) {
    return {
      ok: false,
      error: 'platform/runtime.ts: no `import { <X>IoLive } from "../features/..."` line',
    }
  }
  const importEnd = lastImport.index + lastImport[0].length
  const withImport = `${input.runtime.slice(0, importEnd)}import { ${P}IoLive } from "../features/${input.name}/${input.name}.io"\n${input.runtime.slice(importEnd)}`
  return {
    ok: true,
    text: withImport.replace("Layer.mergeAll(", `Layer.mergeAll(${P}IoLive(deps), `),
  }
}

export interface WiringSources {
  readonly api: string
  readonly runtime: string
  readonly http: string
}

/**
 * The edits that wire a slice in (runtime.ts only when it has io), or the first one that cannot
 * apply. The shell writes nothing
 * until this succeeds, so a missing anchor never leaves a half-generated slice behind.
 */
export const wireSlice = (input: {
  readonly sources: WiringSources
  readonly name: string
  /** false: runtime.ts is left unchanged, since the slice has no Layer. */
  readonly io: boolean
}):
  | { readonly ok: true; readonly sources: WiringSources }
  | { readonly ok: false; readonly error: string } => {
  const { sources, name } = input
  const api = mountRoute({ api: sources.api, name })
  if (!api.ok) return api
  const runtime: Patch = input.io
    ? registerLayer({ runtime: sources.runtime, name })
    : { ok: true, text: sources.runtime }
  if (!runtime.ok) return runtime
  const http = registerTag({ http: sources.http, tag: `Invalid${pascalCase(name)}Id`, status: 400 })
  if (!http.ok) return http
  return { ok: true, sources: { api: api.text, runtime: runtime.text, http: http.text } }
}

const ALLOWLIST = /const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = \{\n/

export const registerTag = (input: {
  readonly http: string
  readonly tag: string
  readonly status: number
}): Patch =>
  ALLOWLIST.test(input.http)
    ? {
        ok: true,
        text: input.http.replace(ALLOWLIST, (m) => `${m}  ${input.tag}: ${input.status},\n`),
      }
    : {
        ok: false,
        error:
          "platform/http.ts: no `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {`",
      }
