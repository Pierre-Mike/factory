/**
 * Functional core for the `health` slice — PURE.
 *
 * No Effect runtime, no Layer/Context, no I/O. Inputs come in as plain data,
 * results go out as plain data, and failures are values: this module models its
 * one fallible path (parsing an optional `?verbose=` query flag) as
 * `Result<A, HealthError>` rather than throwing. The imperative shell
 * (`health.io.ts` / `health.routes.ts`) reads the clock + version, calls
 * these functions, and lifts any `Result` into Effect at the boundary with `Effect.fromResult`.
 */
import type { HealthStatus } from "@app/shared"
import { Result } from "effect"

export interface HealthInput {
  readonly version: string
  /** Process start time, epoch ms. */
  readonly startedAt: number
  /** "Now", epoch ms — supplied by the shell so the core stays pure. */
  readonly now: number
}

/**
 * Build the health payload from already-read inputs. Pure, total. The return
 * shape is the shared effect `Schema` contract — server and client read the
 * same type, so the RPC boundary can't drift.
 */
export const buildStatus = (input: HealthInput): HealthStatus => ({
  ok: true,
  version: input.version,
  uptimeMs: Math.max(0, input.now - input.startedAt),
})

/** Tagged error for the (optional) typed-error demonstration below. */
export interface InvalidVerboseFlag {
  readonly _tag: "InvalidVerboseFlag"
  readonly received: string
}

/**
 * Parse the optional `?verbose=` query flag. Demonstrates the core's
 * error-as-value discipline: invalid input is an `Result.fail`, never a throw.
 * Absent flag defaults to `false` on the right.
 */
export const parseVerbose = (
  raw: string | undefined,
): Result.Result<boolean, InvalidVerboseFlag> => {
  if (raw === undefined || raw === "") return Result.succeed(false)
  if (raw === "true" || raw === "1") return Result.succeed(true)
  if (raw === "false" || raw === "0") return Result.succeed(false)
  return Result.fail({ _tag: "InvalidVerboseFlag", received: raw })
}
