/**
 * Hono shell for the `health` slice: read the clock (impure), parse the flag and build the status
 * (pure), respond. A bad `?verbose=` flag is a typed Left that becomes the shared 400 envelope.
 */
import { Effect } from "effect"
import { Hono } from "hono"
import { type RouteRuntime, respond } from "../../platform/http"
import { buildStatus, parseVerbose } from "./health.core"
import { HealthClock } from "./health.io"

export const buildHealthApp = (runtime: RouteRuntime<HealthClock>) =>
  new Hono().get("/", (c) =>
    respond({
      c,
      runtime,
      program: Effect.gen(function* () {
        const clock = yield* HealthClock
        const now = yield* clock.now()
        const verbose = yield* parseVerbose(c.req.query("verbose"))
        const status = buildStatus({ version: clock.version, startedAt: clock.startedAt, now })
        return verbose ? { ...status, verbose: true } : status
      }),
    }),
  )
