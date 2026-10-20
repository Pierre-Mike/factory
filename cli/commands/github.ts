/**
 * Read and write the repo's state on GitHub through `gh`, the auth the user already has. Every
 * failure becomes a reason string the pure core can report, so a fresh project with no remote, a
 * machine without gh, or a plan that refuses the rulesets API degrades to "not verified" instead
 * of a crash.
 */
import { join } from "node:path"
import { isRecord, type SecretsState } from "../doctor.core"
import {
  branchLookupFailure,
  type GithubRulesInput,
  type GithubState,
  RULES_FILE,
} from "../rules.core"
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
  const lookup = gh({
    args: ["api", `repos/${resolved.repo}/branches/${encodeURIComponent(branch)}`],
    cwd: root,
  })
  const missing = branchLookupFailure({ repo: resolved.repo, branch, lookup })
  if (missing !== undefined) return missing
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

const secretNames = (text: string): string[] => {
  const list = parseJson(text)
  return Array.isArray(list)
    ? list.flatMap((entry) =>
        isRecord(entry) && typeof entry.name === "string" ? [entry.name] : [],
      )
    : []
}

/**
 * The names of the repo's secrets and of each environment's, through `gh secret list`. Values are
 * never read (GitHub does not expose them). An environment that 404s does not exist yet: GitHub
 * creates it on the first job that names it, so it simply has no secrets.
 */
export const readSecretsState = (input: {
  readonly root: string
  readonly environments: ReadonlyArray<string>
}): SecretsState => {
  const resolved = resolveRepo(input.root)
  if (!resolved.ok) return { kind: "unavailable", reason: resolved.reason }
  const list = (env: ReadonlyArray<string>) =>
    gh({
      args: ["secret", "list", "--repo", resolved.repo, ...env, "--json", "name"],
      cwd: input.root,
    })
  const repository = list([])
  if (!repository.ok) return { kind: "unavailable", reason: repository.reason }
  const environments: { name: string; secrets: string[] | null }[] = []
  for (const name of input.environments) {
    const result = list(["--env", name])
    if (!result.ok && !result.reason.includes("HTTP 404")) {
      return { kind: "unavailable", reason: result.reason }
    }
    environments.push({ name, secrets: result.ok ? secretNames(result.stdout) : null })
  }
  return { kind: "live", repository: secretNames(repository.stdout), environments }
}
