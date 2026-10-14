/**
 * `axioms check`: every gate in one command, the same locally, in the pre-push hook and in CI.
 * Runs all gates even after a failure so one run shows everything that is wrong.
 */
import { join } from "node:path"
import { missingCoreTests } from "../colocation.core"
import { run, runTool } from "../shell"
import { findSuppressions } from "../suppressions.core"
import { doctor } from "./doctor"

const IGNORED = /(^|\/)(node_modules|dist|\.wrangler)\//

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

export const check = async (root: string): Promise<boolean> => {
  const gates: ReadonlyArray<readonly [string, () => Promise<boolean>]> = [
    ["lint", async () => (await runTool({ tool: "biome", args: ["ci", "."], cwd: root })) === 0],
    ["typecheck", async () => (await runTool({ tool: "tsc", args: ["-b"], cwd: root })) === 0],
    ["colocation", () => colocation(root)],
    ["suppressions", () => suppressions(root)],
    ["doctor", () => doctor(root)],
    ["test", async () => (await run({ cmd: ["bun", "test"], cwd: root })) === 0],
    [
      "dead code",
      async () => (await runTool({ tool: "fallow", args: ["dead-code"], cwd: root })) === 0,
    ],
    [
      "duplication",
      async () => (await runTool({ tool: "fallow", args: ["dupes"], cwd: root })) === 0,
    ],
  ]
  const failed: string[] = []
  for (const [name, gate] of gates) {
    console.error(`\n── ${name} ──`)
    if (!(await gate())) failed.push(name)
  }
  console.error(
    failed.length === 0 ? "\n✓ check: all gates passed" : `\n✖ check failed: ${failed.join(", ")}`,
  )
  return failed.length === 0
}
