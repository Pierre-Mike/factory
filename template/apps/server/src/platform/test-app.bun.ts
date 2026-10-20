/**
 * The whole app for route tests: the real api.ts, runtime and slice Layers over a fresh in-memory
 * bun:sqlite database with every migration in apps/server/migrations applied. Only the SQL adapter
 * differs from production, so a route test checks the same wiring and schema the worker runs.
 */
import { buildApp } from "../api"
import { decodeConfig } from "./config"
import { makeAppRuntime } from "./runtime"
import type { SqlDb } from "./sql"
import { bunSql } from "./sql.bun"

export interface TestApp {
  /** The app's `request`. Paths include the /api prefix, e.g. `request("/api/health")`. */
  readonly request: ReturnType<typeof buildApp>["request"]
  /** The database behind the app, to seed rows before a request or read them after. */
  readonly db: SqlDb
}

export const testApp = (): TestApp => {
  const db = bunSql()
  const app = buildApp(makeAppRuntime({ config: decodeConfig({}), db }))
  return { request: app.request, db }
}
