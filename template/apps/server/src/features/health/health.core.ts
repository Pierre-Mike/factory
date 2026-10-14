/**
 * Functional core for the `health` slice — PURE.
 *
 * No Effect runtime, no Layer/Context, no I/O. Inputs come in as plain data,
 * results go out as plain data, and failures are values: this module models its
 * one fallible path (parsing an optional `?verbose=` query flag) as
 * `Either<HealthError, A>` rather than throwing. The imperative shell
 * (`health.io.ts` / `health.routes.ts`) reads the clock + version, calls
 * these functions, and lifts any `Either` into Effect at the boundary.
 */
import type { HealthStatus } from "@app/shared"
import { Either } from "effect"

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
 * error-as-value discipline: invalid input is an `Either.left`, never a throw.
 * Absent flag defaults to `false` on the right.
 */
export const parseVerbose = (
  raw: string | undefined,
): Either.Either<boolean, InvalidVerboseFlag> => {
  if (raw === undefined || raw === "") return Either.right(false)
  if (raw === "true" || raw === "1") return Either.right(true)
  if (raw === "false" || raw === "0") return Either.right(false)
  return Either.left({ _tag: "InvalidVerboseFlag", received: raw })
}
