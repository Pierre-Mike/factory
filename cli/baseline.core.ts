/**
 * Gate baseline, pure. CI counts what each gate reports (files Biome checked, tests that passed,
 * Agent Notes that follow the rules) and compares the totals to `gate-baseline.json`. A total below
 * the baseline means checks quietly disappeared (a deleted test, a narrowed lint scope, a dropped
 * note tree), so the run fails. A total above it passes and says to raise the baseline.
 */

export const BASELINE_FILE = "gate-baseline.json"
export const BASELINE_USAGE = "usage: axioms baseline [--update]"

export const COUNTED = ["lint", "tests", "notes"] as const
export type Counted = (typeof COUNTED)[number]
export type Counts = Readonly<Record<Counted, number>>

/** What each gate's output says, as a pattern with the count in group 1. */
const PATTERNS: Readonly<Record<Counted, RegExp>> = {
  lint: /Checked (\d+) files? in/,
  tests: /^\s*(\d+) pass\s*$/m,
  notes: /notes: (\d+) Agent Note\(s\)/,
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/** The count a gate reported, or undefined when its output has no such line. */
export const parseCount = (input: {
  readonly gate: Counted
  readonly output: string
}): number | undefined => {
  const match = PATTERNS[input.gate].exec(input.output.replace(ANSI, ""))
  return match?.[1] === undefined ? undefined : Number(match[1])
}

export const parseBaseline = (
  text: string,
):
  | { readonly ok: true; readonly counts: Counts }
  | { readonly ok: false; readonly error: string } => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: `${BASELINE_FILE} is not valid JSON` }
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: `${BASELINE_FILE} must be a JSON object` }
  }
  const record = value as Record<string, unknown>
  const counts: Partial<Record<Counted, number>> = {}
  for (const gate of COUNTED) {
    const count = record[gate]
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return { ok: false, error: `${BASELINE_FILE}: "${gate}" must be a whole number, 0 or more` }
    }
    counts[gate] = count
  }
  return { ok: true, counts: counts as Counts }
}

export const renderBaseline = (counts: Counts): string =>
  `${JSON.stringify({ lint: counts.lint, tests: counts.tests, notes: counts.notes }, null, 2)}\n`

export interface Comparison {
  /** Gates whose total fell below the baseline: the run fails. */
  readonly dropped: ReadonlyArray<string>
  /** Gates whose total rose above the baseline: the run passes with a hint. */
  readonly raised: ReadonlyArray<string>
}

export const compareCounts = (input: {
  readonly baseline: Counts
  readonly actual: Counts
}): Comparison => {
  const line = (gate: Counted) =>
    `${gate}: ${input.actual[gate]} reported, baseline ${input.baseline[gate]}`
  return {
    dropped: COUNTED.filter((gate) => input.actual[gate] < input.baseline[gate]).map(line),
    raised: COUNTED.filter((gate) => input.actual[gate] > input.baseline[gate]).map(line),
  }
}
