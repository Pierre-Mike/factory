/**
 * `axioms check`: every gate in one command, the same locally, in the pre-push hook and in CI.
 * Runs all gates even after a failure so one run shows everything that is wrong. With `collect`
 * (behind `--json` / `--report`), each gate's output is captured as evidence for the report.
 * Typecheck skips itself without a root tsconfig.json and test without a test file (an adopted
 * repo may have neither); a skip passes, and both the log and the report say why.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { missingCoreTests } from "../colocation.core"
import { run, runTool } from "../shell"
import { findSuppressions } from "../suppressions.core"
import { doctor } from "./doctor"
import { failedNames, type Gate, type GateRun, runGates, skippedNames } from "./gates"
import { lint } from "./lint"
import { notes } from "./notes"

const IGNORED = /(^|\/)(node_modules|dist|\.wrangler)\//

/** Bun's own test discovery pattern, so the skip decision matches what `bun test` would run. */
const TEST_GLOB = "**/*{.test,.spec,_test_,_spec_}.{js,jsx,ts,tsx}"

const hasTestFiles = async (root: string): Promise<boolean> => {
  for await (const file of new Bun.Glob(TEST_GLOB).scan({ cwd: root })) {
    if (!IGNORED.test(file)) return true
  }
  return false
}

const sourceFiles = async (root: string): Promise<string[]> => {
  const files: string[] = []
  for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root })) {
    if (!IGNORED.test(file)) files.push(file)
  }
  return files
}

const suppressions = async (root: string): Promise<boolean> => {
  const files = await Promise.all(
    (await sourceFiles(root)).map(async (path) => ({
      path,
      text: await Bun.file(join(root, path)).text(),
    })),
  )
  const found = findSuppressions(files)
  if (found.length === 0) {
    console.error("✓ no biome-ignore or @ts- suppressions outside tests")
    return true
  }
  console.error("✖ suppression comments switch off a gate; fix the code instead:")
  for (const f of found) console.error(`  ${f}`)
  return false
}

const colocation = async (root: string): Promise<boolean> => {
  const missing = missingCoreTests(await sourceFiles(root))
  if (missing.length === 0) {
    console.error("✓ every *.core.ts has a co-located *.core.test.ts")
    return true
  }
  console.error("✖ cores without a co-located test:")
  for (const m of missing) console.error(`  ${m}`)
  return false
}

export const check = async (input: {
  readonly root: string
  readonly collect: boolean
}): Promise<GateRun> => {
  const root = input.root
  const gates: ReadonlyArray<Gate> = [
    ["lint", (sink) => lint({ root, sink })],
    [
      "typecheck",
      // An adopted repo may have no TypeScript config at all. The skip passes with its reason,
      // printed and kept in the evidence report, so it is said, never silent.
      async (sink) =>
        existsSync(join(root, "tsconfig.json"))
          ? (await runTool({ tool: "tsc", args: ["-b"], cwd: root, sink })) === 0
          : { skipped: "no tsconfig.json at the project root" },
    ],
    ["colocation", () => colocation(root)],
    ["suppressions", () => suppressions(root)],
    ["notes", () => notes({ root, seal: false })],
    ["doctor", () => doctor(root)],
    [
      "test",
      // `bun test` fails outright when nothing matches; no tests is a fact, not a failure.
      async (sink) =>
        (await hasTestFiles(root))
          ? (await run({ cmd: ["bun", "test"], cwd: root, sink })) === 0
          : { skipped: "no test files" },
    ],
    [
      "dead code",
      async (sink) =>
        (await runTool({ tool: "fallow", args: ["dead-code"], cwd: root, sink })) === 0,
    ],
    [
      "duplication",
      async (sink) => (await runTool({ tool: "fallow", args: ["dupes"], cwd: root, sink })) === 0,
    ],
  ]
  const result = await runGates({ gates, collect: input.collect, stopOnFailure: false })
  const skipped = skippedNames(result)
  console.error(
    result.ok
      ? `\n✓ check: all gates passed${skipped === "" ? "" : ` (skipped: ${skipped})`}`
      : `\n✖ check failed: ${failedNames(result)}`,
  )
  return result
}
