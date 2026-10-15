/**
 * `axioms pr-body [file|-]`: fail a pull request whose body skips the contract. The body comes
 * from the named file, from stdin (`-`), or, with no argument, from the pull_request event payload
 * GitHub provides; the required sections come from the project's .github/PULL_REQUEST_TEMPLATE.md.
 * A run for any other event (a push, a CI dry-run replay) has no pull request to check, so the
 * gate passes and says why: the decision lives here because a step-level `if:` would make the gate
 * skippable for `axioms doctor` and unsimulatable for `axioms ci-dry-run`.
 */
import { join } from "node:path"
import { eventPullRequestBody, sectionProblems, templateHeadings } from "../pr-body.core"
import { readJson, readText } from "../shell"

export const PR_TEMPLATE_PATH = ".github/PULL_REQUEST_TEMPLATE.md"

type Source = { readonly body: string } | { readonly skip: string } | { readonly error: string }

const fromEvent = (): Source => {
  const event = process.env.GITHUB_EVENT_NAME
  if (event !== "pull_request") {
    return { skip: `${event ?? "not a GitHub"} run, no pull request body to check` }
  }
  const body = eventPullRequestBody(readJson(process.env.GITHUB_EVENT_PATH ?? ""))
  return body === null
    ? { error: "GITHUB_EVENT_PATH does not hold a pull_request payload" }
    : { body }
}

const findBody = async (args: ReadonlyArray<string>): Promise<Source> => {
  const file = args[0]
  if (file === undefined) return fromEvent()
  if (file === "-") return { body: await Bun.stdin.text() }
  const text = readText(file)
  return text === null ? { error: `cannot read ${file}` } : { body: text }
}

export const prBody = async (input: {
  readonly root: string
  readonly args: ReadonlyArray<string>
}): Promise<boolean> => {
  const source = await findBody(input.args)
  if ("skip" in source) {
    console.error(`✓ pr-body: ${source.skip}`)
    return true
  }
  if ("error" in source) {
    console.error(`✖ pr-body: ${source.error}`)
    return false
  }
  const template = readText(join(input.root, PR_TEMPLATE_PATH))
  if (template === null) {
    console.error(
      `✖ pr-body: ${PR_TEMPLATE_PATH} is missing, so there is no contract to check against (copy it from the factory template)`,
    )
    return false
  }
  const problems = sectionProblems({ body: source.body, required: templateHeadings(template) })
  for (const { heading, problem } of problems) {
    console.error(`✖ pr-body: section "## ${heading}" is ${problem}`)
  }
  if (problems.length > 0) {
    console.error(
      `  the body is the author's contract: build it from ${PR_TEMPLATE_PATH} (gh pr create does not fill templates)`,
    )
    return false
  }
  console.error(`✓ pr-body: every section of ${PR_TEMPLATE_PATH} is filled`)
  return true
}
