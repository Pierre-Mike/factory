/**
 * `axioms adopt`, pure: given an existing repository's current state, decide what to stamp so the
 * lite harness (every gate that works without the app template) runs there. The shell
 * (commands/adopt.ts) reads the files, writes the plan and calls `axioms sync`, which owns every
 * synced copy (AGENTS.md canon, CLAUDE.md, notes rules, biome.json, lefthook.yml). Adopt writes
 * only the skeleton sync does not: package.json, CI, .fallowrc.json and .gitignore.
 */
import { HARNESS_PACKAGE, isRecord } from "./doctor.core"

export const ADOPT_USAGE = "usage: axioms adopt [--harness <spec>] [--no-install]"

export interface AdoptArgs {
  /** The harness spec to pin; undefined means the release tag of the running version. */
  readonly harness: string | undefined
  readonly install: boolean
}

export type ParsedAdoptArgs =
  | { readonly ok: true; readonly args: AdoptArgs }
  | { readonly ok: false; readonly error: string }

const argFailure = (error: string): ParsedAdoptArgs => ({
  ok: false,
  error: `${error}\n${ADOPT_USAGE}`,
})

export const parseAdoptArgs = (args: ReadonlyArray<string>): ParsedAdoptArgs => {
  let harness: string | undefined
  let install = true
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ""
    if (arg === "--harness") {
      const value = args[i + 1]
      if (value === undefined || value.startsWith("-")) return argFailure("--harness needs a value")
      harness = value
      i++
    } else if (arg === "--no-install") install = false
    else return argFailure(`unexpected argument ${arg}`)
  }
  return { ok: true, args: { harness, install } }
}

export interface AdoptState {
  /** package.json text: `null` when the repo has none (adopt creates one). */
  readonly pkgText: string | null
  /** The parsed package.json: `null` when the file is missing or not valid JSON. */
  readonly pkg: unknown
  readonly gitignore: string | null
  readonly hasCiWorkflow: boolean
  readonly hasFallowrc: boolean
  readonly hasGitDir: boolean
  readonly dirName: string
  readonly harnessSpec: string
  /** The branch the stamped CI workflow triggers on. */
  readonly defaultBranch: string
}

export interface AdoptWrites {
  /** The new package.json text. */
  readonly pkg: string
  /** Full new .gitignore content, or `null` to leave the file alone. */
  readonly gitignore: string | null
  /** .github/workflows/ci.yml content, or `null` when the repo already has one. */
  readonly ciWorkflow: string | null
  /** .fallowrc.json content, or `null` when the repo already has one. */
  readonly fallowrc: string | null
  readonly warnings: ReadonlyArray<string>
}

export type AdoptPlan =
  | { readonly ok: true; readonly writes: AdoptWrites }
  | { readonly ok: false; readonly error: string }

const refuse = (error: string): AdoptPlan => ({ ok: false, error })

/** What the stamped .gitignore must cover: build output and tool droppings, nothing app-shaped. */
export const GITIGNORE_LINES: ReadonlyArray<string> = [
  "node_modules",
  "dist",
  "*.tsbuildinfo",
  ".DS_Store",
]

/** "node_modules", "node_modules/" and " node_modules " all count as the same ignore entry. */
const ignoreEntry = (line: string): string => line.trim().replace(/\/+$/, "")

const gitignorePlan = (existing: string | null): string | null => {
  const present = new Set((existing ?? "").split(/\r?\n/).map(ignoreEntry))
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line))
  if (missing.length === 0) return null
  const block = `${missing.join("\n")}\n`
  if (existing === null) return block
  return `${existing.endsWith("\n") ? existing : `${existing}\n`}${block}`
}

/**
 * The one-job CI workflow for an adopted repo: install, then `axioms check`. The action SHAs are
 * the ones the app template pins (template/.github/workflows/ci.yml); keep them in step.
 */
