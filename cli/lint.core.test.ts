import { describe, expect, it } from "bun:test"
import * as fc from "fast-check"
import {
  biomeColorArgs,
  classifyLint,
  type LintDiagnostic,
  MAX_LISTED_FILES,
  parseBiomeJson,
  writeFixableReport,
} from "./lint.core"

const diag = (over: Pick<LintDiagnostic, "category" | "path">): LintDiagnostic => ({
  severity: "error",
  ...over,
})

/** The document `biome ci --reporter=json` prints, holding these diagnostics. */
const report = (input: {
  readonly diagnostics: ReadonlyArray<LintDiagnostic>
  readonly notPrinted?: number
}): string =>
  JSON.stringify({
    summary: { errors: input.diagnostics.length, diagnosticsNotPrinted: input.notPrinted ?? 0 },
    diagnostics: input.diagnostics.map(({ category, path, severity }) => ({
      severity,
      message: "File content differs from formatting output",
      category,
      location: { path, start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      advices: [],
    })),
    command: "ci",
  })

describe("parseBiomeJson", () => {
  it("reads category, path and severity from Biome's json reporter", () => {
    expect(
      parseBiomeJson(
        report({
          diagnostics: [
            diag({ category: "format", path: "src/a.ts" }),
            { category: "lint/style/useConst", path: "src/b.ts", severity: "warning" },
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [
        { category: "format", path: "src/a.ts", severity: "error" },
        { category: "lint/style/useConst", path: "src/b.ts", severity: "warning" },
      ],
      notPrinted: 0,
    })
  })

  it("skips text Biome prints before the document", () => {
    const text = `The --json option is unstable/experimental.\n${report({ diagnostics: [diag({ category: "format", path: "a.ts" })] })}\n`
    expect(parseBiomeJson(text)?.diagnostics).toEqual([
      { category: "format", path: "a.ts", severity: "error" },
    ])
  })

  it("returns null for anything that is not a Biome report", () => {
    for (const text of ["", "not json", "{", '{"summary":{}}', '{"diagnostics":[{"x":1}]}']) {
      expect(parseBiomeJson(text)).toBeNull()
    }
  })

  it("counts diagnostics Biome left out of the report", () => {
    expect(parseBiomeJson(report({ diagnostics: [], notPrinted: 3 }))?.notPrinted).toBe(3)
  })
})

describe("classifyLint", () => {
  it("passes a clean report", () => {
    expect(classifyLint({ diagnostics: [], notPrinted: 0 })).toEqual({
      fixable: [],
      othersFound: false,
    })
  })

  it("lists each file --write can fix once, sorted, when that is all that is wrong", () => {
    expect(
      classifyLint({
        diagnostics: [
          diag({ category: "format", path: "src/b.ts" }),
          diag({ category: "assist/source/organizeImports", path: "src/a.ts" }),
          diag({ category: "format", path: "src/a.ts" }),
        ],
        notPrinted: 0,
      }),
    ).toEqual({ fixable: ["src/a.ts", "src/b.ts"], othersFound: false })
  })

  it("flags lint rule diagnostics next to the fixable files", () => {
    expect(
      classifyLint({
        diagnostics: [
          diag({ category: "format", path: "a.ts" }),
          diag({ category: "lint/style/useConst", path: "b.ts" }),
        ],
        notPrinted: 0,
      }),
    ).toEqual({ fixable: ["a.ts"], othersFound: true })
  })

  it("does not call a report formatting-only when Biome left diagnostics out", () => {
    expect(
      classifyLint({ diagnostics: [diag({ category: "format", path: "a.ts" })], notPrinted: 1 })
        .othersFound,
    ).toBe(true)
  })
})

describe("writeFixableReport", () => {
  it("names the files and the fix command", () => {
    expect(writeFixableReport({ files: ["src/a.ts"], othersFound: false })).toEqual([
      "✖ 1 file needs formatting, which `bun run lint` fixes:",
      "  src/a.ts",
      "  run `bun run lint` to fix",
    ])
  })

  it("says the other findings follow when there are some", () => {
    const lines = writeFixableReport({ files: ["a.ts", "b.ts"], othersFound: true })
    expect(lines[0]).toBe("✖ 2 files need formatting, which `bun run lint` fixes:")
    expect(lines.at(-1)).toBe("  run `bun run lint` to fix them; the other findings follow")
  })

  it("stays short however many files need formatting", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 500 }), (files) => {
        const lines = writeFixableReport({ files, othersFound: false })
        expect(lines.length).toBeLessThanOrEqual(MAX_LISTED_FILES + 3)
        if (files.length > MAX_LISTED_FILES) {
          expect(lines).toContain(`  … and ${files.length - MAX_LISTED_FILES} more`)
        }
      }),
    )
  })
})

describe("biomeColorArgs", () => {
  it("turns colors off unless both output streams are a terminal", () => {
    expect(biomeColorArgs({ stdoutTTY: true, stderrTTY: true })).toEqual([])
    expect(biomeColorArgs({ stdoutTTY: false, stderrTTY: true })).toEqual(["--colors=off"])
    expect(biomeColorArgs({ stdoutTTY: true, stderrTTY: false })).toEqual(["--colors=off"])
  })
})
