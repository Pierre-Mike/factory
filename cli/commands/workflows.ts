/**
 * `axioms lint-workflows`: actionlint (does each workflow make sense: syntax, expressions, job
 * references) and zizmor (is it safe: injection, credential persistence, unpinned actions).
 * Locally both come from Homebrew. On a CI runner, a missing tool is downloaded at a pinned version
 * and checked against its SHA256 (cli/tools.core.ts).
 * A missing tool fails the gate instead of skipping it.
 */
import { run } from "../shell"
import { installPinned } from "./tools"

const INSTALL_HINT = "brew install actionlint zizmor"

const pinnedOnCi = async (input: {
  readonly root: string
  readonly tool: "actionlint" | "zizmor"
}): Promise<string[] | undefined> => {
  const local = Bun.which(input.tool)
  if (local) return [local]
  if (!process.env.CI) return undefined
  const installed = await installPinned(input)
  return installed === undefined ? undefined : [installed]
}

export const lintWorkflows = async (root: string): Promise<boolean> => {
  const lint = await pinnedOnCi({ root, tool: "actionlint" })
  const audit = await pinnedOnCi({ root, tool: "zizmor" })
  if (lint === undefined || audit === undefined) {
    const missing = [lint ? [] : ["actionlint"], audit ? [] : ["zizmor"]].flat().join(" and ")
    console.error(`✖ lint-workflows: ${missing} not installed (${INSTALL_HINT})`)
    return false
  }
  const linted = (await run({ cmd: lint, cwd: root })) === 0
  console.error(linted ? "✓ actionlint: workflows are valid" : "✖ actionlint found problems")
  const audited =
    (await run({ cmd: [...audit, "--offline", "--quiet", ".github/workflows"], cwd: root })) === 0
  console.error(audited ? "✓ zizmor: no security findings" : "✖ zizmor found problems")
  return linted && audited
}
