import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  autoMergeOff,
  branchLookupFailure,
  checkGithubRules,
  type GithubState,
  githubNotice,
  parseRulesArgs,
  planRulesetApply,
  RULES_FILE,
} from "./rules.core"

interface Rule {
  readonly type: string
  readonly parameters?: Record<string, unknown>
}

/** The shipped file is the green fixture, so the test breaks when the file stops matching it. */
const expected: unknown = JSON.parse(readFileSync(join(import.meta.dir, "..", RULES_FILE), "utf8"))
const fileRules = (expected as { rules: Rule[] }).rules

/** Live state as GET rules/branches/{branch} and GET repos/{owner}/{repo} would return it. */
const live = (input: { readonly rules?: Rule[]; readonly autoMerge?: boolean }): GithubState => ({
  kind: "live",
  branchRules: (input.rules ?? fileRules).map((rule) => ({
    ...rule,
    ruleset_source_type: "Repository",
    ruleset_id: 42,
  })),
  repo: { default_branch: "main", allow_auto_merge: input.autoMerge ?? true },
})

const check = (state: GithubState) => checkGithubRules({ expected, state })
const problems = (state: GithubState) => check(state).map((finding) => finding.problem)

const withPullRequest = (parameters: Record<string, unknown>): Rule[] =>
  fileRules.map((rule) => (rule.type === "pull_request" ? { ...rule, parameters } : rule))

describe("checkGithubRules", () => {
  it("is silent when the live rules match the file and auto-merge is on", () => {
    expect(check(live({}))).toEqual([])
  })

  it("flags a rule the default branch no longer has", () => {
    const state = live({ rules: fileRules.filter((rule) => rule.type !== "non_fast_forward") })
    expect(problems(state)).toEqual([
      'the default branch has no active "non_fast_forward" rule on GitHub',
    ])
  })

  it("flags every expected rule on an unprotected branch", () => {
    expect(check(live({ rules: [] }))).toHaveLength(fileRules.length)
  })

  it("flags a CI job that is not a required status check", () => {
    const stripped = fileRules.map((rule) =>
      rule.type === "required_status_checks"
        ? {
            ...rule,
            parameters: { ...rule.parameters, required_status_checks: [{ context: "check" }] },
          }
        : rule,
    )
    const found = problems(live({ rules: stripped }))
    expect(found).toContain('CI job "smoke" is not a required status check on the default branch')
    expect(found).toHaveLength(5)
  })

  it("flags a review requirement below the file's, and accepts a stricter one", () => {
    // The shipped file asks for none, so this pins the comparison with a file that asks for one.
    const strict = {
      ...(expected as Record<string, unknown>),
      rules: withPullRequest({ required_approving_review_count: 1 }),
    }
    const reviews = (count: number) =>
      checkGithubRules({
        expected: strict,
        state: live({ rules: withPullRequest({ required_approving_review_count: count }) }),
      }).map((finding) => finding.problem)
    expect(reviews(0)).toEqual([
      "pull requests merge with 0 approving reviews, but the harness requires 1",
    ])
    expect(reviews(2)).toEqual([])
  })

  it("accepts a repo that still requires a review from an older harness", () => {
    expect(check(live({ rules: withPullRequest({ required_approving_review_count: 1 }) }))).toEqual(
      [],
    )
  })

  it("flags auto-merge off", () => {
    const found = check(live({ autoMerge: false }))
    expect(found).toHaveLength(1)
    expect(found[0]?.problem).toContain("auto-merge is off")
  })

  it("reports nothing it could not read", () => {
    expect(check({ kind: "unavailable", reason: "no GitHub remote" })).toEqual([])
  })

  it("flags a harness with no readable rules file, even offline", () => {
    const findings = checkGithubRules({
      expected: null,
      state: { kind: "unavailable", reason: "gh is not installed" },
    })
    expect(findings.map((finding) => finding.rule)).toEqual(["github"])
  })
})

describe("githubNotice", () => {
  it("names what it could not verify and why", () => {
    expect(githubNotice({ kind: "unavailable", reason: "gh is not authenticated" })).toBe(
      "– [github] branch protection not verified: gh is not authenticated",
    )
    expect(githubNotice(live({}))).toBeUndefined()
  })
})

