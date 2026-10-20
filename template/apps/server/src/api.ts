/**
 * Mounts every slice under /api and exports `AppType` for the typed client (`hc<AppType>`) in
 * apps/web. Request ids and the access log sit at this edge, outside any Effect program, so this
 * file may use console directly (slices log with Effect.log).
 */
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { logger } from "hono/logger"
import { requestId } from "hono/request-id"
import { buildHealthApp } from "./features/health/health.routes"
import { onNotFound, onUnexpectedError } from "./platform/http"
import type { AppRuntime } from "./platform/runtime"

/**
 * The largest request body any route accepts. A bigger one answers the shared 413
 * `PayloadTooLarge` envelope before a route reads it. Raise it here for a route that needs more.
 */
export const MAX_BODY_BYTES = 100 * 1024

export const buildApp = (runtime: AppRuntime) =>
  new Hono()
    .basePath("/api")
    .onError(onUnexpectedError)
    .notFound(onNotFound)
    .use("*", requestId())
    .use("*", logger(console.log))
    .use("*", bodyLimit({ maxSize: MAX_BODY_BYTES }))
    .route("/health", buildHealthApp(runtime))

export type AppType = ReturnType<typeof buildApp>
