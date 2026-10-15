/**
 * Proves the shared Biome config does what canon.md says, file shape by file shape. Each fixture
 * is linted inside a throwaway project that extends the harness exactly like a real one (through
 * node_modules/@pierre-mike/axioms), so a broken override, a plugin path that no longer resolves,
 * or a denial an override silently dropped all fail here.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { PKG_ROOT, toolPath } from "../cli/shell"
import { CORE_GLOBALS, factoryBiomeConfig, renderBiomeConfig } from "../harness/biome.rules"

interface Fixture {
  readonly path: string
  readonly code: string
  /** Substrings of the expected diagnostics (category or message). Empty means clean. */
  readonly expect: ReadonlyArray<string>
}

const F = "apps/server/src/features"

const FIXTURES: ReadonlyArray<Fixture> = [
  // functional core
  {
    path: `${F}/a/a.core.ts`,
    code: "export const now = () => Date.now()\n",
    expect: ["global variable Date"],
  },
  {
    path: `${F}/b/b.core.ts`,
    code: 'export const f = () => {\n  throw new Error("x")\n}\n',
    expect: ["must not throw"],
  },
  {
    path: `${F}/ds/ds.core.ts`,
    code: 'import { Schema } from "effect"\n\nexport const d = (u: unknown) => Schema.decodeUnknownSync(Schema.String)(u)\n',
    expect: ["must not throw"],
  },
  {
    path: `${F}/ds2/ds2.core.ts`,
    code: 'import { Schema as S } from "effect"\n\nexport const d = (u: string) => S.decodeSync(S.String)(u)\n',
    expect: ["must not throw"],
  },
  {
    path: `${F}/dr/dr.core.ts`,
    code: 'import { Schema } from "effect"\n\nexport const d = (u: unknown) => Schema.decodeUnknownResult(Schema.String)(u)\n',
    expect: [],
  },
  {
    path: `${F}/ds/ds.io.ts`,
    code: 'import { Schema } from "effect"\n\nexport const d = (u: unknown) => Schema.decodeUnknownSync(Schema.String)(u)\n',
    expect: [],
  },
  {
    path: `${F}/c/c.core.ts`,
    code: "export const f = async () => {\n  await 1\n}\n",
    expect: ["synchronous"],
  },
  {
    path: `${F}/d/d.core.ts`,
    code: 'import { Effect } from "effect"\n\nexport const e = Effect.void\n',
    expect: ["Functional core must stay pure"],
  },
  {
    path: `${F}/e/e.core.ts`,
    code: 'import axios from "axios"\n\nexport const a = axios\n',
    expect: ["instead of axios"],
  },
  {
    path: `${F}/f/f.core.ts`,
    code: 'import { x } from "./f.io"\n\nexport const y = x\n',
    expect: ["must not import an I/O service"],
  },
  {
    path: `${F}/g/g.core.ts`,
    code: 'import { Result } from "effect"\n\nexport const ok = Result.succeed(1)\n',
    expect: [],
  },
  {
    path: `${F}/cr/cr.core.ts`,
    code: "export const t = () => performance.now()\n",
    expect: ["global variable performance"],
  },
  {
    path: `${F}/ef/ef.core.ts`,
    code: "export const id = () => crypto.randomUUID()\n",
    expect: ["global variable crypto"],
  },
  {
    path: `${F}/q/q.core.ts`,
    code: "export const roll = () => Math.random()\n",
    expect: ["must be deterministic"],
  },
  {
    path: `${F}/r/r.core.ts`,
    code: "export const top = (xs: ReadonlyArray<number>) => Math.max(...xs)\n",
    expect: [],
  },
  {
    path: `${F}/s/s.core.ts`,
    code: 'export const f = () => globalThis.fetch("https://example.com")\n',
    expect: ["through globalThis"],
  },
  {
    path: `${F}/s2/s2.core.ts`,
    code: "export const now = () => globalThis.Date.now()\n",
    expect: ["through globalThis"],
  },
  {
    path: `${F}/s3/s3.core.ts`,
    code: 'export const id = () => self["crypto"].randomUUID()\n',
    expect: ["through globalThis"],
  },
  // slice shell files
  {
    path: `${F}/h/h.routes.ts`,
    code: 'export const r = () => fetch("https://example.com")\n',
    expect: ["global variable fetch"],
  },
  {
    path: `${F}/i/i.io.ts`,
    code: 'export const r = () => fetch("https://example.com")\n',
    expect: [],
  },
  {
    path: `${F}/j/j.io.ts`,
    code: "export const v = process.env.X\n",
    expect: ["global variable process"],
  },
  {
    path: `${F}/k/k.routes.ts`,
    code: 'import { x } from "../other/other.core"\n\nexport const y = x\n',
    expect: ["sibling slice"],
  },
  {
    path: `${F}/k2/k2.routes.ts`,
    code: 'import { x } from "../../features/other/other.core"\n\nexport const y = x\n',
    expect: ["sibling slice"],
  },
  {
    path: `${F}/k3/k3.routes.ts`,
    code: 'import { x } from "./../other/other.io"\n\nexport const y = x\n',
    expect: ["sibling slice"],
  },
  {
    path: `${F}/l/l.routes.ts`,
    code: 'import { x } from "../other/other.door"\n\nexport const y = x\n',
    expect: [],
  },
  {
    path: `${F}/l2/l2.routes.ts`,
    code: 'import { x } from "../../platform/http"\nimport { y } from "./l2.core"\n\nexport const z = [x, y]\n',
    expect: [],
  },
  // runtime neutrality
  {
    path: "apps/server/src/platform/db.ts",
    code: 'import { Database } from "bun:sqlite"\n\nexport const d = Database\n',
    expect: ["Bun is the dev toolchain"],
  },
  {
    path: "apps/server/src/platform/db.bun.ts",
    code: 'import { Database } from "bun:sqlite"\n\nexport const d = Database\n',
    expect: [],
  },
  {
    path: "apps/server/src/worker.ts",
    code: "export const v = process.env.X\n",
    expect: ["global variable process"],
  },
  {
    path: "apps/server/src/platform/x.ts",
    code: "export const v = Bun.version\n",
    expect: ["global variable Bun"],
  },
  // globals reached through an alias
  {
    path: `${F}/t/t.routes.ts`,
    code: 'export const r = () => globalThis.fetch("https://example.com")\n',
    expect: ["through globalThis"],
  },
  {
    path: "apps/server/src/platform/env.ts",
    code: 'export const v = self["process"]\n',
    expect: ["through globalThis"],
  },
  {
    path: "apps/web/src/lib/w.ts",
    code: 'export const f = () => window.fetch("/api")\n',
    expect: ["through globalThis"],
  },
  {
    path: "apps/web/src/lib/origin.ts",
    code: "export const origin = () => window.location.origin\n",
    expect: [],
  },
  // tooling names only relax the rules outside src/
  {
    path: `${F}/u/u.config.ts`,
    code: "export const v = process.env.X\n",
    expect: ["global variable process"],
  },
  {
    path: "apps/server/src/scripts/seed.ts",
    code: 'export const f = () => fetch("https://example.com")\n',
    expect: ["global variable fetch"],
  },
  {
    path: "apps/server/scripts/seed.ts",
    code: "export const v = process.env.X\n",
    expect: [],
  },
  {
    path: "apps/web/vite.config.ts",
    code: "export const v = process.env.X\n",
    expect: [],
  },
  {
    path: "apps/server/src/api.ts",
    code: 'export const f = () => console.log("x")\n',
    expect: [],
  },
  {
    path: `${F}/v/api.ts`,
    code: 'export const f = () => console.log("x")\n',
    expect: ["noConsole"],
  },
  // tests and tooling
  {
    path: `${F}/m/m.core.test.ts`,
    code: 'import { expect } from "bun:test"\n\nexpect(1).toBe(1)\n',
    expect: [],
  },
  {
    path: "apps/server/smoke/m.smoke.test.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code containing a template literal
    code: "export const r = () => fetch(`${process.env.SMOKE_URL}/api`)\n",
    expect: [],
  },
  // signatures and boundaries
  {
    path: "apps/server/src/platform/p.ts",
    code: "export function f(a: number, b: number) {\n  return a + b\n}\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p2.ts",
    code: "export const f = function (a: number, b: number) {\n  return a + b\n}\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p3.ts",
    code: "export default function (a: number, b: number) {\n  return a + b\n}\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p4.ts",
    code: "export function* f(a: number, b: number) {\n  yield a + b\n}\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p8.ts",
    code: "export const f = async (a: number, b: number): Promise<number> => a + b\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p6.ts",
    code: "export let f = (a: number, b: number) => a + b\nf = (a, b) => a - b\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p7.ts",
    code: "export var f = (a: number, b: number): number => a + b\n",
    expect: ["at most one parameter"],
  },
  {
    path: "apps/server/src/platform/p5.ts",
    code: "export const sorted = [2, 1].sort((a, b) => a - b)\n\nexport const w = {\n  fetch(a: number, b: number) {\n    return a + b\n  },\n}\n",
    expect: [],
  },
  {
    path: "apps/web/src/lib/q.ts",
    code: "export const f = async (r: Response) => (await r.json()) as { a: 1 }\n",
    expect: ["casting .json()"],
  },
  {
    path: "apps/web/src/lib/q2.ts",
    code: "interface U {\n  readonly id: string\n}\n\nexport const f = async (r: Response) => {\n  const u: U = await r.json()\n  return u\n}\n",
    expect: ["casting .json()"],
  },
  {
    path: "apps/web/src/lib/q3.ts",
    code: "export const f = async (r: Response) => {\n  const u: unknown = await r.json()\n  return u\n}\n",
    expect: [],
  },
  {
    path: "apps/web/src/lib/q4.ts",
    code: "export const f = (r: Response) => r.json<{ a: 1 }>()\n",
    expect: ["casting .json()"],
  },
  {
    path: "apps/web/src/lib/q5.ts",
    code: "export const f = (r: Response) => r.json<unknown>()\n",
    expect: [],
  },
  {
    path: "apps/web/src/lib/q6.ts",
    code: "export const f = (r: Response) => {\n  const p: Promise<unknown> = r.json()\n  return p\n}\n",
    expect: [],
  },
  {
    path: "apps/server/src/platform/nodeprocess.bun.ts",
    code: 'import { env } from "node:process"\n\nexport const p = env.PORT\n',
    expect: ["no process"],
  },
  {
    path: "apps/server/src/platform/nodeprocess.ts",
    code: 'import { env } from "node:process"\n\nexport const p = env.PORT\n',
    expect: ["no process"],
  },
  {
    path: "apps/server/scripts/nodeprocess.ts",
    code: 'import { env } from "node:process"\n\nexport const p = env.PORT\n',
    expect: [],
  },
  {
    path: `${F}/nodecrypto/nodecrypto.core.ts`,
    code: 'import { randomUUID } from "node:crypto"\n\nexport const id = () => randomUUID()\n',
    expect: ["deterministic"],
  },
  {
    path: `${F}/effectsub/effectsub.core.ts`,
    code: 'import * as Effect from "effect/Effect"\n\nexport const e = Effect.void\n',
    expect: ["Functional core must stay pure"],
  },
  {
    path: `${F}/effectsub/effectsub.io.ts`,
    code: 'import * as Effect from "effect/Effect"\n\nexport const e = Effect.void\n',
    expect: [],
  },
  {
    path: "apps/web/src/lib/r.ts",
    code: 'export const f = () => fetch("/api")\n',
    expect: ["global variable fetch"],
  },
  {
    path: `${F}/n/n.routes.ts`,
    code: 'export const f = () => console.log("x")\n',
    expect: ["noConsole"],
  },
]

