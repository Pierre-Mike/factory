/** What every slice's live Layer is built from. worker.ts creates it once per isolate. */
import type { AppConfig } from "./config"
import type { SqlDb } from "./sql"

export interface AppDeps {
  readonly config: AppConfig
  readonly db: SqlDb
}
