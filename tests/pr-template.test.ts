/**
 * The shipped PR templates and the pr-body gate agree: both the factory's own template and the one
 * projects receive declare exactly the contract sections, and an unedited template submitted as a
 * body fails every one of them, so hint comments can never pass for content.
 */
import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { sectionProblems, templateHeadings } from "../cli/pr-body.core"
import { PKG_ROOT, readText } from "../cli/shell"

const SECTIONS = ["What changed", "Why", "Verification", "Owning Agent Note"]

describe("PULL_REQUEST_TEMPLATE.md", () => {
  for (const path of [
    ".github/PULL_REQUEST_TEMPLATE.md",
    "template/.github/PULL_REQUEST_TEMPLATE.md",
  ]) {
    it(`${path} declares exactly the contract sections`, () => {
      expect(templateHeadings(readText(join(PKG_ROOT, path)) ?? "")).toEqual(SECTIONS)
    })

    it(`${path}, submitted unedited, fails every section`, () => {
      const template = readText(join(PKG_ROOT, path)) ?? ""
      expect(sectionProblems({ body: template, required: templateHeadings(template) })).toEqual(
        SECTIONS.map((heading) => ({ heading, problem: "empty" })),
      )
    })
  }
})