let dir = ""
type Diagnostic = { category: string; message: string; location: { path: string } }
let diagnostics: Diagnostic[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "axioms-rules-"))
  await mkdir(join(dir, "node_modules", "@pierre-mike"), { recursive: true })
  symlinkSync(PKG_ROOT, join(dir, "node_modules", "@pierre-mike", "axioms"))
  await Bun.write(
    join(dir, "biome.json"),
    JSON.stringify({ extends: ["@pierre-mike/axioms/biome"] }),
  )
  for (const fixture of FIXTURES) {
    await mkdir(dirname(join(dir, fixture.path)), { recursive: true })
    await Bun.write(join(dir, fixture.path), fixture.code)
  }
  const proc = Bun.spawnSync(
    ["bun", toolPath("biome"), "lint", "--reporter=json", "--max-diagnostics=none", "apps"],
    {
      cwd: dir,
    },
  )
  const report = JSON.parse(proc.stdout.toString())
  diagnostics = report.diagnostics
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("the committed Biome configs are the output of biome.rules.ts", () => {
  it("harness/biome.shared.json is fresh (run `bun run build:biome`)", async () => {
    const committed = await Bun.file(join(PKG_ROOT, "harness", "biome.shared.json")).text()
    expect(committed).toBe(renderBiomeConfig())
  })

  it("the factory's own biome.json is fresh (run `bun run build:biome`)", async () => {
    const committed: unknown = await Bun.file(join(PKG_ROOT, "biome.json")).json()
    expect(committed).toEqual(JSON.parse(JSON.stringify(factoryBiomeConfig)))
  })
})

