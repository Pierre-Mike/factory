/**
 * `axioms rules [--apply]`: branch protection from harness/github.rules.json. Without --apply it
 * prints the calls that would converge the repo; with --apply it creates or updates the ruleset
 * through `gh api` (matched by name, so reruns update in place) and turns repository auto-merge
 * on. `axioms doctor` is the gate that fails on drift; this is the tool that fixes it.
 */
import { join } from "node:path"
import { autoMergeOff, planRulesetApply, RULES_FILE } from "../rules.core"
import { PKG_ROOT, readJson } from "../shell"
import { gh, resolveRepo } from "./github"

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const rules = (input: { readonly root: string; readonly apply: boolean }): boolean => {
  const expected = readJson(join(PKG_ROOT, RULES_FILE))
  const resolved = resolveRepo(input.root)
  if (!resolved.ok) {
    console.error(`✖ rules: ${resolved.reason}`)
    return false
  }
  const list = gh({
    args: ["api", `repos/${resolved.repo}/rulesets?includes_parents=false&per_page=100`],
    cwd: input.root,
  })
  if (!list.ok) {
    console.error(`✖ rules: could not list rulesets on ${resolved.repo}: ${list.reason}`)
    return false
  }
  const plan = planRulesetApply({ expected, rulesets: parseJson(list.stdout), repo: resolved.repo })
  if (!plan.ok) {
    console.error(`✖ rules: ${plan.error}`)
    return false
  }
  const repoCall = gh({ args: ["api", `repos/${resolved.repo}`], cwd: input.root })
  if (!repoCall.ok) {
    console.error(`✖ rules: could not read ${resolved.repo}: ${repoCall.reason}`)
    return false
  }
  const enableAutoMerge = autoMergeOff(parseJson(repoCall.stdout))

  if (!input.apply) {
    console.error(`rules: would ${plan.call.summary} on ${resolved.repo} from ${RULES_FILE}`)
    console.error(
      enableAutoMerge
        ? "rules: would turn repository auto-merge on"
        : "rules: repository auto-merge is already on",
    )
    console.error("run `bunx axioms rules --apply` to make it so")
    return true
  }

  const applied = gh({
    args: ["api", "-X", plan.call.method, plan.call.path, "--input", "-"],
    cwd: input.root,
    stdin: JSON.stringify(expected),
  })
  console.error(
    applied.ok
      ? `✓ rules: ${plan.call.summary} on ${resolved.repo}`
      : `✖ rules: could not ${plan.call.summary}: ${applied.reason}`,
  )
  if (!enableAutoMerge) {
    console.error("✓ rules: repository auto-merge already on")
    return applied.ok
  }
  const merged = gh({
    args: ["api", "-X", "PATCH", `repos/${resolved.repo}`, "-F", "allow_auto_merge=true"],
    cwd: input.root,
  })
  console.error(
    merged.ok
      ? "✓ rules: repository auto-merge on"
      : `✖ rules: could not turn auto-merge on: ${merged.reason}`,
  )
  return applied.ok && merged.ok
}
