import { describe, expect, it } from "bun:test"
import { isConventionalSubject } from "./commit-msg.core"

describe("isConventionalSubject", () => {
  it("accepts type(scope): subject", () => {
    expect(isConventionalSubject("feat(items): add status transitions")).toBe(true)
    expect(isConventionalSubject("fix: handle null body\n\nlonger body")).toBe(true)
    expect(isConventionalSubject("feat!: drop the bun runtime")).toBe(true)
  })

  it("accepts merge and initial commits", () => {
    expect(isConventionalSubject("Merge branch 'main'")).toBe(true)
    expect(isConventionalSubject("Initial commit")).toBe(true)
  })

  it("rejects free-form subjects", () => {
    expect(isConventionalSubject("on push while testing")).toBe(false)
    expect(isConventionalSubject("feat: ")).toBe(false)
    expect(isConventionalSubject(`feat: ${"x".repeat(73)}`)).toBe(false)
  })
})
