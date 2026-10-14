import { describe, expect, it } from "bun:test"
import * as fc from "fast-check"
import { CANON_END, CANON_START, extractCanon, writeCanon } from "./canon.core"

describe("writeCanon", () => {
  it("appends a block to a file without markers", () => {
    const out = writeCanon({ agentsMd: "# My app\n", canon: "rules" })
    expect(out).toBe(`# My app\n\n${CANON_START}\nrules\n${CANON_END}\n`)
  })

  it("replaces the block and keeps project text around it", () => {
    const before = `# App\n\n${CANON_START}\nold\n${CANON_END}\n\n## Project notes\n`
    const out = writeCanon({ agentsMd: before, canon: "new" })
    expect(out).toBe(`# App\n\n${CANON_START}\nnew\n${CANON_END}\n\n## Project notes\n`)
  })

  it("round-trips: what is written is what is extracted", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (head, canon) => {
        fc.pre(!head.includes(CANON_START) && !head.includes(CANON_END))
        fc.pre(!canon.includes(CANON_START) && !canon.includes(CANON_END))
        expect(extractCanon(writeCanon({ agentsMd: head, canon }))).toBe(canon.trim())
      }),
    )
  })
})

describe("extractCanon", () => {
  it("returns undefined without markers", () => {
    expect(extractCanon("# nothing here")).toBeUndefined()
  })
})
