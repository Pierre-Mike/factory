/**
 * Branch protection as data, pure. The harness owns the expected ruleset
 * (harness/github.rules.json); the shell reads the live state through `gh api` and passes plain
 * JSON in. `checkGithubRules` turns drift into doctor findings, and `planRulesetApply` picks the
 * one API call that converges a repo on the file.
 */
import { type Finding, isRecord } from "./doctor.core"

export const RULES_FILE = "harness/github.rules.json"
export const RULES_USAGE = "usage: axioms rules [--apply]"

const APPLY_REMEDY = "run `bunx axioms rules --apply`"

/** What the shell could read from GitHub, or why it could not. */
export type GithubState =
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "live"
      /** GET repos/{owner}/{repo}/rules/branches/{default}: every rule active on the branch. */
      readonly branchRules: unknown
      /** GET repos/{owner}/{repo}: `allow_auto_merge` lives here. */
      readonly repo: unknown
    }

export interface GithubRulesInput {
  readonly expected: unknown
  readonly state: GithubState
}

const field = (input: { readonly value: unknown; readonly key: string }): unknown =>
  isRecord(input.value) ? input.value[input.key] : undefined

const ruleList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter(isRecord) : []

const reviewCount = (rule: unknown): unknown =>
  field({
    value: field({ value: rule, key: "parameters" }),
    key: "required_approving_review_count",
  })

const contexts = (rule: unknown): string[] =>
  ruleList(
    field({ value: field({ value: rule, key: "parameters" }), key: "required_status_checks" }),
  ).flatMap((check) => (typeof check.context === "string" ? [check.context] : []))

const checkReviews = (input: {
  readonly expected: Record<string, unknown>
  readonly live: Record<string, unknown>
}): Finding[] => {
  const wanted = reviewCount(input.expected)
  const got = reviewCount(input.live)
  if (typeof wanted !== "number") return []
  if (typeof got === "number" && got >= wanted) return []
  return [
    {
      rule: "github",
      problem: `pull requests merge with ${typeof got === "number" ? got : 0} approving reviews, but the harness requires ${wanted}`,
      remedy: APPLY_REMEDY,
    },
  ]
}

const checkContexts = (input: {
  readonly expected: Record<string, unknown>
  readonly live: Record<string, unknown>
}): Finding[] => {
  const live = new Set(contexts(input.live))
  return contexts(input.expected)
    .filter((context) => !live.has(context))
    .map((context) => ({
      rule: "github",
      problem: `CI job "${context}" is not a required status check on the default branch`,
      remedy: APPLY_REMEDY,
    }))
}

/** True when the repo must be PATCHed to turn pull-request auto-merge on. */
export const autoMergeOff = (repo: unknown): boolean =>
  field({ value: repo, key: "allow_auto_merge" }) !== true

/**
 * Diff the live branch rules against harness/github.rules.json. An unavailable state produces no
 * findings (see `githubNotice`); a readable repo missing a rule, a required check, the review
 * requirement or auto-merge fails the doctor.
 */
export const checkGithubRules = (input: GithubRulesInput): Finding[] => {
  if (!isRecord(input.expected)) {
    return [
      {
        rule: "github",
        problem: `${RULES_FILE} is missing from the installed harness or not valid JSON`,
        remedy: "reinstall the harness (`bun install`)",
      },
    ]
  }
  if (input.state.kind === "unavailable") return []
  const actual = ruleList(input.state.branchRules)
  const findings: Finding[] = []
  for (const rule of ruleList(input.expected.rules)) {
    const type = rule.type
    if (typeof type !== "string") continue
    const live = actual.find((candidate) => candidate.type === type)
    if (live === undefined) {
      findings.push({
        rule: "github",
        problem: `the default branch has no active "${type}" rule on GitHub`,
        remedy: APPLY_REMEDY,
      })
      continue
    }
    if (type === "pull_request") findings.push(...checkReviews({ expected: rule, live }))
    if (type === "required_status_checks") findings.push(...checkContexts({ expected: rule, live }))
  }
  if (autoMergeOff(input.state.repo)) {
    findings.push({
      rule: "github",
      problem: "repository auto-merge is off, so a green, approved PR waits for a human to merge",
      remedy: `${APPLY_REMEDY} (or \`gh repo edit --enable-auto-merge\`)`,
    })
  }
  return findings
}

/**
 * Doctor cannot judge what it cannot read: a project with no GitHub remote, a machine without gh
 * or auth, or a plan that refuses the rulesets API is reported, not failed.
 */
export const githubNotice = (state: GithubState): string | undefined =>
  state.kind === "unavailable"
    ? `– [github] branch protection not verified: ${state.reason}`
    : undefined

export interface ApplyCall {
  readonly method: "POST" | "PUT"
  readonly path: string
  readonly summary: string
}

/**
 * Create or update, idempotently: a live ruleset with the file's name is updated in place (PUT),
 * anything else means create (POST). `rulesets` is GET repos/{owner}/{repo}/rulesets without
 * parents, since only repo-level rulesets can be written back.
 */
export const planRulesetApply = (input: {
  readonly expected: unknown
  readonly rulesets: unknown
  readonly repo: string
}):
  | { readonly ok: true; readonly call: ApplyCall }
  | { readonly ok: false; readonly error: string } => {
  const name = field({ value: input.expected, key: "name" })
  if (typeof name !== "string" || name === "") {
    return { ok: false, error: `${RULES_FILE} is missing, not valid JSON, or has no "name"` }
  }
  if (!Array.isArray(input.rulesets)) {
    return { ok: false, error: "listing the repo's rulesets returned something other than a list" }
  }
  const match = input.rulesets.filter(isRecord).find((ruleset) => ruleset.name === name)
  const id = field({ value: match, key: "id" })
  const base = `repos/${input.repo}/rulesets`
  return typeof id === "number"
    ? {
        ok: true,
        call: {
          method: "PUT",
          path: `${base}/${id}`,
          summary: `update ruleset "${name}" (id ${id})`,
        },
      }
    : { ok: true, call: { method: "POST", path: base, summary: `create ruleset "${name}"` } }
}

/**
 * Only `--apply` is accepted. Anything else (`--aply`, `--force`) is refused instead of read as
 * "just preview", which would silently skip the write the caller asked for.
 */
export const parseRulesArgs = (
  args: ReadonlyArray<string>,
):
  | { readonly ok: true; readonly apply: boolean }
  | { readonly ok: false; readonly error: string } => {
  const unknown = args.find((arg) => arg !== "--apply")
  return unknown === undefined
    ? { ok: true, apply: args.length > 0 }
    : { ok: false, error: `unexpected argument ${unknown}\n${RULES_USAGE}` }
}