describe("grit/no-global-alias.grit", () => {
  it("covers every global a file shape bans, so no ban can be reached through globalThis", async () => {
    const grit = await Bun.file(join(PKG_ROOT, "harness", "grit", "no-global-alias.grit")).text()
    const missing = Object.keys(CORE_GLOBALS).filter((name) => !grit.includes(`\`${name}\``))
    expect(missing).toEqual([])
  })
})

describe("fixtures", () => {
  it("have unique paths, so one cannot overwrite another", () => {
    expect(new Set(FIXTURES.map((f) => f.path)).size).toBe(FIXTURES.length)
  })
})

describe("plugin diagnostics", () => {
  it("all point at a location", () => {
    expect(diagnostics.filter((d) => d.message.includes("valid span"))).toEqual([])
  })
})

describe("the shared rules, per file shape", () => {
  for (const fixture of FIXTURES) {
    const label = fixture.expect.length === 0 ? "is clean" : `reports ${fixture.expect.join(", ")}`
    it(`${fixture.path} ${label}`, () => {
      const found = diagnostics
        .filter((d) => d.location.path === fixture.path)
        .map((d) => `${d.category} ${d.message}`)
      if (fixture.expect.length === 0) expect(found).toEqual([])
      for (const needle of fixture.expect) {
        expect(found.some((text) => text.includes(needle))).toBe(true)
      }
    })
  }
})