export const liteCiWorkflow = (defaultBranch: string): string => `name: ci

on:
  pull_request:
    branches: [${defaultBranch}]
  push:
    branches: [${defaultBranch}]

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          persist-credentials: false
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.6
      - run: bun install --frozen-lockfile
      - run: bunx axioms check
`

/** Entry points fallow can assume in a repo the factory did not generate; the owner refines them. */
export const LITE_FALLOWRC = `{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "entry": ["src/index.ts", "index.ts", "**/*.test.ts", "**/*.test.tsx"],
  "duplicates": { "minOccurrences": 3 }
}
`

/** A package.json name npm would accept, from a folder name that may not be. */
const packageName = (dirName: string): string =>
  dirName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-_.]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "adopted"

const dependsOnHarness = (pkg: unknown): boolean =>
  ["dependencies", "devDependencies"].some((kind) => {
    const deps = isRecord(pkg) ? pkg[kind] : undefined
    return isRecord(deps) && deps[HARNESS_PACKAGE] !== undefined
  })

const scriptPlan = (input: {
  readonly scripts: Record<string, unknown>
  readonly warnings: string[]
}): Record<string, unknown> => {
  const next = { ...input.scripts }
  const check = next.check
  if (check !== undefined && check !== "axioms check") {
    input.warnings.push(`replaced the "check" script (was: ${String(check)})`)
  }
  next.check = "axioms check"
  if (next.lint === undefined) next.lint = "axioms biome check --write ."
  const prepare = next.prepare
  if (prepare === undefined) next.prepare = "axioms hooks"
  else if (typeof prepare !== "string" || !prepare.includes("axioms hooks")) {
    input.warnings.push(
      'left the "prepare" script alone; add `axioms hooks` to it so a fresh clone installs the git hooks',
    )
  }
  return next
}

export const planAdopt = (state: AdoptState): AdoptPlan => {
  if (!state.hasGitDir) {
    return refuse(
      "not a git repository root (no .git here); run `axioms adopt` from the repo root, or `git init` first",
    )
  }
  if (state.pkgText !== null && !isRecord(state.pkg)) {
    return refuse("package.json exists but is not a JSON object; fix it, then adopt again")
  }
  const pkg = isRecord(state.pkg) ? state.pkg : undefined
  if (pkg?.name === HARNESS_PACKAGE) {
    return refuse(`this is ${HARNESS_PACKAGE} itself; the factory is not adopted`)
  }
  if (dependsOnHarness(pkg)) {
    return refuse(
      `${HARNESS_PACKAGE} is already a dependency here; run \`bunx axioms sync\` to refresh the synced copies instead`,
    )
  }

  const warnings: string[] = []
  const base = pkg ?? { name: packageName(state.dirName), private: true }
  const next = {
    ...base,
    scripts: scriptPlan({ scripts: isRecord(base.scripts) ? base.scripts : {}, warnings }),
    devDependencies: {
      ...(isRecord(base.devDependencies) ? base.devDependencies : {}),
      [HARNESS_PACKAGE]: state.harnessSpec,
    },
    // `axioms doctor` reads this profile: lite repos get the lite checks, never the app-shaped ones.
    axioms: { ...(isRecord(base.axioms) ? base.axioms : {}), profile: "lite" },
  }

  if (state.hasCiWorkflow) {
    warnings.push(
      "left .github/workflows/ci.yml alone; `axioms doctor` requires a must-pass `bunx axioms check` step in it",
    )
  }
  if (!state.hasFallowrc) {
    warnings.push(
      "stamped .fallowrc.json with guessed entry points; review them so `fallow dead-code` sees your real entries",
    )
  }

  return {
    ok: true,
    writes: {
      pkg: `${JSON.stringify(next, null, 2)}\n`,
      gitignore: gitignorePlan(state.gitignore),
      ciWorkflow: state.hasCiWorkflow ? null : liteCiWorkflow(state.defaultBranch),
      fallowrc: state.hasFallowrc ? null : LITE_FALLOWRC,
      warnings,
    },
  }
}
