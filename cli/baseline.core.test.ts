import { describe, expect, test } from "bun:test"
import {
  type Counts,
  compareCounts,
  parseBaseline,
  parseCount,
  renderBaseline,
} from "./baseline.core"

const BASE: Counts = { lint: 100, tests: 200, notes: 9 }

describe("parseCount", () => {
  test("reads what Biome, bun test and the notes gate print", () => {
    expect(
      parseCount({ gate: "lint", output: "Checked 112 files in 40ms. No fixes applied." }),
    ).toBe(112)
    expect(parseCount({ gate: "lint", output: "Checked 1 file in 2ms." })).toBe(1)
    expect(parseCount({ gate: "tests", output: "bun test v1.3.6\n\n 241 pass\n 0 fail\n" })).toBe(
      241,
    )
    expect(
      parseCount({
        gate: "notes",
        output: "✓ notes: 9 Agent Note(s) in 1 tree(s) follow the rules",
      }),
    ).toBe(9)
  })

  test("strips color codes before matching", () => {
    expect(parseCount({ gate: "tests", output: "\u001b[32m 7 pass\u001b[0m\n" })).toBe(7)
  })

  test("does not mistake a failure line or a different sentence for a count", () => {
    expect(
      parseCount({ gate: "tests", output: " 0 fail\nRan 5 tests across 2 files" }),
    ).toBeUndefined()
    expect(
      parseCount({
        gate: "lint",
        output: "Biome exited because the configuration resulted in errors",
      }),
    ).toBeUndefined()
  })
})

describe("compareCounts", () => {
  test("equal totals are clean", () => {
    expect(compareCounts({ baseline: BASE, actual: BASE })).toEqual({ dropped: [], raised: [] })
  })

  test("a check that disappears is reported as dropped", () => {
    const { dropped, raised } = compareCounts({ baseline: BASE, actual: { ...BASE, tests: 199 } })
    expect(dropped).toEqual(["tests: 199 reported, baseline 200"])
    expect(raised).toEqual([])
  })

  test("new checks are reported as raised, not as a failure", () => {
    const { dropped, raised } = compareCounts({ baseline: BASE, actual: { ...BASE, notes: 10 } })
    expect(dropped).toEqual([])
    expect(raised).toEqual(["notes: 10 reported, baseline 9"])
  })
})

describe("baseline file", () => {
  test("round-trips", () => {
    expect(parseBaseline(renderBaseline(BASE))).toEqual({ ok: true, counts: BASE })
  })

  test("rejects bad JSON, a missing gate and a negative or fractional count", () => {
    expect(parseBaseline("{").ok).toBe(false)
    expect(parseBaseline("[]").ok).toBe(false)
    expect(parseBaseline('{"lint":1,"tests":2}').ok).toBe(false)
    expect(parseBaseline('{"lint":-1,"tests":2,"notes":3}').ok).toBe(false)
    expect(parseBaseline('{"lint":1.5,"tests":2,"notes":3}').ok).toBe(false)
  })
})
