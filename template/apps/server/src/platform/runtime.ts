/**
 * Builds the app runtime: every slice's live Layer, plus the logger. `axioms slice` adds new
 * layers to the mergeAll call. JSON logs in production, readable logs in development.
 */
import { Layer, Logger, ManagedRuntime } from "effect"
import { HealthClockLive } from "../features/health/health.io"
import type { AppDeps } from "./deps"

export const makeAppRuntime = (deps: AppDeps) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      HealthClockLive(deps),
      Logger.layer([
        deps.config.environment === "production" ? Logger.consoleJson : Logger.consolePretty(),
      ]),
    ),
  )

export type AppRuntime = ReturnType<typeof makeAppRuntime>
