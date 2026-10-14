import { describe, expect, it } from "bun:test"
import { writeCanon } from "./canon.core"
import {
  type DoctorInput,
  HARNESS_BIOME,
  HARNESS_LEFTHOOK,
  HARNESS_PACKAGE,
  parseAllowlistedTags,
  runDoctor,
} from "./doctor.core"

const SHA = "df4cb1c069e1874edd31b4311f1884172cec0e10"

const healthy: DoctorInput = {
  canon: "the rules",
  biome: { extends: [HARNESS_BIOME], files: { includes: ["**"] } },
  lefthook: { extends: [HARNESS_LEFTHOOK] },
  agentsMd: writeCanon({ agentsMd: "# App", canon: "the rules" }),
  claudeMd: "@AGENTS.md\n",
  pkg: {
    devDependencies: { [HARNESS_PACKAGE]: "github:Pierre-Mike/factory#v0.3.0" },
    scripts: { check: "axioms check", smoke: "axioms smoke" },
  },
  workspaceDirs: ["apps/server", "shared"],
  tsconfigReferences: ["./apps/server", "./shared"],
  ciWorkflow: `steps:\n  - uses: actions/checkout@${SHA} # v6\n  - run: bunx axioms check\n  - run: bunx axioms smoke\n  - run: bunx axioms deploy --dry-run\n  - run: bunx axioms lint-workflows\n`,
  featureNames: ["health"],
  smokeFiles: ["health.smoke.test.ts"],
  allowlistedTags: ["InvalidVerboseFlag"],
  featureSource: 'return Result.fail({ _tag: "InvalidVerboseFlag" })',
  allowLocalHarness: false,
  effectRanges: [
    { workspace: "shared", range: "^4.0.4" },
    { workspace: "apps/server", range: "4.0.4" },
  ],
}

const rules = (input: DoctorInput) => runDoctor(input).map((f) => f.rule)

describe("runDoctor", () => {
  it("is silent on a healthy project", () => {
    expect(runDoctor(healthy)).toEqual([])
  })

  it("flags a biome.json that stops extending the harness or adds rules", () => {
    expect(rules({ ...healthy, biome: { extends: [] } })).toEqual(["biome"])
    expect(rules({ ...healthy, biome: { extends: [HARNESS_BIOME], linter: {} } })).toEqual([
      "biome",
    ])
    expect(rules({ ...healthy, biome: null })).toEqual(["biome"])
  })

  it("flags unwired hooks", () => {
    expect(rules({ ...healthy, lefthook: {} })).toEqual(["hooks"])
  })

  it("flags a stale canon copy and a CLAUDE.md that does not import it", () => {
    expect(rules({ ...healthy, canon: "newer rules" })).toEqual(["canon"])
    expect(rules({ ...healthy, claudeMd: null })).toEqual(["canon"])
  })

  it("flags a missing harness dependency or rewired scripts", () => {
    expect(rules({ ...healthy, pkg: { scripts: healthy.pkg } })).toContain("package")
    expect(
      rules({
        ...healthy,
        pkg: {
          devDependencies: { [HARNESS_PACKAGE]: "x" },
          scripts: { check: "true", smoke: "axioms smoke" },
        },
      }),
    ).toEqual(["package"])
  })

  it("flags a harness pinned to a local path, unless the self-test allows it", () => {
    const local = {
      devDependencies: { [HARNESS_PACKAGE]: "file:../factory" },
      scripts: { check: "axioms check", smoke: "axioms smoke" },
    }
    expect(rules({ ...healthy, pkg: local })).toEqual(["package"])
    expect(rules({ ...healthy, pkg: local, allowLocalHarness: true })).toEqual([])
  })

  it("flags a workspace outside the tsc -b graph", () => {
    expect(rules({ ...healthy, workspaceDirs: ["apps/server", "apps/web", "shared"] })).toEqual([
      "typecheck",
    ])
  })

  it("flags a CI workflow that skips a gate or uses an unpinned action", () => {
    expect(rules({ ...healthy, ciWorkflow: null })).toEqual(["ci"])
    expect(rules({ ...healthy, ciWorkflow: "run: bunx axioms check" })).toEqual(["ci", "ci", "ci"])
    expect(
      rules({
        ...healthy,
        ciWorkflow: `${healthy.ciWorkflow}  - uses: oven-sh/setup-bun@v2\n`,
      }),
    ).toEqual(["ci"])
  })

  it("flags a feature without a smoke test", () => {
    expect(rules({ ...healthy, featureNames: ["health", "items"] })).toEqual(["smoke"])
  })

  it("flags an allowlisted tag no code defines", () => {
    expect(rules({ ...healthy, allowlistedTags: ["InvalidVerboseFlag", "InvalidDemoId"] })).toEqual(
      ["errors"],
    )
  })
})

describe("effect major", () => {
  it("flags a workspace still on Effect 3", () => {
    expect(
      rules({ ...healthy, effectRanges: [{ workspace: "apps/web", range: "^3.21.0" }] }),
    ).toEqual(["effect"])
  })
})

describe("parseAllowlistedTags", () => {
  it("reads the tag names from STATUS_BY_TAG", () => {
    const source = `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
  ItemNotFound: 404,
}`
    expect(parseAllowlistedTags(source)).toEqual(["InvalidVerboseFlag", "ItemNotFound"])
  })

  it("returns nothing when the allowlist is absent", () => {
    expect(parseAllowlistedTags("export const x = 1")).toEqual([])
  })
})
