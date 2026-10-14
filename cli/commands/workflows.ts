/**
 * `axioms lint-workflows`: actionlint (does each workflow make sense: syntax, expressions, job
 * references) and zizmor (is it safe: injection, credential persistence, unpinned actions).
 * Locally both come from Homebrew. On a CI runner, a missing tool is installed at a pinned version.
 * A missing tool fails the gate instead of skipping it.
 */
import { join } from "node:path"
import { run } from "../shell"

const ACTIONLINT_VERSION = "1.7.12"
const ZIZMOR_VERSION = "1.30.1"
const INSTALL_HINT = "brew install actionlint zizmor"

const actionlint = async (root: string): Promise<string[] | undefined> => {
  const local = Bun.which("actionlint")
  if (local) return [local]
  if (!process.env.CI) return undefined
  const dir = join(root, "node_modules", ".cache", "axioms-tools")
  const script = `https://raw.githubusercontent.com/rhysd/actionlint/v${ACTIONLINT_VERSION}/scripts/download-actionlint.bash`
  const code = await run({
    cmd: [
      "bash",
      "-c",
      `mkdir -p "${dir}" && bash <(curl -sSfL ${script}) ${ACTIONLINT_VERSION} "${dir}"`,
    ],
    cwd: root,
  })
  return code === 0 ? [join(dir, "actionlint")] : undefined
}

const zizmor = (): string[] | undefined => {
  const local = Bun.which("zizmor")
  if (local) return [local]
  if (!process.env.CI) return undefined
  const pipx = Bun.which("pipx")
  if (pipx) return [pipx, "run", `zizmor==${ZIZMOR_VERSION}`]
  const uvx = Bun.which("uvx")
  return uvx ? [uvx, `zizmor@${ZIZMOR_VERSION}`] : undefined
}

export const lintWorkflows = async (root: string): Promise<boolean> => {
  const lint = await actionlint(root)
  const audit = zizmor()
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
