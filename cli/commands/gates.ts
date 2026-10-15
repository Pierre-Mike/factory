/**
 * Gate runner shared by `axioms check` and `axioms smoke`: runs named gates in order and times
 * each one. With `collect` on (`--json` / `--report`), everything a gate writes becomes evidence:
 * its `console.error` lines are teed into the collector, and child processes go through the `sink`
 * of `run`/`runTool`, which pipes their output to stderr and the collector. stdout stays untouched,
 * so the one JSON document printed there is the whole machine-readable result. A gate that throws
 * is recorded as failed, with the error as evidence, so the report survives a crashing tool.
 */
import type { GateOutcome } from "../report.core"
import type { Sink } from "../shell"

/**
 * A gate passes (`true`), fails (`false`), or skips itself with a reason, such as check's
 * typecheck in a repo with no tsconfig.json. A skip passes: the runner prints the reason and keeps
 * it on the outcome, so the evidence report says which gates did not run and why.
 */
export type GateVerdict = boolean | { readonly skipped: string }

export type Gate = readonly [string, (sink: Sink | undefined) => Promise<GateVerdict>]

export interface GateRun {
  readonly ok: boolean
  readonly gates: ReadonlyArray<GateOutcome>
}

/** Tee `console.error` into the sink until the returned restore function runs. */
const teeConsole = (sink: Sink): (() => void) => {
  const original = console.error
  console.error = (...args: unknown[]) => {
    sink(`${args.map((arg) => String(arg)).join(" ")}\n`)
    original(...args)
  }
  return () => {
    console.error = original
  }
}

export const runGates = async (input: {
  readonly gates: ReadonlyArray<Gate>
  readonly collect: boolean
  readonly stopOnFailure: boolean
}): Promise<GateRun> => {
  const outcomes: GateOutcome[] = []
  for (const [name, gate] of input.gates) {
    console.error(`\n── ${name} ──`)
    const chunks: string[] = []
    const sink: Sink | undefined = input.collect
      ? (text) => {
          chunks.push(text)
        }
      : undefined
    const restore = sink === undefined ? undefined : teeConsole(sink)
    const started = performance.now()
    let ok: boolean
    let skipped: string | undefined
    try {
      const verdict = await gate(sink)
      if (typeof verdict === "boolean") ok = verdict
      else {
        console.error(`– ${name} skipped: ${verdict.skipped}`)
        ok = true
        skipped = verdict.skipped
      }
    } catch (error) {
      console.error(`✖ ${name} crashed: ${String(error)}`)
      ok = false
    } finally {
      restore?.()
    }
    const durationMs = performance.now() - started
    outcomes.push({ name, ok, durationMs, output: chunks.join(""), skipped })
    if (!ok && input.stopOnFailure) break
  }
  return { ok: outcomes.every((outcome) => outcome.ok), gates: outcomes }
}

export const failedNames = (run: GateRun): string =>
  run.gates
    .filter((gate) => !gate.ok)
    .map((gate) => gate.name)
    .join(", ")

export const skippedNames = (run: GateRun): string =>
  run.gates
    .filter((gate) => gate.skipped !== undefined)
    .map((gate) => gate.name)
    .join(", ")
