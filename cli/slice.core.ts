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

export const sliceFiles = (input: {
  readonly name: string
  readonly door: boolean
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
 * I/O port for the \`${name}\` slice. Replace the stub with real I/O (deps.db is the D1-backed
 * SQL port). Routes depend only on the Tag.
 */
import { Context, Effect, Layer } from "effect"
import type { AppDeps } from "../../platform/deps"

export class ${P}Io extends Context.Service<
  ${P}Io,
  { readonly findById: (id: string) => Effect.Effect<{ readonly id: string }> }
>()("${P}Io") {}

export const ${P}IoLive = (_deps: AppDeps): Layer.Layer<${P}Io> =>
  Layer.succeed(${P}Io, {
    findById: (id) => Effect.succeed({ id }),
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
    [`src/features/${name}/${name}.routes.test.ts`]: `import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody } from "@app/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ${P}Io } from "./${name}.io"
import { build${P}App } from "./${name}.routes"

const app = build${P}App(
  ManagedRuntime.make(Layer.succeed(${P}Io, { findById: (id) => Effect.succeed({ id }) })),
)

describe("GET /${name}", () => {
  it("returns the payload for a valid id", async () => {
    const res = await app.request("/?id=abc")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "abc", message: "${name} works" })
  })

  it("maps a missing id to the shared 400 error envelope", async () => {
    const res = await app.request("/")
    expect(res.status).toBe(400)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("Invalid${P}Id")
  })
})

describe("POST /${name}/:id", () => {
  const post = (body: unknown) =>
    app.request("/abc", {
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
  if (input.door) {
    files[`src/features/${name}/${name}.door.ts`] = `/**
 * Published door for the \`${name}\` slice: the one file another slice may import. Consumers
 * depend on the Tag, never on the implementation. Keep it narrow, and re-export the shared Schema
 * contract for any data that crosses it.
 */
export { ${P}Io } from "./${name}.io"
`
  }
  return files
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
 * All three edits that wire a slice in, or the first one that cannot apply. The shell writes nothing
 * until this succeeds, so a missing anchor never leaves a half-generated slice behind.
 */
export const wireSlice = (input: {
  readonly sources: WiringSources
  readonly name: string
}):
  | { readonly ok: true; readonly sources: WiringSources }
  | { readonly ok: false; readonly error: string } => {
  const { sources, name } = input
  const api = mountRoute({ api: sources.api, name })
  if (!api.ok) return api
  const runtime = registerLayer({ runtime: sources.runtime, name })
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
