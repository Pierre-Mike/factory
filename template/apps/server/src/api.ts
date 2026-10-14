/**
 * Mounts every slice under /api and exports `AppType` for the typed client (`hc<AppType>`) in
 * apps/web. Request ids and the access log sit at this edge, outside any Effect program, so this
 * file may use console directly (slices log with Effect.log).
 */
import { Hono } from "hono"
import { logger } from "hono/logger"
import { requestId } from "hono/request-id"
import { buildHealthApp } from "./features/health/health.routes"
import { onNotFound, onUnexpectedError } from "./platform/http"
import type { AppRuntime } from "./platform/runtime"

export const buildApp = (runtime: AppRuntime) =>
  new Hono()
    .basePath("/api")
    .onError(onUnexpectedError)
    .notFound(onNotFound)
    .use("*", requestId())
    .use("*", logger(console.log))
    .route("/health", buildHealthApp(runtime))

export type AppType = ReturnType<typeof buildApp>
