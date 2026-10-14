import { describe, expect, it } from "bun:test"
import { deployBlockers } from "./deploy.core"

const ready = {
  main: "src/worker.ts",
  d1_databases: [
    { binding: "DB", database_name: "app", database_id: "3f1c2a9e-1b2c-4d5e-8f90-123456789abc" },
  ],
  vars: { APP_VERSION: "1.0.0", ENVIRONMENT: "production" },
}

describe("deployBlockers", () => {
  it("is empty for a deployable config", () => {
    expect(deployBlockers(ready)).toEqual([])
  })

  it("names the placeholder database id and how to fix it", () => {
    const blockers = deployBlockers({
      ...ready,
      d1_databases: [
        {
          binding: "DB",
          database_name: "app",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
    })
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toContain("wrangler d1 create app")
  })

  it("names placeholder vars", () => {
    expect(
      deployBlockers({ ...ready, vars: { ACCESS_AUD: "REPLACE-ME", APP_VERSION: "1" } }),
    ).toEqual(["var ACCESS_AUD is still a placeholder (REPLACE-ME)"])
  })

  it("rejects a missing config or entry point", () => {
    expect(deployBlockers(null)).toEqual(["wrangler.jsonc is missing or not valid JSONC"])
    expect(deployBlockers({ ...ready, main: undefined })).toEqual([
      "wrangler.jsonc has no `main` entry",
    ])
  })
})
