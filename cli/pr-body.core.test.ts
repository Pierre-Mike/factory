import { describe, expect, it } from "bun:test"
import { eventPullRequestBody, sectionProblems, templateHeadings } from "./pr-body.core"

const REQUIRED = ["What changed", "Why", "Verification", "Owning Agent Note"]

const body = (sections: Record<string, string>) =>
  Object.entries(sections)
    .map(([heading, content]) => `## ${heading}\n\n${content}\n`)
    .join("\n")

describe("templateHeadings", () => {
  it("reads the ## headings out of a template, in order", () => {
    const template = "intro\n\n## What changed\n\nhint\n\n## Why\n"
    expect(templateHeadings(template)).toEqual(["What changed", "Why"])
  })

  it("ignores deeper headings and commented-out ones", () => {
    expect(templateHeadings("## Keep\n### Not a section\n<!-- ## Gone -->\n")).toEqual(["Keep"])
  })
})

describe("sectionProblems", () => {
  it("accepts a body with every section filled", () => {
    expect(
      sectionProblems({
        body: body({
          "What changed": "A pr-body gate.",
          Why: "Empty contracts passed review.",
          Verification: "`bun run verify`, green.",
          "Owning Agent Note":
            ".agents/notes/implemented/process/2026-10-15-pr-template-and-body-gate.md",
        }),
        required: REQUIRED,
      }),
    ).toEqual([])
  })

  it("flags a section that is present but empty", () => {
    expect(
      sectionProblems({
        body: "## Why\n\nBecause.\n\n## Verification\n\n## What changed\n\nx\n",
        required: ["What changed", "Why", "Verification"],
      }),
    ).toEqual([{ heading: "Verification", problem: "empty" }])
  })

  it("flags each missing section, in the template's order", () => {
    expect(sectionProblems({ body: "## Why\n\nBecause.\n", required: REQUIRED })).toEqual([
      { heading: "What changed", problem: "missing" },
      { heading: "Verification", problem: "missing" },
      { heading: "Owning Agent Note", problem: "missing" },
    ])
  })

  it("flags everything on an empty body, as a descriptionless PR sends", () => {
    expect(sectionProblems({ body: "", required: ["Why"] })).toEqual([
      { heading: "Why", problem: "missing" },
    ])
  })

  it("does not count a template hint comment as content", () => {
    const template = "## Why\n\n<!-- The problem or decision behind it. -->\n"
    expect(sectionProblems({ body: template, required: templateHeadings(template) })).toEqual([
      { heading: "Why", problem: "empty" },
    ])
  })

  it("accepts CRLF bodies and trailing spaces on headings, as the GitHub payload sends", () => {
    expect(sectionProblems({ body: "## Why  \r\n\r\nBecause.\r\n", required: ["Why"] })).toEqual([])
  })

  it("treats a deeper heading as content, not as a section boundary", () => {
    expect(sectionProblems({ body: "## Why\n\n### Details\n", required: ["Why"] })).toEqual([])
  })
})

describe("eventPullRequestBody", () => {
  it("returns the body, and turns a descriptionless PR's null body into an empty one", () => {
    expect(eventPullRequestBody({ pull_request: { body: "## Why\n" } })).toBe("## Why\n")
    expect(eventPullRequestBody({ pull_request: { body: null } })).toBe("")
  })

  it("returns null when the payload is not a pull_request event", () => {
    expect(eventPullRequestBody({ pusher: {} })).toBeNull()
    expect(eventPullRequestBody(null)).toBeNull()
    expect(eventPullRequestBody("push")).toBeNull()
  })
})
