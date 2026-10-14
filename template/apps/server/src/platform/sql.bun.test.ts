import { describe, expect, it } from "bun:test"
import { bunSql } from "./sql.bun"

const withTable = async () => {
  const db = bunSql()
  await db.run({ sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)" })
  return db
}

describe("bunSql", () => {
  it("runs, reads and reports the inserted id", async () => {
    const db = await withTable()
    const result = await db.run({ sql: "INSERT INTO t (name) VALUES (?)", params: ["a"] })
    expect(result).toEqual({ lastRowId: 1, changes: 1 })
    expect(await db.all({ sql: "SELECT id, name FROM t" })).toEqual([{ id: 1, name: "a" }])
    expect(await db.first({ sql: "SELECT name FROM t WHERE id = ?", params: [1] })).toEqual({
      name: "a",
    })
  })

  it("returns undefined for a missing row", async () => {
    const db = await withTable()
    expect(await db.first({ sql: "SELECT * FROM t WHERE id = 9" })).toBeUndefined()
  })

  it("rolls the whole batch back when one statement fails", async () => {
    const db = await withTable()
    const insert = (name: string | null) => ({
      sql: "INSERT INTO t (name) VALUES (?)",
      params: [name],
    })
    await expect(db.batch([insert("a"), insert(null)])).rejects.toThrow()
    expect(await db.all({ sql: "SELECT * FROM t" })).toEqual([])
  })
})
