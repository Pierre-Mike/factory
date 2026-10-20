import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { liteCiWorkflow } from "./adopt.core"
import { writeCanon } from "./canon.core"
import {
  BIOME_FILE_INCLUDES,
  type DoctorInput,
  HARNESS_BIOME,
  HARNESS_LEFTHOOK,
  HARNESS_PACKAGE,
  HARNESS_TSCONFIG,
  harnessProfile,
  parseAllowlistedTags,
  runDoctor,
  TSCONFIG_BASE,
} from "./doctor.core"

const SHA = "df4cb1c069e1874edd31b4311f1884172cec0e10"

const HEALTHY_JOBS = {
  check: {
    steps: [
      { uses: `actions/checkout@${SHA}` },
      { run: "bun install --frozen-lockfile" },
      { run: "bunx axioms check" },
    ],
  },
  rest: {
    steps: [
      { run: "bunx axioms smoke" },
      { run: "bunx axioms deploy --dry-run" },
      { run: "bunx axioms lint-workflows" },
      { run: "bunx axioms secret-scan" },
      { run: "bunx axioms pr-body" },
      { run: "bunx axioms e2e" },
    ],
  },
}

/** The hook config the harness ships, so these tests also pin what harness/lefthook.yml runs. */
const HARNESS_HOOKS: unknown = Bun.YAML.parse(
  readFileSync(join(import.meta.dir, "..", "harness", "lefthook.yml"), "utf8"),
)

const HTTP_SOURCE = `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  InvalidVerboseFlag: 400,
}`

