/** Runs only under `bun run smoke`, against a real `wrangler dev`. */
import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, decodeHealthStatus } from "@app/shared"

const BASE = process.env.SMOKE_URL

describe.skipIf(BASE === undefined)("smoke: worker + assets", () => {
  it("answers /api/health from the worker", async () => {
    const res = await fetch(`${BASE}/api/health`)
    expect(res.status).toBe(200)
    expect(decodeHealthStatus(await res.json()).ok).toBe(true)
  })

  it("serves the web app, including deep links (SPA fallback)", async () => {
    for (const path of ["/", "/some/deep/link"]) {
      const res = await fetch(`${BASE}${path}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<div id="root">')
    }
  })

  it("returns the shared error envelope as a 404 for an unknown API route", async () => {
    const res = await fetch(`${BASE}/api/does-not-exist`)
    expect(res.status).toBe(404)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("NotFound")
  })
})
