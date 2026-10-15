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

export type Gate = readonly [string, (sink: Sink | undefined) => Promise<boolean>]

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
    try {
      ok = await gate(sink)
    } catch (error) {
      console.error(`✖ ${name} crashed: ${String(error)}`)
      ok = false
    } finally {
      restore?.()
    }
    outcomes.push({ name, ok, durationMs: performance.now() - started, output: chunks.join("") })
    if (!ok && input.stopOnFailure) break
  }
  return { ok: outcomes.every((outcome) => outcome.ok), gates: outcomes }
}

export const failedNames = (run: GateRun): string =>
  run.gates
    .filter((gate) => !gate.ok)
    .map((gate) => gate.name)
    .join(", ")
