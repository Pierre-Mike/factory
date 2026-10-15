import { describe, expect, it } from "bun:test"
import { parseNewArgs, releaseSpec } from "./new.core"

describe("parseNewArgs", () => {
  it("takes the folder alone, installing by default", () => {
    expect(parseNewArgs(["my-app"])).toEqual({
      ok: true,
      args: { dir: "my-app", harness: undefined, install: true },
    })
  })

  it("does not mistake the --harness value for the folder when the flag comes first", () => {
    expect(parseNewArgs(["--harness", "github:Pierre-Mike/factory#v1.0.0", "demo"])).toEqual({
      ok: true,
      args: { dir: "demo", harness: "github:Pierre-Mike/factory#v1.0.0", install: true },
    })
  })

  it("reads flags after the folder", () => {
    expect(parseNewArgs(["demo", "--no-install", "--harness", "file:../factory"])).toEqual({
      ok: true,
      args: { dir: "demo", harness: "file:../factory", install: false },
    })
  })

  it("rejects a missing folder, a missing --harness value, unknown flags and extra arguments", () => {
    for (const args of [
      [],
      ["demo", "--harness"],
      ["--harness", "--no-install", "demo"],
      ["demo", "--nope"],
      ["a", "b"],
    ]) {
      expect(parseNewArgs(args).ok).toBe(false)
    }
  })
})

describe("releaseSpec", () => {
  it("pins the GitHub tag of the version through git, which can authenticate", () => {
    expect(releaseSpec("0.5.1")).toBe("git+ssh://git@github.com/Pierre-Mike/factory.git#v0.5.1")
  })
})
