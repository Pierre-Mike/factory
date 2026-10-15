/**
 * Evidence reports, pure. `axioms check --json` and `axioms smoke --json` print one JSON document
 * on stdout: per gate its name, verdict, duration and, on failure, the first lines it wrote, plus
 * the overall verdict and counts. A program parses harness-written evidence instead of scraping
 * logs or trusting a worker's account of its own run. The exit code still fails the command.
 */

export const REPORT_USAGE = "usage: axioms <check|smoke> [--json] [--report <path>]"

export interface ReportFlags {
  readonly ok: true
  /** Print the JSON document on stdout. */
  readonly json: boolean
  /** Also write the same document to this file. */
  readonly report: string | undefined
}

/** Only `--json` and `--report <path>` are accepted; anything else is refused, as in deploy. */
export const parseReportArgs = (
  args: ReadonlyArray<string>,
): ReportFlags | { readonly ok: false; readonly error: string } => {
  let json = false
  let report: string | undefined
  const queue = [...args]
  for (let arg = queue.shift(); arg !== undefined; arg = queue.shift()) {
    if (arg === "--json") {
      json = true
    } else if (arg === "--report") {
      report = queue.shift()
      if (report === undefined || report.startsWith("--")) {
        return { ok: false, error: `--report needs a file path\n${REPORT_USAGE}` }
      }
    } else {
      return { ok: false, error: `unexpected argument ${arg}\n${REPORT_USAGE}` }
    }
  }
  return { ok: true, json, report }
}

/** What the harness observed about one gate: the verdict, the clock, and everything it wrote. */
export interface GateOutcome {
  readonly name: string
  readonly ok: boolean
  readonly durationMs: number
  readonly output: string
}

export interface GateEvidence {
  readonly name: string
  readonly pass: boolean
  readonly durationMs: number
  /** Only on failure: the first lines the gate wrote, ANSI escapes stripped, lines capped. */
  readonly errors?: ReadonlyArray<string>
  /** Only when truncation dropped output lines: how many. */
  readonly omittedLines?: number
}

/** One document, summary first: a consumer calls `JSON.parse` once on the whole stdout. */
export interface Report {
  readonly command: string
  readonly pass: boolean
  readonly passed: number
  readonly failed: number
  readonly durationMs: number
  readonly gates: ReadonlyArray<GateEvidence>
}

export const MAX_ERROR_LINES = 20
const MAX_LINE_CHARS = 400
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g")

const errorLines = (output: string): { readonly lines: string[]; readonly omitted: number } => {
  const all = output
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.trimEnd())
  while (all.length > 0 && all[0] === "") all.shift()
  while (all.length > 0 && all[all.length - 1] === "") all.pop()
  const lines = all
    .slice(0, MAX_ERROR_LINES)
    .map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line))
  return { lines, omitted: all.length - lines.length }
}

const evidence = (outcome: GateOutcome): GateEvidence => {
  const base = {
    name: outcome.name,
    pass: outcome.ok,
    durationMs: Math.round(outcome.durationMs),
  }
  if (outcome.ok) return base
  const { lines, omitted } = errorLines(outcome.output)
  return omitted > 0
    ? { ...base, errors: lines, omittedLines: omitted }
    : { ...base, errors: lines }
}

export const buildReport = (input: {
  readonly command: string
  readonly gates: ReadonlyArray<GateOutcome>
}): Report => {
  const gates = input.gates.map(evidence)
  const failed = gates.filter((gate) => !gate.pass).length
  return {
    command: input.command,
    pass: failed === 0,
    passed: gates.length - failed,
    failed,
    durationMs: Math.round(input.gates.reduce((total, gate) => total + gate.durationMs, 0)),
    gates,
  }
}

/** Pretty-printed so a human can skim the same document `jq` and `JSON.parse` consume. */
export const renderReport = (report: Report): string => `${JSON.stringify(report, null, 2)}\n`
