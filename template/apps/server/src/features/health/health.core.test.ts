import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import * as fc from "fast-check"
import { buildStatus, parseVerbose } from "./health.core"

describe("buildStatus", () => {
  it("reports ok with the version and computed uptime", () => {
    const status = buildStatus({ version: "1.2.3", startedAt: 1_000, now: 4_000 })
    expect(status).toEqual({ ok: true, version: "1.2.3", uptimeMs: 3_000 })
  })

  it("never returns negative uptime when the clock skews backwards", () => {
    const status = buildStatus({ version: "0.0.0", startedAt: 5_000, now: 1_000 })
    expect(status.uptimeMs).toBe(0)
  })
})

describe("parseVerbose", () => {
  it("defaults to false when the flag is absent", () => {
    expect(parseVerbose(undefined)).toEqual(Either.right(false))
    expect(parseVerbose("")).toEqual(Either.right(false))
  })

  it("parses truthy and falsy spellings", () => {
    expect(parseVerbose("true")).toEqual(Either.right(true))
    expect(parseVerbose("1")).toEqual(Either.right(true))
    expect(parseVerbose("false")).toEqual(Either.right(false))
    expect(parseVerbose("0")).toEqual(Either.right(false))
  })

  it("returns a tagged Left for anything else (error-as-value, no throw)", () => {
    const result = parseVerbose("maybe")
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toEqual({ _tag: "InvalidVerboseFlag", received: "maybe" })
    }
  })
})

// Property-based coverage (fast-check): pure data-in/data-out cores are ideal
// property targets — no mocks, thousands of generated cases per run.
describe("core properties", () => {
  it("buildStatus: uptime is never negative, ok is always true", () => {
    fc.assert(
      fc.property(
        fc.record({ version: fc.string(), startedAt: fc.integer(), now: fc.integer() }),
        (input) => {
          const status = buildStatus(input)
          expect(status.uptimeMs).toBeGreaterThanOrEqual(0)
          expect(status.ok).toBe(true)
          expect(status.version).toBe(input.version)
        },
      ),
    )
  })

  it("parseVerbose is total: any string yields an Either, never a throw", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const result = parseVerbose(raw)
        expect(Either.isEither(result)).toBe(true)
      }),
    )
  })
})
