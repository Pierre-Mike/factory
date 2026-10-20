import { describe, expect, it } from "bun:test"
import { BROWSER_INSTALL_CMD, e2eTestCmd, e2eTestFiles } from "./e2e.core"

describe("e2eTestFiles", () => {
  it("keeps the *.e2e.ts files of apps/web/e2e, sorted", () => {
    expect(
      e2eTestFiles(["tsconfig.json", "widgets.e2e.ts", "health.e2e.ts", "helpers.ts", "dist"]),
    ).toEqual(["health.e2e.ts", "widgets.e2e.ts"])
  })

  it("does not count a unit test or a file that only ends in e2e", () => {
    expect(e2eTestFiles(["health.test.ts", "e2e.ts", "health.e2e.tsx", ".e2e.ts"])).toEqual([])
  })
})

describe("e2eTestCmd", () => {
  it("passes each file by path, since bun test does not discover *.e2e.ts on its own", () => {
    expect(e2eTestCmd(["health.e2e.ts", "widgets.e2e.ts"])).toEqual([
      "bun",
      "test",
      "--timeout",
      "30000",
      "./e2e/health.e2e.ts",
      "./e2e/widgets.e2e.ts",
    ])
  })
})

describe("BROWSER_INSTALL_CMD", () => {
  it("installs only the headless chromium the tests launch", () => {
    expect(BROWSER_INSTALL_CMD).toEqual([
      "bunx",
      "playwright",
      "install",
      "chromium-headless-shell",
    ])
  })
})