const healthy: DoctorInput = {
  canon: "the rules",
  biome: { extends: [HARNESS_BIOME], files: { includes: [...BIOME_FILE_INCLUDES] } },
  lefthook: { extends: [HARNESS_LEFTHOOK] },
  harnessLefthook: HARNESS_HOOKS,
  agentsMd: writeCanon({ agentsMd: "# App", canon: "the rules" }),
  claudeMd: "@AGENTS.md\n",
  notesRules: "# Agent Notes\n",
  notesReadme: "# Agent Notes\n",
  harnessSettings: '{ "permissions": { "allow": [] } }\n',
  claudeSettings: '{ "permissions": { "allow": [] } }\n',
  skillCopies: [
    { path: "README.md", harness: "# Harness skills\n", project: "# Harness skills\n" },
  ],
  pkg: {
    devDependencies: { [HARNESS_PACKAGE]: "github:Pierre-Mike/factory#v0.3.0" },
    scripts: { check: "axioms check", smoke: "axioms smoke" },
  },
  workspaceDirs: ["apps/server", "shared"],
  tsconfigReferences: ["./apps/server", "./shared"],
  tsconfigs: [
    { path: TSCONFIG_BASE, config: { extends: HARNESS_TSCONFIG } },
    {
      path: "apps/server/tsconfig.json",
      config: { extends: "../../tsconfig.base.json", compilerOptions: { lib: ["ES2022"] } },
    },
    { path: "shared/tsconfig.json", config: { extends: "../tsconfig.base.json" } },
  ],
  nestedBiomeConfigs: [],
  ciWorkflow: { jobs: HEALTHY_JOBS },
  featureNames: ["health"],
  smokeFiles: ["health.smoke.test.ts"],
  allowlistedTags: ["InvalidVerboseFlag"],
  serverSources: [
    {
      path: "features/health/health.core.ts",
      text: 'return Result.fail({ _tag: "InvalidVerboseFlag" })',
    },
    { path: "platform/http.ts", text: HTTP_SOURCE },
  ],
  allowLocalHarness: false,
  harnessVersion: "0.7.0",
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

  it("flags a biome.json that extends anything besides the harness", () => {
    expect(rules({ ...healthy, biome: { extends: [HARNESS_BIOME, "./loose.json"] } })).toEqual([
      "biome",
    ])
  })

  it("flags a files block that hides code from the linter", () => {
    const withFiles = (files: unknown) =>
      rules({ ...healthy, biome: { extends: [HARNESS_BIOME], files } })
    expect(withFiles(undefined)).toEqual([])
    expect(withFiles({ includes: ["**", "!**/dist"] })).toEqual([])
    expect(withFiles({ includes: ["**", "!**/features/**"] })).toEqual(["biome"])
    expect(withFiles({ includes: ["apps/web/**"] })).toEqual(["biome"])
    expect(withFiles({ includes: ["**"], maxSize: 1 })).toEqual(["biome"])
    expect(withFiles({ includes: "**" })).toEqual(["biome"])
  })

  it("flags a nested Biome config", () => {
    expect(rules({ ...healthy, nestedBiomeConfigs: ["apps/server/biome.json"] })).toEqual(["biome"])
  })

  it("flags unwired hooks", () => {
    expect(rules({ ...healthy, lefthook: {} })).toEqual(["hooks"])
  })

  it("names a missing or unparsable lefthook.yml instead of crashing", () => {
    const problems = (lefthook: unknown) =>
      runDoctor({ ...healthy, lefthook }).map((finding) => finding.problem)
    expect(problems(null)).toEqual(["lefthook.yml is missing"])
    expect(problems(undefined)).toEqual(["lefthook.yml is not valid YAML"])
  })

  describe("pre-push e2e", () => {
    const prePush = (jobs: unknown[]) => ({ "pre-push": { piped: true, jobs } })

    it("flags a harness hook config whose pre-push never runs axioms e2e", () => {
      const problems = (harnessLefthook: unknown) =>
        runDoctor({ ...healthy, harnessLefthook }).map((finding) => finding.problem)
      const expected = ["the harness pre-push hook never runs `axioms e2e`"]
      expect(problems(prePush([{ name: "check", run: "bunx axioms check" }]))).toEqual(expected)
      expect(problems(prePush([{ name: "e2e", run: "bunx axioms e2e", skip: true }]))).toEqual(
        expected,
      )
      expect(problems(prePush([{ name: "e2e", run: "echo axioms e2e" }]))).toEqual(expected)
      expect(problems(null)).toEqual(expected)
      expect(problems(prePush([{ name: "e2e", run: "bunx axioms e2e" }]))).toEqual([])
    })

    it("flags a project lefthook.yml that skips or redefines the pre-push e2e job", () => {
      const withLocal = (local: Record<string, unknown>) =>
        rules({ ...healthy, lefthook: { extends: [HARNESS_LEFTHOOK], ...local } })
      expect(withLocal({ "pre-push": { skip: true } })).toEqual(["hooks"])
      expect(withLocal(prePush([{ name: "e2e", skip: true }]))).toEqual(["hooks"])
      expect(withLocal(prePush([{ name: "e2e", run: "true" }]))).toEqual(["hooks"])
      expect(withLocal({ "pre-push": { commands: { e2e: { skip: true } } } })).toEqual(["hooks"])
      expect(withLocal(prePush([{ name: "typos", run: "typos" }]))).toEqual([])
    })
  })

  it("flags a stale canon copy and a CLAUDE.md that does not import it", () => {
    expect(rules({ ...healthy, canon: "newer rules" })).toEqual(["canon"])
    expect(rules({ ...healthy, claudeMd: null })).toEqual(["canon"])
  })

  it("flags missing or edited Agent Note rules", () => {
    expect(rules({ ...healthy, notesReadme: null })).toEqual(["notes"])
    expect(rules({ ...healthy, notesReadme: "# Our own rules\n" })).toEqual(["notes"])
    expect(rules({ ...healthy, notesRules: "# Newer rules\n" })).toEqual(["notes"])
  })

  it("flags a .claude/settings.json that is missing or differs from the harness", () => {
    expect(rules({ ...healthy, claudeSettings: null })).toEqual(["settings"])
    expect(rules({ ...healthy, claudeSettings: "{}\n" })).toEqual(["settings"])
    expect(rules({ ...healthy, harnessSettings: '{ "newer": true }\n' })).toEqual(["settings"])
  })

  it("flags each harness skill file a project misses or edited, naming the path", () => {
    const skill = { path: "peer-review/SKILL.md", harness: "# Peer review\n" }
    expect(
      rules({ ...healthy, skillCopies: [...healthy.skillCopies, { ...skill, project: null }] }),
    ).toEqual(["skills"])
    const edited = runDoctor({
      ...healthy,
      skillCopies: [{ ...skill, project: "# Edited\n" }, ...healthy.skillCopies],
    })
    expect(edited.map((f) => f.rule)).toEqual(["skills"])
    expect(edited[0]?.problem).toContain(".claude/skills/peer-review/SKILL.md")
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

  it("tells you to install the harness from GitHub, since it is not on npm", () => {
    const missing = runDoctor({ ...healthy, pkg: { scripts: healthy.pkg } }).find(
      (f) => f.rule === "package",
    )
    expect(missing?.remedy).toBe(`bun add -d ${HARNESS_PACKAGE}@github:Pierre-Mike/factory#v0.7.0`)
  })

  it("flags the git+ssh spec from the private-repo releases, which needs an SSH key or a token", () => {
    const sshPinned = {
      devDependencies: {
        [HARNESS_PACKAGE]: "git+ssh://git@github.com/Pierre-Mike/factory.git#v0.11.0",
      },
      scripts: { check: "axioms check", smoke: "axioms smoke" },
    }
    const finding = runDoctor({ ...healthy, pkg: sshPinned }).find((f) => f.rule === "package")
    expect(finding?.remedy).toBe(
      `the harness is public: bun add -d ${HARNESS_PACKAGE}@github:Pierre-Mike/factory#v0.7.0`,
    )
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

  describe("tsconfig strictness", () => {
    const [base, server, shared] = healthy.tsconfigs
    const withServer = (config: unknown) => ({
      ...healthy,
      tsconfigs: [base!, { path: "apps/server/tsconfig.json", config }, shared!],
    })

    it("flags a workspace that turns a strict check off", () => {
      const loose = withServer({
        extends: "../../tsconfig.base.json",
        compilerOptions: { noUncheckedIndexedAccess: false },
      })
      expect(rules(loose)).toEqual(["typecheck"])
      expect(runDoctor(loose)[0]?.problem).toContain("noUncheckedIndexedAccess")
      expect(
        rules(
          withServer({ extends: "../../tsconfig.base.json", compilerOptions: { strict: false } }),
        ),
      ).toEqual(["typecheck"])
    })

    it("accepts strict checks set to true, and unrelated options", () => {
      expect(
        rules(
          withServer({
            extends: "../../tsconfig.base.json",
            compilerOptions: { strict: true, noUncheckedIndexedAccess: true, rootDir: "." },
          }),
        ),
      ).toEqual([])
    })

    it("flags a workspace that stops extending the base", () => {
      expect(rules(withServer({ compilerOptions: { lib: ["ES2022"] } }))).toEqual(["typecheck"])
      expect(rules(withServer({ extends: "./loose.json" }))).toEqual(["typecheck"])
    })

    it("accepts a workspace that extends the harness directly, or through an extends array", () => {
      expect(rules(withServer({ extends: HARNESS_TSCONFIG }))).toEqual([])
      expect(rules(withServer({ extends: ["../../tsconfig.base.json"] }))).toEqual([])
    })

    it("flags a base that stops extending the harness, or a missing file", () => {
      const tsconfigs = (first: unknown) => [
        { path: TSCONFIG_BASE, config: first },
        server!,
        shared!,
      ]
      expect(rules({ ...healthy, tsconfigs: tsconfigs({}) })).toEqual(["typecheck"])
      expect(rules({ ...healthy, tsconfigs: tsconfigs(null) })).toEqual(["typecheck"])
    })
  })

  describe("ci.yml", () => {
    const withSteps = (steps: unknown[]) =>
      rules({
        ...healthy,
        ciWorkflow: {
          jobs: {
            ...HEALTHY_JOBS,
            check: { steps },
          },
        },
      })

    it("flags a missing or unparseable workflow", () => {
      expect(rules({ ...healthy, ciWorkflow: null })).toEqual(["ci"])
      expect(rules({ ...healthy, ciWorkflow: undefined })).toEqual(["ci"])
    })

    it("flags each gate no job runs", () => {
      expect(
        rules({
          ...healthy,
          ciWorkflow: { jobs: { a: { steps: [{ run: "bunx axioms check" }] } } },
        }),
      ).toEqual(["ci", "ci", "ci", "ci", "ci", "ci"])
    })

    it("accepts the gate inside a multi-line run, with or without bunx", () => {
      expect(withSteps([{ run: "bun install\naxioms check\n" }])).toEqual([])
    })

    it("does not count a gate mentioned in a comment, an echo or a name", () => {
      expect(withSteps([{ name: "axioms check", run: "echo 'bunx axioms check'" }])).toEqual(["ci"])
      expect(withSteps([{ run: "# bunx axioms check\ntrue" }])).toEqual(["ci"])
    })

    it("does not count a gate whose failure is ignored or that may be skipped", () => {
      expect(withSteps([{ run: "bunx axioms check || true" }])).toEqual(["ci"])
      expect(withSteps([{ run: "bunx axioms check", "continue-on-error": true }])).toEqual(["ci"])
      expect(withSteps([{ run: "bunx axioms check", if: "false" }])).toEqual(["ci"])
      expect(
        rules({
          ...healthy,
          ciWorkflow: {
            jobs: {
              ...HEALTHY_JOBS,
              check: { if: "false", steps: [{ run: "bunx axioms check" }] },
            },
          },
        }),
      ).toEqual(["ci"])
    })

    it("flags a harness-access step left over from the private-repo releases", () => {
      expect(
        withSteps([
          { id: "harness-access", run: "git config --global url.x.insteadOf y" },
          { run: "bun install --frozen-lockfile" },
          { run: "bunx axioms check" },
        ]),
      ).toEqual(["ci"])
    })

    it("needs no access step before bun install, since the harness is public", () => {
      expect(withSteps([{ run: "bun install" }, { run: "bunx axioms check" }])).toEqual([])
    })

    it("flags actions not pinned to a commit SHA, in steps and reusable workflows", () => {
      expect(withSteps([{ uses: "oven-sh/setup-bun@v2" }, { run: "bunx axioms check" }])).toEqual([
        "ci",
      ])
      expect(
        rules({
          ...healthy,
          ciWorkflow: {
            jobs: {
              ...HEALTHY_JOBS,
              reuse: { uses: "org/repo/.github/workflows/x.yml@main" },
            },
          },
        }),
      ).toEqual(["ci"])
      expect(
        withSteps([{ uses: "./.github/actions/local" }, { run: "bunx axioms check" }]),
      ).toEqual([])
    })
  })

  it("flags a feature without a smoke test", () => {
    expect(rules({ ...healthy, featureNames: ["health", "items"] })).toEqual(["smoke"])
  })

  it("flags an allowlisted tag no code defines", () => {
    expect(rules({ ...healthy, allowlistedTags: ["InvalidVerboseFlag", "InvalidDemoId"] })).toEqual(
      ["errors"],
    )
  })

  describe("allowlisted tags", () => {
    const withHttp = (text: string): DoctorInput => ({
      ...healthy,
      allowlistedTags: parseAllowlistedTags(text),
      serverSources: [...healthy.serverSources, { path: "platform/http.ts", text }],
    })

    it("accepts a tag that platform/http.ts creates outside STATUS_BY_TAG", () => {
      const http = `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  BadRequest: 400,
  InvalidVerboseFlag: 400,
}
export const badRequest = { _tag: "BadRequest" } as const`
      expect(rules(withHttp(http))).toEqual([])
    })

    it("flags a tag that appears only as a key of STATUS_BY_TAG", () => {
      const http = `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  "Orphan": 400,
  InvalidVerboseFlag: 400,
}`
      expect(rules(withHttp(http))).toEqual(["errors"])
    })

    it("does not count a tag that only a test creates", () => {
      expect(
        rules({
          ...healthy,
          allowlistedTags: ["InvalidVerboseFlag", "InvalidDemoId"],
          serverSources: [
            ...healthy.serverSources,
            { path: "features/demo/demo.core.test.ts", text: '{ _tag: "InvalidDemoId" }' },
          ],
        }),
      ).toEqual(["errors"])
    })

    it("offers both remedies: create the tag, or remove it from STATUS_BY_TAG", () => {
      const [finding] = runDoctor({
        ...healthy,
        allowlistedTags: ["InvalidVerboseFlag", "InvalidDemoId"],
      })
      expect(finding?.problem).toBe(
        'STATUS_BY_TAG allowlists "InvalidDemoId", but no code under apps/server/src creates it',
      )
      expect(finding?.remedy).toContain('create the tag ({ _tag: "InvalidDemoId" })')
      expect(finding?.remedy).toContain("or remove InvalidDemoId from STATUS_BY_TAG")
    })
  })

  it("names the slice that generated an orphaned stub tag", () => {
    const findings = runDoctor({
      ...healthy,
      featureNames: ["health", "user-posts"],
      smokeFiles: ["health.smoke.test.ts", "user-posts.smoke.test.ts"],
      allowlistedTags: ["InvalidVerboseFlag", "InvalidUserPostsId"],
    })
    expect(findings.map((f) => f.remedy)).toEqual([
      "remove InvalidUserPostsId from STATUS_BY_TAG in platform/http.ts: `axioms slice user-posts` added it for the stub core, which no longer uses it",
    ])
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

  it("reads a quoted key too", () => {
    const source = `const STATUS_BY_TAG: Record<string, ContentfulStatusCode> = {
  "Quoted": 400,
}`
    expect(parseAllowlistedTags(source)).toEqual(["Quoted"])
  })

  it("returns nothing when the allowlist is absent", () => {
    expect(parseAllowlistedTags("export const x = 1")).toEqual([])
  })
})

describe("lite profile (axioms adopt)", () => {
  const litePkg = {
    devDependencies: { [HARNESS_PACKAGE]: "github:Pierre-Mike/factory#v0.8.1" },
    scripts: { check: "axioms check" },
    axioms: { profile: "lite" },
  }

  /** An adopted repo: no template, no workspaces, no tsconfig, and the CI workflow adopt stamps. */
  const lite: DoctorInput = {
    ...healthy,
    pkg: litePkg,
    workspaceDirs: [],
    tsconfigReferences: [],
    tsconfigs: [{ path: TSCONFIG_BASE, config: null }],
    ciWorkflow: Bun.YAML.parse(liteCiWorkflow("main")),
    featureNames: [],
    smokeFiles: [],
    allowlistedTags: [],
    serverSources: [],
    effectRanges: [{ workspace: ".", range: "^3.12.0" }],
  }

  it("reads the profile from package.json and defaults to app", () => {
    expect(harnessProfile(litePkg)).toBe("lite")
    expect(harnessProfile({})).toBe("app")
    expect(harnessProfile({ axioms: { profile: "turbo" } })).toBe("app")
    expect(harnessProfile(null)).toBe("app")
  })

  it("is silent on a healthy adopted repo with no tsconfig, smoke or deploy", () => {
    expect(runDoctor(lite)).toEqual([])
  })

  it("still guards the lite gates", () => {
    expect(rules({ ...lite, biome: null })).toEqual(["biome"])
    expect(rules({ ...lite, lefthook: {} })).toEqual(["hooks"])
    expect(rules({ ...lite, claudeMd: "" })).toEqual(["canon"])
    expect(rules({ ...lite, notesReadme: null })).toEqual(["notes"])
    expect(rules({ ...lite, pkg: { ...litePkg, devDependencies: {} } })).toEqual(["package"])
    expect(rules({ ...lite, pkg: { ...litePkg, scripts: {} } })).toEqual(["package"])
    expect(rules({ ...lite, ciWorkflow: null })).toEqual(["ci"])
    expect(rules({ ...lite, ciWorkflow: { jobs: {} } })).toEqual(["ci", "ci", "ci"])
  })

  it("asks a lite repo for the secret-scan and pr-body CI gates, not only check", () => {
    const checkOnly = {
      jobs: {
        check: { steps: [{ uses: `actions/checkout@${SHA}` }, { run: "bunx axioms check" }] },
      },
    }
    expect(runDoctor({ ...lite, ciWorkflow: checkOnly }).map((f) => f.problem)).toEqual([
      "ci.yml never runs `axioms secret-scan` as a step that must pass",
      "ci.yml never runs `axioms pr-body` as a step that must pass",
    ])
  })

  it("rejects a local harness path unless the selftest allows it", () => {
    const local = {
      ...lite,
      pkg: { ...litePkg, devDependencies: { [HARNESS_PACKAGE]: "file:../factory" } },
    }
    expect(rules(local)).toEqual(["package"])
    expect(rules({ ...local, allowLocalHarness: true })).toEqual([])
  })

  it("asks an app repo, but not a lite repo, for the e2e CI gate", () => {
    const app = { ...lite, pkg: { ...litePkg, axioms: {} } }
    expect(runDoctor(app).map((f) => f.problem)).toContain(
      "ci.yml never runs `axioms e2e` as a step that must pass",
    )
    expect(runDoctor(lite)).toEqual([])
  })

  it("asks an app repo, but not a lite repo, for the smoke and deploy CI gates", () => {
    expect(rules({ ...lite, pkg: { ...litePkg, axioms: {} } })).toContain("ci")
    expect(rules(lite)).toEqual([])
  })

  it("still rejects an unpinned action in a lite repo", () => {
    const unpinned = liteCiWorkflow("main").replace(
      /actions\/checkout@[0-9a-f]{40}/,
      "actions/checkout@v6",
    )
    expect(rules({ ...lite, ciWorkflow: Bun.YAML.parse(unpinned) })).toEqual(["ci"])
  })
})
