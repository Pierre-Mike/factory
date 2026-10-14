/**
 * The SQL port. Slices talk to the database through this interface only, so the same io code runs
 * on D1 in production (sql.d1.ts) and on an in-memory bun:sqlite database in tests (sql.bun.ts).
 * Rows come back as `unknown`: each slice decodes them with a Schema in its *.io.ts, so a schema
 * change that the code does not expect fails loudly at the boundary.
 */
export type SqlValue = string | number | null

export interface SqlQuery {
  readonly sql: string
  readonly params?: ReadonlyArray<SqlValue>
}

export interface SqlRunResult {
  readonly lastRowId: number
  readonly changes: number
}

export interface SqlDb {
  readonly all: (query: SqlQuery) => Promise<ReadonlyArray<unknown>>
  /** The first row, or undefined when there is none. */
  readonly first: (query: SqlQuery) => Promise<unknown>
  readonly run: (query: SqlQuery) => Promise<SqlRunResult>
  /** Run every statement in one transaction. */
  readonly batch: (queries: ReadonlyArray<SqlQuery>) => Promise<void>
}
