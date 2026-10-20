/**
 * Runs only under `bun run e2e` (`axioms e2e`): headless chromium against a real `wrangler dev`
 * serving the built web app. It checks what a user sees, so a page that renders nothing, a broken
 * route or a failed API call fails here even when every unit and smoke test passes.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { decodeHealthStatus } from "@app/shared"
import { type Browser, chromium } from "playwright"

const BASE = process.env.E2E_URL
if (BASE === undefined) throw new Error("E2E_URL is not set; run this file with `bun run e2e`")

describe("e2e: health page", () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser.close()
  })

  it("shows the status and version the API reports", async () => {
    const health = decodeHealthStatus(await (await fetch(`${BASE}/api/health`)).json())
    const page = await browser.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(`${BASE}/`)
    await expect(page.getByTestId("health-status").textContent()).resolves.toBe("ok")
    expect(await page.getByTestId("health-version").textContent()).toBe(health.version)
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Service health")
    expect(errors).toEqual([])
  })
})
