/**
 * `axioms baseline [--update]`: runs the counted gates (Biome, the tests, the notes gate), reads
 * how many checks each reported, and compares the totals to gate-baseline.json. A total below the
 * baseline fails; `--update` writes the current totals. The count of a gate that reports nothing
 * is a failure too, and so is a gate that exits non-zero, because a gate that stops printing its count has quietly stopped checking.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  BASELINE_FILE,
  COUNTED,
  type Counted,
  type Counts,
  compareCounts,
  parseBaseline,
  parseCount,
  renderBaseline,
} from "../baseline.core"
import { run, runTool } from "../shell"

const hasTestScript = async (root: string): Promise<boolean> => {
  const file = Bun.file(join(root, "package.json"))
  if (!(await file.exists())) return false
  const pkg: unknown = await file.json()
  return (
    typeof pkg === "object" &&
    pkg !== null &&
    "scripts" in pkg &&
    typeof pkg.scripts === "object" &&
    pkg.scripts !== null &&
    "test" in pkg.scripts
  )
}

const gather = async (root: string): Promise<Counts | undefined> => {
  const outputs: Record<Counted, string[]> = { lint: [], tests: [], notes: [] }
  const sink = (gate: Counted) => (text: string) => {
    outputs[gate].push(text)
  }
  const test = (await hasTestScript(root)) ? ["bun", "run", "test"] : ["bun", "test"]
  const codes = [
    await runTool({ tool: "biome", args: ["ci", "."], cwd: root, sink: sink("lint") }),
    await run({ cmd: test, cwd: root, sink: sink("tests") }),
    await run({
      cmd: ["bun", join(import.meta.dir, "..", "main.ts"), "notes"],
      cwd: root,
      sink: sink("notes"),
    }),
  ]
  if (codes.some((code) => code !== 0)) {
    console.error("✖ baseline: a counted gate failed, so its count cannot be trusted")
    return undefined
  }
  const counts: Partial<Record<Counted, number>> = {}
  for (const gate of COUNTED) {
    const count = parseCount({ gate, output: outputs[gate].join("") })
    if (count === undefined) {
      console.error(`✖ baseline: the ${gate} gate reported no count`)
      return undefined
    }
    counts[gate] = count
  }
  return counts as Counts
}

export const baseline = async (input: {
  readonly root: string
  readonly update: boolean
}): Promise<boolean> => {
  const actual = await gather(input.root)
  if (actual === undefined) return false
  const path = join(input.root, BASELINE_FILE)
  if (input.update) {
    await Bun.write(path, renderBaseline(actual))
    console.error(
      `✓ baseline: wrote ${BASELINE_FILE} (${COUNTED.map((g) => `${g} ${actual[g]}`).join(", ")})`,
    )
    return true
  }
  if (!existsSync(path)) {
    console.error(
      `✖ baseline: no ${BASELINE_FILE}; run \`bunx axioms baseline --update\` and commit it`,
    )
    return false
  }
  const parsed = parseBaseline(await Bun.file(path).text())
  if (!parsed.ok) {
    console.error(`✖ baseline: ${parsed.error}`)
    return false
  }
  const { dropped, raised } = compareCounts({ baseline: parsed.counts, actual })
  for (const line of raised)
    console.error(`– baseline raised, run \`axioms baseline --update\`: ${line}`)
  if (dropped.length === 0) {
    console.error("✓ baseline: no gate reports fewer checks than the baseline")
    return true
  }
  for (const line of dropped) console.error(`✖ baseline: checks disappeared, ${line}`)
  return false
}
