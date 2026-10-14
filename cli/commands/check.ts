/**
 * `axioms check`: every gate in one command, the same locally, in the pre-push hook and in CI.
 * Runs all gates even after a failure so one run shows everything that is wrong.
 */
import { missingCoreTests } from "../colocation.core"
import { run, runTool } from "../shell"
import { doctor } from "./doctor"

const IGNORED = /(^|\/)(node_modules|dist|\.wrangler)\//

const colocation = async (root: string): Promise<boolean> => {
  const files: string[] = []
  for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root })) {
    if (!IGNORED.test(file)) files.push(file)
  }
  const missing = missingCoreTests(files)
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
