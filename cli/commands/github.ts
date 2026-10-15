/**
 * Read and write the repo's state on GitHub through `gh`, the auth the user already has. Every
 * failure becomes a reason string the pure core can report, so a fresh project with no remote, a
 * machine without gh, or a plan that refuses the rulesets API degrades to "not verified" instead
 * of a crash.
 */
import { join } from "node:path"
import { isRecord } from "../doctor.core"
import { type GithubRulesInput, type GithubState, RULES_FILE } from "../rules.core"
import { PKG_ROOT, readJson } from "../shell"

export interface GhResult {
  readonly ok: boolean
  readonly stdout: string
  /** The first useful stderr line, with gh's own prefix stripped: the "why" for the doctor. */
  readonly reason: string
}

export const gh = (input: {
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly stdin?: string
}): GhResult => {
  const proc = Bun.spawnSync(["gh", ...input.args], {
    cwd: input.cwd,
    stdin: input.stdin === undefined ? "ignore" : Buffer.from(input.stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  const reason =
    proc.stderr
      .toString()
      .split("\n")
      .map((line) => line.replace(/^gh:\s*/, "").trim())
      .find((line) => line !== "") ?? `gh ${input.args.join(" ")} failed`
  return { ok: proc.exitCode === 0, stdout: proc.stdout.toString(), reason }
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The owner/name gh resolves from the git remote, or the reason there is none. */
export const resolveRepo = (
  cwd: string,
):
  | { readonly ok: true; readonly repo: string }
  | { readonly ok: false; readonly reason: string } => {
  if (Bun.which("gh") === null) {
    return { ok: false, reason: "gh is not installed (brew install gh)" }
  }
  const view = gh({
    args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    cwd,
  })
  const repo = view.stdout.trim()
  return view.ok && repo !== "" ? { ok: true, repo } : { ok: false, reason: view.reason }
}

/** Fetch what the drift check diffs: the repo (auto-merge) and the default branch's active rules. */
export const readGithubState = (root: string): GithubState => {
  const resolved = resolveRepo(root)
  if (!resolved.ok) return { kind: "unavailable", reason: resolved.reason }
  const repoCall = gh({ args: ["api", `repos/${resolved.repo}`], cwd: root })
  if (!repoCall.ok) return { kind: "unavailable", reason: repoCall.reason }
  const repo = parseJson(repoCall.stdout)
  const branch =
    isRecord(repo) && typeof repo.default_branch === "string" ? repo.default_branch : ""
  if (branch === "") {
    return { kind: "unavailable", reason: `could not read the default branch of ${resolved.repo}` }
  }
  const rules = gh({
    args: ["api", `repos/${resolved.repo}/rules/branches/${encodeURIComponent(branch)}`],
    cwd: root,
  })
  if (!rules.ok) return { kind: "unavailable", reason: rules.reason }
  return { kind: "live", branchRules: parseJson(rules.stdout), repo }
}

export const readGithubInput = (root: string): GithubRulesInput => ({
  expected: readJson(join(PKG_ROOT, RULES_FILE)),
  state: readGithubState(root),
})
