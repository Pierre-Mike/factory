import { describe, expect, it } from "bun:test"
import { decodeHealthStatus } from "@app/shared"
import { testApp } from "./test-app.bun"

describe("testApp", () => {
  it("answers through the real api.ts, mounted under /api", async () => {
    const res = await testApp().request("/api/health")
    expect(res.status).toBe(200)
    expect(decodeHealthStatus(await res.json()).ok).toBe(true)
  })

  it("gives every call its own database", async () => {
    const first = testApp()
    await first.db.run({ sql: "CREATE TABLE scratch (id TEXT PRIMARY KEY)" })
    const tables = { sql: "SELECT name FROM sqlite_master WHERE name = 'scratch'" }
    expect(await first.db.all(tables)).toHaveLength(1)
    expect(await testApp().db.all(tables)).toEqual([])
  })
})
