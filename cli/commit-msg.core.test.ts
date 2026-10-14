import { describe, expect, it } from "bun:test"
import { commitSubjectProblem, MAX_SUBJECT_LENGTH } from "./commit-msg.core"

describe("commitSubjectProblem", () => {
  it("accepts type(scope): subject", () => {
    expect(commitSubjectProblem("feat(items): add status transitions")).toBeUndefined()
    expect(commitSubjectProblem("fix: handle null body\n\nlonger body")).toBeUndefined()
    expect(commitSubjectProblem("feat!: drop the bun runtime")).toBeUndefined()
    expect(commitSubjectProblem("fix: tolerate a CRLF line ending\r\n")).toBeUndefined()
  })

  it("accepts merge and initial commits", () => {
    expect(commitSubjectProblem("Merge branch 'main'")).toBeUndefined()
    expect(commitSubjectProblem("Initial commit")).toBeUndefined()
  })

  it("rejects free-form subjects", () => {
    expect(commitSubjectProblem("on push while testing")).toContain("not a conventional commit")
    expect(commitSubjectProblem("feat: ")).toContain("not a conventional commit")
  })

  it("counts the whole first line, type and scope included, against the limit", () => {
    const subject = (length: number) => {
      const prefix = "feat(items): "
      return `${prefix}${"x".repeat(length - prefix.length)}`
    }
    expect(commitSubjectProblem(subject(MAX_SUBJECT_LENGTH))).toBeUndefined()
    expect(commitSubjectProblem(subject(MAX_SUBJECT_LENGTH + 1))).toBe(
      `the subject line is ${MAX_SUBJECT_LENGTH + 1} characters; the limit is ${MAX_SUBJECT_LENGTH}. Move detail into the body.`,
    )
  })
})
