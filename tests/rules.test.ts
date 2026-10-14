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
import { renderBiomeConfig } from "../harness/biome.rules"

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
    code: 'import { Either } from "effect"\n\nexport const ok = Either.right(1)\n',
    expect: [],
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
    path: `${F}/l/l.routes.ts`,
    code: 'import { x } from "../other/other.door"\n\nexport const y = x\n',
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
    path: "apps/web/src/lib/q.ts",
    code: "export const f = async (r: Response) => (await r.json()) as { a: 1 }\n",
    expect: ["casting .json()"],
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

describe("harness/biome.shared.json is the committed output of biome.rules.ts", () => {
  it("is fresh (run `bun run build:biome`)", async () => {
    const committed = await Bun.file(join(PKG_ROOT, "harness", "biome.shared.json")).text()
    expect(committed).toBe(renderBiomeConfig())
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