describe("branchLookupFailure", () => {
  const repo = "Pierre-Mike/small-tools"

  it("lets the check run when the default branch exists on GitHub", () => {
    expect(
      branchLookupFailure({ repo, branch: "main", lookup: { ok: true, reason: "" } }),
    ).toBeUndefined()
  })

  it("reports a repo whose default branch was never pushed, with the order to fix it", () => {
    // An empty repo still names `main` as its default branch, and GET rules/branches/main answers
    // `200 []`, which would fail every rule before the first push could happen.
    const state = branchLookupFailure({
      repo,
      branch: "main",
      lookup: { ok: false, reason: "Branch not found (HTTP 404)" },
    })
    expect(state).toEqual({
      kind: "unavailable",
      reason:
        "main is not on Pierre-Mike/small-tools yet: push it, then run `bunx axioms rules --apply`",
    })
  })

  it("passes any other failure through as the reason", () => {
    expect(
      branchLookupFailure({ repo, branch: "main", lookup: { ok: false, reason: "HTTP 502" } }),
    ).toEqual({ kind: "unavailable", reason: "HTTP 502" })
  })
})

describe("autoMergeOff", () => {
  it("asks for a PATCH unless allow_auto_merge is already true", () => {
    expect(autoMergeOff({ allow_auto_merge: true })).toBe(false)
    expect(autoMergeOff({ allow_auto_merge: false })).toBe(true)
    expect(autoMergeOff(null)).toBe(true)
  })
})

describe("planRulesetApply", () => {
  const repo = "Pierre-Mike/factory"

  it("creates when no live ruleset has the file's name", () => {
    const plan = planRulesetApply({ expected, rulesets: [{ id: 7, name: "other" }], repo })
    expect(plan).toEqual({
      ok: true,
      call: {
        method: "POST",
        path: "repos/Pierre-Mike/factory/rulesets",
        summary: 'create ruleset "axioms default branch protection"',
      },
    })
  })

  it("updates in place when the name matches, so reruns stay idempotent", () => {
    const rulesets = [{ id: 31, name: "axioms default branch protection" }]
    const plan = planRulesetApply({ expected, rulesets, repo })
    expect(plan).toEqual({
      ok: true,
      call: {
        method: "PUT",
        path: "repos/Pierre-Mike/factory/rulesets/31",
        summary: 'update ruleset "axioms default branch protection" (id 31)',
      },
    })
  })

  it("refuses a missing file or an unexpected listing instead of guessing", () => {
    expect(planRulesetApply({ expected: null, rulesets: [], repo }).ok).toBe(false)
    expect(planRulesetApply({ expected, rulesets: { message: "403" }, repo }).ok).toBe(false)
  })
})

describe("parseRulesArgs", () => {
  it("accepts only --apply", () => {
    expect(parseRulesArgs([])).toEqual({ ok: true, apply: false })
    expect(parseRulesArgs(["--apply"])).toEqual({ ok: true, apply: true })
    expect(parseRulesArgs(["--aply"]).ok).toBe(false)
  })
})

describe("the shipped ruleset", () => {
  it("requires exactly the template's ci.yml jobs as status checks", () => {
    const workflow = Bun.YAML.parse(
      readFileSync(join(import.meta.dir, "..", "template/.github/workflows/ci.yml"), "utf8"),
    ) as { jobs: Record<string, unknown> }
    const checksRule = fileRules.find((rule) => rule.type === "required_status_checks")
    const required = checksRule?.parameters?.required_status_checks as Array<{ context: string }>
    expect(required.map((entry) => entry.context).sort()).toEqual(Object.keys(workflow.jobs).sort())
  })

  it("keeps the branch linear and immovable: no force pushes, no deletion, PRs only", () => {
    const types = fileRules.map((rule) => rule.type)
    for (const type of [
      "deletion",
      "non_fast_forward",
      "required_linear_history",
      "pull_request",
    ]) {
      expect(types).toContain(type)
    }
  })

  it("lets a solo owner merge: a PR is required, an approval is not", () => {
    // GitHub never counts the author's own approval, and agents open PRs under the owner's login.
    const pullRequest = fileRules.find((rule) => rule.type === "pull_request")
    expect(pullRequest?.parameters?.required_approving_review_count).toBe(0)
  })
})
