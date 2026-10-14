/**
 * I/O port for the `health` slice: the wall clock, plus two constants captured when the layer is
 * built (the isolate start time and the version). Routes depend on the Tag; tests pass a frozen
 * clock.
 */
import { Clock, Context, type Effect, Layer } from "effect"
import type { AppDeps } from "../../platform/deps"

export class HealthClock extends Context.Tag("HealthClock")<
  HealthClock,
  {
    /** Wall-clock now, epoch ms. */
    readonly now: () => Effect.Effect<number>
    /** Isolate start time, epoch ms. */
    readonly startedAt: number
    readonly version: string
  }
>() {}

export const HealthClockLive = (deps: AppDeps): Layer.Layer<HealthClock> =>
  Layer.sync(HealthClock, () => ({
    now: () => Clock.currentTimeMillis,
    startedAt: Date.now(),
    version: deps.config.version,
  }))
