/**
 * The lint gate of `axioms check`. Biome runs once with the json reporter, captured. Files that
 * `bun run lint` fixes (formatting, import order) are listed by name with the fix command, never
 * as Biome's formatter diff. Anything else runs again with the formatter and assist off so only
 * those diagnostics print: in full on a terminal, as Biome's summary in `--json` evidence.
 */
import { biomeColorArgs, classifyLint, parseBiomeJson, writeFixableReport } from "../lint.core"
import { runTool, type Sink, toolPath } from "../shell"

const biomeJson = async (root: string): Promise<{ code: number; stdout: string }> => {
  const args = ["ci", "--reporter=json", "--colors=off", "--max-diagnostics=none", "."]
  const proc = Bun.spawn(["bun", toolPath("biome"), ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, stdout }
}

export const lint = async (input: {
  readonly root: string
  readonly sink: Sink | undefined
}): Promise<boolean> => {
  const biome = (args: ReadonlyArray<string>) =>
    runTool({
      tool: "biome",
      args: [
        "ci",
        ...args,
        ...biomeColorArgs({
          stdoutTTY: process.stdout.isTTY === true,
          stderrTTY: process.stderr.isTTY === true,
        }),
        ".",
      ],
      cwd: input.root,
      sink: input.sink,
    })
  const first = await biomeJson(input.root)
  const report = parseBiomeJson(first.stdout)
  // Biome failed without diagnostics (a bad config, no files, a crash): rerun it so it says why.
  if (report === null || (first.code !== 0 && report.diagnostics.length === 0)) {
    return (await biome([])) === 0
  }
  const { fixable, othersFound } = classifyLint(report)
  if (fixable.length > 0) {
    for (const line of writeFixableReport({ files: fixable, othersFound })) console.error(line)
  }
  if (othersFound) {
    const reporter = input.sink === undefined ? [] : ["--reporter=summary"]
    await biome(["--formatter-enabled=false", "--assist-enabled=false", ...reporter])
  }
  if (first.code === 0) console.error("✓ biome: no lint or formatting errors")
  return first.code === 0
}
