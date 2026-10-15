/**
 * `axioms secret-scan`: gitleaks over the committed history, or over the staged changes with
 * --staged (what the pre-commit hook runs, so a secret never enters a commit). Locally gitleaks
 * comes from Homebrew. On a CI runner, a missing gitleaks is downloaded at a pinned
 * version and checked against its SHA256 (cli/tools.core.ts).
 * A missing tool fails the gate instead of skipping it.
 */
import { run } from "../shell"
import { installPinned } from "./tools"

const INSTALL_HINT = "brew install gitleaks"

const gitleaks = async (root: string): Promise<string | undefined> => {
  const local = Bun.which("gitleaks")
  if (local) return local
  if (!process.env.CI) return undefined
  return await installPinned({ root, tool: "gitleaks" })
}

export const secretScan = async (input: {
  readonly root: string
  readonly staged: boolean
}): Promise<boolean> => {
  const tool = await gitleaks(input.root)
  if (tool === undefined) {
    console.error(`✖ secret-scan: gitleaks not installed (${INSTALL_HINT})`)
    return false
  }
  const mode = input.staged ? ["--pre-commit", "--staged"] : []
  const scanned = input.staged ? "the staged changes" : "the committed history"
  const ok =
    (await run({
      cmd: [tool, "git", ...mode, "--redact", "--no-banner", "--verbose", "."],
      cwd: input.root,
    })) === 0
  console.error(
    ok
      ? `✓ gitleaks: no secrets in ${scanned}`
      : `✖ gitleaks found secrets in ${scanned}; remove them before they leave the machine`,
  )
  return ok
}
