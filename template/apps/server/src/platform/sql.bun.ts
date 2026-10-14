/**
 * bun:sqlite adapter for the SQL port, used by tests. It applies the real D1 migration files, so a
 * test runs against exactly the schema production gets.
 */
import { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SqlDb, SqlQuery } from "./sql"

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations")

/** A fresh in-memory database with every migration in apps/server/migrations applied. */
export const bunSql = (): SqlDb => {
  const db = new Database(":memory:")
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }
  const params = (query: SqlQuery) => [...(query.params ?? [])]
  const runOne = (query: SqlQuery) => db.query(query.sql).run(...params(query))
  return {
    all: async (query) => db.query(query.sql).all(...params(query)),
    first: async (query) => db.query(query.sql).get(...params(query)) ?? undefined,
    run: async (query) => {
      const result = runOne(query)
      return { lastRowId: Number(result.lastInsertRowid), changes: result.changes }
    },
    batch: async (queries) => {
      db.transaction(() => {
        for (const query of queries) runOne(query)
      })()
    },
  }
}
