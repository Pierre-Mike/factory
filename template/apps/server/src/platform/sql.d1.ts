/**
 * D1 adapter for the SQL port. The D1 types are declared structurally here (only what the adapter
 * uses) instead of pulling in @cloudflare/workers-types, whose globals clash with Bun's in tests.
 */
import type { SqlDb, SqlQuery, SqlValue } from "./sql"

interface D1Result {
  readonly results?: ReadonlyArray<unknown>
  readonly meta: { readonly last_row_id: number; readonly changes: number }
}

interface D1Statement {
  readonly bind: (...values: SqlValue[]) => D1Statement
  readonly all: () => Promise<D1Result>
  readonly first: () => Promise<unknown>
  readonly run: () => Promise<D1Result>
}

export interface D1Like {
  readonly prepare: (sql: string) => D1Statement
  readonly batch: (statements: D1Statement[]) => Promise<unknown>
}

export const d1Sql = (db: D1Like): SqlDb => {
  const statement = (query: SqlQuery) => db.prepare(query.sql).bind(...(query.params ?? []))
  return {
    all: async (query) => (await statement(query).all()).results ?? [],
    first: async (query) => (await statement(query).first()) ?? undefined,
    run: async (query) => {
      const { meta } = await statement(query).run()
      return { lastRowId: meta.last_row_id, changes: meta.changes }
    },
    batch: async (queries) => {
      await db.batch(queries.map(statement))
    },
  }
}
