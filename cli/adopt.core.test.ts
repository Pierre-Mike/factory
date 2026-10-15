import { describe, expect, it } from "bun:test"
import {
  type AdoptState,
  GITIGNORE_LINES,
  LITE_FALLOWRC,
  liteCiWorkflow,
  parseAdoptArgs,
  planAdopt,
} from "./adopt.core"
import { HARNESS_PACKAGE } from "./doctor.core"

const SPEC = "github:Pierre-Mike/factory#v9.9.9"

const bare: AdoptState = {
  pkgText: null,
  pkg: null,
  gitignore: null,
  hasCiWorkflow: false,
  hasFallowrc: false,
  hasGitDir: true,
  dirName: "legacy-repo",
  harnessSpec: SPEC,
  defaultBranch: "main",
}

const writesOf = (state: AdoptState) => {
  const plan = planAdopt(state)
  if (!plan.ok) throw new Error(plan.error)
  return plan.writes
}

const errorOf = (state: AdoptState) => {
  const plan = planAdopt(state)
  return plan.ok ? undefined : plan.error
}

const pkgOf = (state: AdoptState): Record<string, unknown> => JSON.parse(writesOf(state).pkg)

describe("parseAdoptArgs", () => {
  it("defaults to the release spec and an install", () => {
    expect(parseAdoptArgs([])).toEqual({ ok: true, args: { harness: undefined, install: true } })
  })

  it("takes --harness and --no-install in any order", () => {
    expect(parseAdoptArgs(["--no-install", "--harness", "file:/x"])).toEqual({
      ok: true,
      args: { harness: "file:/x", install: false },
    })
  })

  it("rejects a missing --harness value and stray arguments", () => {
    expect(parseAdoptArgs(["--harness"]).ok).toBe(false)
    expect(parseAdoptArgs(["--harness", "--no-install"]).ok).toBe(false)
    expect(parseAdoptArgs(["some-dir"]).ok).toBe(false)
    expect(parseAdoptArgs(["--force"]).ok).toBe(false)
  })
})

describe("planAdopt refusals", () => {
  it("refuses outside a git repository root", () => {
    expect(errorOf({ ...bare, hasGitDir: false })).toContain("not a git repository root")
  })

  it("refuses a package.json it cannot parse instead of clobbering it", () => {
    expect(errorOf({ ...bare, pkgText: "{oops", pkg: null })).toContain("not a JSON object")
  })

  it("refuses the factory itself", () => {
    const pkg = { name: HARNESS_PACKAGE }
    expect(errorOf({ ...bare, pkgText: "{}", pkg })).toContain("the factory is not adopted")
  })

  it("refuses a repo that already has the harness and points to sync", () => {
    for (const kind of ["dependencies", "devDependencies"]) {
      const pkg = { [kind]: { [HARNESS_PACKAGE]: "github:Pierre-Mike/factory#v0.8.0" } }
      expect(errorOf({ ...bare, pkgText: "{}", pkg })).toContain("bunx axioms sync")
    }
  })
})

describe("planAdopt package.json", () => {
  it("creates a minimal package.json when the repo has none", () => {
    const pkg = pkgOf(bare)
    expect(pkg.name).toBe("legacy-repo")
    expect(pkg.private).toBe(true)
    expect(pkg.scripts).toEqual({
      check: "axioms check",
      lint: "axioms biome check --write .",
      prepare: "axioms hooks",
    })
    expect(pkg.devDependencies).toEqual({ [HARNESS_PACKAGE]: SPEC })
    expect(pkg.axioms).toEqual({ profile: "lite" })
  })

  it("normalizes a folder name npm would reject", () => {
    expect(pkgOf({ ...bare, dirName: "My Repo!" }).name).toBe("my-repo")
  })

  it("keeps existing fields and scripts, and only forces check", () => {
    const pkg = {
      name: "kept",
      version: "1.2.3",
      scripts: { lint: "eslint .", test: "node t.js", prepare: "husky && axioms hooks" },
      devDependencies: { typescript: "5.0.0" },
    }
    const next = pkgOf({ ...bare, pkgText: "{}", pkg })
    expect(next.name).toBe("kept")
    expect(next.version).toBe("1.2.3")
    expect(next.scripts).toEqual({
      lint: "eslint .",
      test: "node t.js",
      prepare: "husky && axioms hooks",
      check: "axioms check",
    })
    expect(next.devDependencies).toEqual({ typescript: "5.0.0", [HARNESS_PACKAGE]: SPEC })
  })

  it("warns when it replaces a check script or leaves a foreign prepare", () => {
    const pkg = { scripts: { check: "make check", prepare: "husky" } }
    const writes = writesOf({ ...bare, pkgText: "{}", pkg })
    expect(writes.warnings.join("\n")).toContain('replaced the "check" script')
    expect(writes.warnings.join("\n")).toContain("axioms hooks")
    expect(pkgOf({ ...bare, pkgText: "{}", pkg }).scripts).toEqual({
      check: "axioms check",
      prepare: "husky",
      lint: "axioms biome check --write .",
    })
  })
})

describe("planAdopt skeleton files", () => {
  it("creates .gitignore from scratch", () => {
    expect(writesOf(bare).gitignore).toBe(`${GITIGNORE_LINES.join("\n")}\n`)
  })

  it("appends only the missing ignore entries, tolerating trailing slashes", () => {
    const gitignore = "dist/\n.env"
    expect(writesOf({ ...bare, gitignore }).gitignore).toBe(
      "dist/\n.env\nnode_modules\n*.tsbuildinfo\n.DS_Store\n",
    )
  })

  it("leaves a complete .gitignore alone", () => {
    const gitignore = `${GITIGNORE_LINES.join("\n")}\n`
    expect(writesOf({ ...bare, gitignore }).gitignore).toBeNull()
  })

  it("stamps the one-job CI workflow on the repo's default branch", () => {
    const writes = writesOf({ ...bare, defaultBranch: "master" })
    expect(writes.ciWorkflow).toBe(liteCiWorkflow("master"))
    expect(writes.ciWorkflow).toContain("branches: [master]")
    expect(writes.ciWorkflow).toContain("- run: bunx axioms check")
    const unpinned = [...(writes.ciWorkflow ?? "").matchAll(/uses: (\S+)/g)].filter(
      ([, action]) => !/@[0-9a-f]{40}$/.test(action ?? ""),
    )
    expect(unpinned).toEqual([])
  })

  it("leaves an existing CI workflow alone and says what doctor expects of it", () => {
    const writes = writesOf({ ...bare, hasCiWorkflow: true })
    expect(writes.ciWorkflow).toBeNull()
    expect(writes.warnings.join("\n")).toContain("bunx axioms check")
  })

  it("stamps .fallowrc.json only when the repo has none", () => {
    expect(writesOf(bare).fallowrc).toBe(LITE_FALLOWRC)
    expect(writesOf({ ...bare, hasFallowrc: true }).fallowrc).toBeNull()
  })
})
