/**
 * PR-body gate, pure. A pull request's body is the author's contract: every `##` section of
 * .github/PULL_REQUEST_TEMPLATE.md, present and filled. The shell (commands/pr-body.ts) finds the
 * body and the template; this module judges. A heading whose section holds only whitespace or
 * template hint comments is as broken as a missing one: both mean the contract was never written.
 */
import { isRecord } from "./doctor.core"

export interface SectionProblem {
  readonly heading: string
  readonly problem: "missing" | "empty"
}

const HEADING = /^##\s+(.+?)\s*$/

/** GitHub payloads carry CRLF, and a hint comment left in place is not content. */
const normalize = (text: string): string =>
  text.replaceAll("\r", "").replace(/<!--[\s\S]*?-->/g, "")

const headingOf = (line: string): string | undefined => line.match(HEADING)?.[1]

/** The `## ` headings of a PR template: the sections every body must fill. */
export const templateHeadings = (template: string): string[] =>
  normalize(template)
    .split("\n")
    .flatMap((line) => {
      const heading = headingOf(line)
      return heading === undefined ? [] : [heading]
    })

/** Which required sections the body misses or leaves empty, in the template's order. */
export const sectionProblems = (input: {
  readonly body: string
  readonly required: ReadonlyArray<string>
}): SectionProblem[] => {
  const sections = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of normalize(input.body).split("\n")) {
    const heading = headingOf(line)
    if (heading !== undefined) {
      current = sections.get(heading) ?? []
      sections.set(heading, current)
    } else current?.push(line)
  }
  return input.required.flatMap((heading): SectionProblem[] => {
    const content = sections.get(heading)
    if (content === undefined) return [{ heading, problem: "missing" }]
    return content.join("\n").trim() === "" ? [{ heading, problem: "empty" }] : []
  })
}

/**
 * The body out of a pull_request event payload. `null` when the payload is not a pull_request
 * event; a PR opened with no description has `body: null`, which comes back as "".
 */
export const eventPullRequestBody = (event: unknown): string | null => {
  if (!isRecord(event) || !isRecord(event.pull_request)) return null
  const body = event.pull_request.body
  return typeof body === "string" ? body : ""
}
