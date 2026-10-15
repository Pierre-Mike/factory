import { describe, expect, it } from "bun:test"
import * as fc from "fast-check"
import {
  buildReport,
  type GateOutcome,
  MAX_ERROR_LINES,
  parseReportArgs,
  renderReport,
} from "./report.core"

describe("parseReportArgs", () => {
  it("defaults to the human output", () => {
    expect(parseReportArgs([])).toEqual({ ok: true, json: false, report: undefined })
  })

  it("accepts --json, --report <path>, and both in any order", () => {
    expect(parseReportArgs(["--json"])).toEqual({ ok: true, json: true, report: undefined })
    expect(parseReportArgs(["--report", "out.json"])).toEqual({
      ok: true,
      json: false,
      report: "out.json",
    })
    expect(parseReportArgs(["--report", "out.json", "--json"])).toEqual({
      ok: true,
      json: true,
      report: "out.json",
    })
  })

  it("refuses unknown arguments and a missing report path", () => {
    for (const args of [["--help"], ["extra"], ["--jsonl"], ["--report"], ["--report", "--json"]]) {
      expect(parseReportArgs(args).ok).toBe(false)
    }
  })
})

const gate = (over: Partial<GateOutcome>): GateOutcome => ({
  name: "lint",
  ok: true,
  durationMs: 12.4,
  output: "",
  ...over,
})

describe("buildReport", () => {
  it("reports a passing run with rounded durations and no error evidence", () => {
    const report = buildReport({
      command: "check",
      gates: [gate({ name: "lint" }), gate({ name: "test", durationMs: 100.6 })],
    })
    expect(report).toEqual({
      command: "check",
      pass: true,
      passed: 2,
      failed: 0,
      durationMs: 113,
      gates: [
        { name: "lint", pass: true, durationMs: 12 },
        { name: "test", pass: true, durationMs: 101 },
      ],
    })
  })

  it("keeps the first lines of a failing gate, strips ANSI, and counts what it drops", () => {
    const noise = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")
    const output = `\n\u001b[31merror one\u001b[0m\n${noise}\n\n`
    const report = buildReport({ command: "check", gates: [gate({ ok: false, output })] })
    const failed = report.gates[0]
    expect(report.pass).toBe(false)
    expect(report.failed).toBe(1)
    expect(failed?.errors?.[0]).toBe("error one")
    expect(failed?.errors).toHaveLength(MAX_ERROR_LINES)
    expect(failed?.omittedLines).toBe(11)
  })

  it("caps a pathological line instead of inflating the document", () => {
    const report = buildReport({
      command: "check",
      gates: [gate({ ok: false, output: "x".repeat(1000) })],
    })
    expect(report.gates[0]?.errors?.[0]).toBe(`${"x".repeat(400)}…`)
    expect(report.gates[0]?.omittedLines).toBeUndefined()
  })

  it("is vacuously green for an empty run", () => {
    expect(buildReport({ command: "smoke", gates: [] })).toEqual({
      command: "smoke",
      pass: true,
      passed: 0,
      failed: 0,
      durationMs: 0,
      gates: [],
    })
  })
})

describe("renderReport", () => {
  it("prints one parseable JSON document ending in a newline", () => {
    const report = buildReport({ command: "check", gates: [gate({})] })
    const text = renderReport(report)
    expect(text.endsWith("\n")).toBe(true)
    expect(JSON.parse(text)).toEqual(report)
  })

  it("stays within the truncation limits and round-trips, whatever a gate wrote", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 600 }), { maxLength: 60 }), (lines) => {
        const report = buildReport({
          command: "check",
          gates: [gate({ ok: false, output: lines.join("\n") })],
        })
        const errors = report.gates[0]?.errors ?? []
        expect(errors.length).toBeLessThanOrEqual(MAX_ERROR_LINES)
        for (const line of errors) expect(line.length).toBeLessThanOrEqual(401)
        expect(JSON.parse(renderReport(report))).toEqual(report)
      }),
    )
  })
})
