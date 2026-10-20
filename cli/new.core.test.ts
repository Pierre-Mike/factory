import { describe, expect, it } from "bun:test"
import { deployMode, parseNewArgs, releaseSpec, withDeployMode } from "./new.core"

describe("parseNewArgs", () => {
  it("takes the folder alone, installing by default", () => {
    expect(parseNewArgs(["my-app"])).toEqual({
      ok: true,
      args: { dir: "my-app", harness: undefined, install: true, deploy: "push" },
    })
  })

  it("does not mistake the --harness value for the folder when the flag comes first", () => {
    expect(parseNewArgs(["--harness", "github:Pierre-Mike/factory#v1.0.0", "demo"])).toEqual({
      ok: true,
      args: {
        dir: "demo",
        harness: "github:Pierre-Mike/factory#v1.0.0",
        install: true,
        deploy: "push",
      },
    })
  })

  it("reads flags after the folder", () => {
    expect(parseNewArgs(["demo", "--no-install", "--harness", "file:../factory"])).toEqual({
      ok: true,
      args: { dir: "demo", harness: "file:../factory", install: false, deploy: "push" },
    })
  })

  it("rejects a missing folder, a missing --harness value, unknown flags and extra arguments", () => {
    for (const args of [
      [],
      ["demo", "--harness"],
      ["--harness", "--no-install", "demo"],
      ["demo", "--nope"],
      ["a", "b"],
      ["demo", "--deploy"],
      ["demo", "--deploy=nightly"],
    ]) {
      expect(parseNewArgs(args).ok).toBe(false)
    }
  })
})

describe("--deploy", () => {
  it("takes push or manual, as --deploy <mode> or --deploy=<mode>", () => {
    expect(parseNewArgs(["demo", "--deploy", "manual"])).toMatchObject({
      ok: true,
      args: { dir: "demo", deploy: "manual" },
    })
    expect(parseNewArgs(["--deploy=push", "demo"])).toMatchObject({
      ok: true,
      args: { deploy: "push" },
    })
  })
})

describe("deployMode", () => {
  it('reads "axioms": { "deploy": "manual" } from package.json and defaults to push', () => {
    expect(deployMode({ axioms: { deploy: "manual" } })).toBe("manual")
    expect(deployMode({ axioms: { profile: "lite" } })).toBe("push")
    expect(deployMode({ axioms: { deploy: "weekly" } })).toBe("push")
    expect(deployMode(null)).toBe("push")
  })
})

describe("withDeployMode", () => {
  it("records manual in package.json and leaves push, the default, unrecorded", () => {
    expect(withDeployMode({ pkg: { name: "a" }, mode: "manual" })).toEqual({
      name: "a",
      axioms: { deploy: "manual" },
    })
    expect(withDeployMode({ pkg: { name: "a" }, mode: "push" })).toEqual({ name: "a" })
  })
})

describe("releaseSpec", () => {
  it("pins the GitHub tag of the version, which the public repo serves anonymously", () => {
    expect(releaseSpec("0.5.1")).toBe("github:Pierre-Mike/factory#v0.5.1")
  })
})
