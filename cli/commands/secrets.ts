/**
 * `axioms secret-scan`: gitleaks over the committed history, or over the staged changes with
 * --staged (what the pre-commit hook runs, so a secret never enters a commit). Locally gitleaks
 * comes from Homebrew. On a CI runner, a missing gitleaks is downloaded at a pinned version.
 * A missing tool fails the gate instead of skipping it.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { run } from "../shell"

const GITLEAKS_VERSION = "8.30.1"
const INSTALL_HINT = "brew install gitleaks"

/** Release asset suffix by `${process.platform}-${process.arch}`. */
const ASSETS: Readonly<Record<string, string>> = {
  "darwin-arm64": "darwin_arm64",
  "darwin-x64": "darwin_x64",
  "linux-arm64": "linux_arm64",
  "linux-x64": "linux_x64",
}

const gitleaks = async (root: string): Promise<string | undefined> => {
  const local = Bun.which("gitleaks")
  if (local) return local
  if (!process.env.CI) return undefined
  const dir = join(root, "node_modules", ".cache", "axioms-tools")
  const cached = join(dir, "gitleaks")
  if (existsSync(cached)) return cached
  const asset = ASSETS[`${process.platform}-${process.arch}`]
  if (asset === undefined) return undefined
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${asset}.tar.gz`
  const code = await run({
    cmd: ["bash", "-c", `mkdir -p "${dir}" && curl -sSfL "${url}" | tar -xz -C "${dir}" gitleaks`],
    cwd: root,
  })
  return code === 0 ? cached : undefined
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
