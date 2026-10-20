/**
 * Harness doctor, pure. The shell (commands/doctor.ts) reads the project's files and passes plain
 * data in. Each check returns findings; an empty list means every gate is present and wired.
 * Deleting a gate becomes a visible failure instead of silent drift.
 */
import { posix } from "node:path"
import { extractCanon } from "./canon.core"
import { type DeployMode, deployMode, releaseSpec } from "./new.core"
import { pascalCase } from "./slice.core"

export const HARNESS_PACKAGE = "@pierre-mike/axioms"
export const HARNESS_BIOME = `${HARNESS_PACKAGE}/biome`
export const HARNESS_LEFTHOOK = `node_modules/${HARNESS_PACKAGE}/harness/lefthook.yml`
export const HARNESS_TSCONFIG = `${HARNESS_PACKAGE}/tsconfig`
export const TSCONFIG_BASE = "tsconfig.base.json"
export const CLAUDE_SETTINGS = ".claude/settings.json"
export const CLAUDE_SKILLS_DIR = ".claude/skills"
/** The `id:` of the CI step v0.10.0 and v0.11.0 needed to fetch the then-private harness. */
export const HARNESS_ACCESS_ID = "harness-access"
/** The workflow that deploys main. It lives outside ci.yml, which `axioms ci-dry-run` replays. */
export const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml"

export interface Finding {
  readonly rule: string
  readonly problem: string
  readonly remedy: string
}

export interface DoctorInput {
  readonly canon: string
  readonly biome: unknown
  /** The parsed lefthook.yml: `null` when the file is missing, `undefined` when it is not valid YAML. */
  readonly lefthook: unknown
  /** The parsed harness/lefthook.yml the project extends (`null` when missing). */
  readonly harnessLefthook: unknown
  readonly agentsMd: string | null
  readonly claudeMd: string | null
  /** harness/notes.md, and the project's copy at .agents/notes/README.md (`null` when missing). */
  readonly notesRules: string
  readonly notesReadme: string | null
  /** harness/claude.settings.json, and the project's copy at .claude/settings.json (`null` when missing). */
  readonly harnessSettings: string
  readonly claudeSettings: string | null
  /** Each file of harness/skills/, with the project's copy at .claude/skills/<path> (`null` when missing). */
  readonly skillCopies: ReadonlyArray<{
    readonly path: string
    readonly harness: string
    readonly project: string | null
  }>
  readonly pkg: unknown
  readonly workspaceDirs: ReadonlyArray<string>
  readonly tsconfigReferences: ReadonlyArray<string>
  /**
   * tsconfig.base.json and each workspace's tsconfig.json, parsed as JSONC (paths relative to the
   * project root). `config` is `null` when the file is missing or not valid JSONC.
   */
  readonly tsconfigs: ReadonlyArray<{ readonly path: string; readonly config: unknown }>
  /** Every biome.json or biome.jsonc below the project root (paths relative to it). */
  readonly nestedBiomeConfigs: ReadonlyArray<string>
  /** The parsed ci.yml: `null` when the file is missing, `undefined` when it is not valid YAML. */
  readonly ciWorkflow: unknown
  /** The parsed deploy.yml: `null` when the file is missing, `undefined` when it is not valid YAML. */
  readonly deployWorkflow: unknown
  readonly featureNames: ReadonlyArray<string>
  readonly smokeFiles: ReadonlyArray<string>
  readonly allowlistedTags: ReadonlyArray<string>
  /** Every .ts file under apps/server/src, paths relative to it (`platform/http.ts` included). */
  readonly serverSources: ReadonlyArray<{ readonly path: string; readonly text: string }>
  /** The `effect` version range each workspace declares, e.g. `{ workspace: "shared", range: "^4.0.4" }`. */
  readonly effectRanges: ReadonlyArray<{ readonly workspace: string; readonly range: string }>
  /** Set by the factory's own self-test (AXIOMS_ALLOW_LOCAL_HARNESS=1), which tests an unreleased harness. */
  readonly allowLocalHarness: boolean
  /** The installed harness version, so a remedy can name the exact release to pin. */
  readonly harnessVersion: string
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const field = (input: { readonly value: unknown; readonly key: string }): unknown =>
  isRecord(input.value) ? input.value[input.key] : undefined

/**
 * Which shape of project the harness is wired into. The app template records nothing and gets
 * every check. `axioms adopt` records `"axioms": { "profile": "lite" }` in package.json: the
 * doctor then checks the gates the lite harness installs (lint, hooks, agent docs, notes, the
 * Claude Code settings and skills, the pinned package, must-pass `check`, `secret-scan` and
 * `pr-body` steps in CI) and skips the app-shaped ones (smoke, deploy, the tsconfig chain,
 * workspace references, Effect). Losing the marker makes the doctor stricter, never quieter.
 */
export type HarnessProfile = "app" | "lite"

export const harnessProfile = (pkg: unknown): HarnessProfile =>
  field({ value: field({ value: pkg, key: "axioms" }), key: "profile" }) === "lite" ? "lite" : "app"

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

const BIOME_KEYS_ALLOWED = new Set(["$schema", "extends", "files", "vcs"])

/** The only `files.includes` a project may set: everything, minus build output and generated code. */
export const BIOME_FILE_INCLUDES: ReadonlyArray<string> = [
  "**",
  "!**/dist",
  "!**/node_modules",
  "!**/.wrangler",
  "!**/routeTree.gen.ts",
]

const checkBiomeFiles = (files: unknown): Finding[] => {
  if (files === undefined) return []
  const includes = field({ value: files, key: "includes" })
  const extraKeys = isRecord(files) ? Object.keys(files).filter((key) => key !== "includes") : []
  const entries = strings(includes)
  const narrowing = entries.filter((entry) => !BIOME_FILE_INCLUDES.includes(entry))
  const valid =
    isRecord(files) &&
    extraKeys.length === 0 &&
    Array.isArray(includes) &&
    entries.length === includes.length &&
    entries.includes("**") &&
    narrowing.length === 0
  return valid
    ? []
    : [
        {
          rule: "biome",
          problem: `biome.json narrows which files are linted${narrowing.length > 0 ? ` (${narrowing.join(", ")})` : ""}`,
          remedy:
            "run `bunx axioms sync`; ignore generated files through .gitignore, or add the path to BIOME_FILE_INCLUDES in the factory",
        },
      ]
}

const checkBiome = (input: {
  readonly biome: unknown
  readonly nestedConfigs: ReadonlyArray<string>
}): Finding[] => {
  const nested = input.nestedConfigs.map((path) => ({
    rule: "biome",
    problem: `${path} is a nested Biome config, which can change the rules for its folder`,
    remedy: `delete ${path}; change the rule in the harness (factory/harness/biome.rules.ts) instead`,
  }))
  const biome = input.biome
  if (!isRecord(biome)) {
    return [
      {
        rule: "biome",
        problem: "biome.json is missing or not valid JSON",
        remedy: "run `bunx axioms sync`",
      },
      ...nested,
    ]
  }
  const findings: Finding[] = [...nested]
  const extended = strings(biome.extends)
  if (extended.length !== 1 || extended[0] !== HARNESS_BIOME) {
    findings.push({
      rule: "biome",
      problem: `biome.json must extend ${HARNESS_BIOME} and nothing else (found: ${extended.join(", ") || "none"})`,
      remedy: "run `bunx axioms sync`",
    })
  }
  findings.push(...checkBiomeFiles(biome.files))
  const extra = Object.keys(biome).filter((key) => !BIOME_KEYS_ALLOWED.has(key))
  if (extra.length > 0) {
    findings.push({
      rule: "biome",
      problem: `biome.json sets ${extra.join(", ")}, which can weaken the shared rules`,
      remedy: "change the rule in the harness (factory/harness/biome.rules.ts) instead",
    })
  }
  return findings
}

const checkLefthook = (lefthook: unknown): Finding[] => {
  if (strings(field({ value: lefthook, key: "extends" })).includes(HARNESS_LEFTHOOK)) return []
  const problem =
    lefthook === null
      ? "lefthook.yml is missing"
      : lefthook === undefined
        ? "lefthook.yml is not valid YAML"
        : `lefthook.yml does not extend ${HARNESS_LEFTHOOK}`
  return [{ rule: "hooks", problem, remedy: "run `bunx axioms sync`" }]
}

/**
 * Jobs the harness pre-push hook must run, and that a project's lefthook.yml may not skip or
 * redefine. Merged by name, a local `pre-push` job called `e2e` would replace the harness one.
 */
const PRE_PUSH_GATES = ["e2e"]

const hookJobs = (input: { readonly config: unknown; readonly hook: string }) => {
  const jobs = field({ value: field({ value: input.config, key: input.hook }), key: "jobs" })
  return Array.isArray(jobs) ? jobs.filter(isRecord) : []
}

const checkPrePush = (input: DoctorInput): Finding[] => {
  const harnessJobs = hookJobs({ config: input.harnessLefthook, hook: "pre-push" })
  const missing = PRE_PUSH_GATES.filter(
    (gate) =>
      !harnessJobs.some(
        (job) =>
          job.skip === undefined &&
          job.only === undefined &&
          typeof job.run === "string" &&
          runsGate({ run: job.run, gate }),
      ),
  ).map((gate) => ({
    rule: "hooks",
    problem: `the harness pre-push hook never runs \`axioms ${gate}\``,
    remedy: `restore the \`${gate}\` job in harness/lefthook.yml in the factory, then reinstall the harness`,
  }))
  const local = field({ value: input.lefthook, key: "pre-push" })
  const commands = field({ value: local, key: "commands" })
  const skipped = (field({ value: local, key: "skip" }) ?? false) !== false
  const redefined = PRE_PUSH_GATES.filter(
    (gate) =>
      hookJobs({ config: input.lefthook, hook: "pre-push" }).some((job) => job.name === gate) ||
      field({ value: commands, key: gate }) !== undefined,
  )
  const overrides = [
    ...(skipped ? ["lefthook.yml skips the pre-push hook"] : []),
    ...redefined.map((gate) => `lefthook.yml redefines the pre-push \`${gate}\` job`),
  ].map((problem) => ({ rule: "hooks", problem, remedy: "run `bunx axioms sync`" }))
  return [...missing, ...overrides]
}

const checkAgentDocs = (input: DoctorInput): Finding[] => {
  const findings: Finding[] = []
  const copy = input.agentsMd === null ? undefined : extractCanon(input.agentsMd)
  if (copy !== input.canon.trim()) {
    findings.push({
      rule: "canon",
      problem: "the rules in AGENTS.md differ from the installed harness",
      remedy: "run `bunx axioms sync` (edit harness/canon.md in the factory to change a rule)",
    })
  }
  if (input.claudeMd === null || !input.claudeMd.includes("@AGENTS.md")) {
    findings.push({
      rule: "canon",
      problem: "CLAUDE.md does not import @AGENTS.md",
      remedy: "run `bunx axioms sync`",
    })
  }
  if (input.notesReadme !== input.notesRules) {
    findings.push({
      rule: "notes",
      problem:
        input.notesReadme === null
          ? ".agents/notes/README.md is missing, so agents have no Agent Note rules to follow"
          : "the Agent Note rules in .agents/notes/README.md differ from the installed harness",
      remedy: "run `bunx axioms sync` (edit harness/notes.md in the factory to change a rule)",
    })
  }
  return findings
}

/** The Claude Code settings and skills are whole-file harness copies, like the notes README: a local edit is drift. */
const checkClaudeConfig = (input: DoctorInput): Finding[] => {
  const settings: Finding[] =
    input.claudeSettings === input.harnessSettings
      ? []
      : [
          {
            rule: "settings",
            problem:
              input.claudeSettings === null
                ? `${CLAUDE_SETTINGS} is missing, so agents run the gates without the shared permission allowlist`
                : `${CLAUDE_SETTINGS} differs from the installed harness`,
            remedy:
              "run `bunx axioms sync` (edit harness/claude.settings.json in the factory; personal settings go in .claude/settings.local.json)",
          },
        ]
  const skills = input.skillCopies
    .filter((copy) => copy.project !== copy.harness)
    .map((copy) => ({
      rule: "skills",
      problem:
        copy.project === null
          ? `${CLAUDE_SKILLS_DIR}/${copy.path} is missing`
          : `${CLAUDE_SKILLS_DIR}/${copy.path} differs from the installed harness`,
      remedy: "run `bunx axioms sync` (edit harness/skills/ in the factory to change a skill)",
    }))
  return [...settings, ...skills]
}

const LOCAL_SPEC = /^(file|link|portal|workspace):/
/** The spec v0.10.0 and v0.11.0 pinned: git needs an SSH key or a token to fetch it. */
const SSH_SPEC = /^git\+ssh:\/\/git@github\.com\/Pierre-Mike\/factory\b/

const checkPackage = (input: {
  readonly pkg: unknown
  readonly allowLocalHarness: boolean
  readonly harnessVersion: string
}): Finding[] => {
  // Not published to npm: a bare `bun add -d @pierre-mike/axioms` fails with a 404.
  const pinned = releaseSpec(input.harnessVersion)
  const findings: Finding[] = []
  const devDeps = field({ value: input.pkg, key: "devDependencies" })
  const spec = field({ value: devDeps, key: HARNESS_PACKAGE })
  if (spec === undefined) {
    findings.push({
      rule: "package",
      problem: `${HARNESS_PACKAGE} is not a devDependency`,
      remedy: `bun add -d ${HARNESS_PACKAGE}@${pinned}`,
    })
  } else if (typeof spec === "string" && LOCAL_SPEC.test(spec) && !input.allowLocalHarness) {
    findings.push({
      rule: "package",
      problem: `${HARNESS_PACKAGE} is pinned to a local path (${spec}), which a CI runner cannot install`,
      remedy: `pin a released tag: bun add -d ${HARNESS_PACKAGE}@${pinned}`,
    })
  } else if (typeof spec === "string" && SSH_SPEC.test(spec)) {
    findings.push({
      rule: "package",
      problem: `${HARNESS_PACKAGE} is pinned as ${spec}, which needs an SSH key or a token to install`,
      remedy: `the harness is public: bun add -d ${HARNESS_PACKAGE}@${pinned}`,
    })
  }
  const scripts = field({ value: input.pkg, key: "scripts" })
  const required: ReadonlyArray<readonly [string, string]> =
    harnessProfile(input.pkg) === "lite"
      ? [["check", "axioms check"]]
      : [
          ["check", "axioms check"],
          ["smoke", "axioms smoke"],
        ]
  for (const [name, command] of required) {
    if (field({ value: scripts, key: name }) !== command) {
      findings.push({
        rule: "package",
        problem: `package.json script "${name}" is not "${command}"`,
        remedy: `set "${name}": "${command}"`,
      })
    }
  }
  return findings
}

const checkTypecheckGraph = (input: DoctorInput): Finding[] => {
  const refs = new Set(input.tsconfigReferences.map((ref) => ref.replace(/^\.\//, "")))
  return input.workspaceDirs
    .filter((dir) => !refs.has(dir))
    .map((dir) => ({
      rule: "typecheck",
      problem: `workspace ${dir} is not referenced from tsconfig.json, so tsc -b never checks it`,
      remedy: `add { "path": "./${dir}" } to tsconfig.json references`,
    }))
}

/**
 * Checks the harness tsconfig turns on. Setting one to false is how a type error gets "fixed"
 * without fixing the code, so it gets the same treatment as a suppression comment.
 */
const STRICT_FLAGS = [
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "strictBuiltinIteratorReturn",
  "noImplicitThis",
  "useUnknownInCatchVariables",
  "alwaysStrict",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
]

const extendsOf = (config: unknown): string[] => {
  const value = field({ value: config, key: "extends" })
  return typeof value === "string" ? [value] : strings(value)
}

/** A workspace inherits the harness through the root tsconfig.base.json, or by extending it directly. */
const reachesHarness = (input: { readonly path: string; readonly config: unknown }) =>
  extendsOf(input.config).some(
    (ext) =>
      ext === HARNESS_TSCONFIG ||
      (input.path !== TSCONFIG_BASE &&
        posix.normalize(posix.join(posix.dirname(input.path), ext)) === TSCONFIG_BASE),
  )

const checkTsconfigs = (
  tsconfigs: ReadonlyArray<{ readonly path: string; readonly config: unknown }>,
): Finding[] =>
  tsconfigs.flatMap(({ path, config }): Finding[] => {
    if (config === null) {
      return [
        {
          rule: "typecheck",
          problem: `${path} is missing or not valid JSONC`,
          remedy: "restore it from the factory template",
        },
      ]
    }
    const findings: Finding[] = []
    if (!reachesHarness({ path, config })) {
      const target =
        path === TSCONFIG_BASE
          ? HARNESS_TSCONFIG
          : posix.relative(posix.dirname(path), TSCONFIG_BASE)
      findings.push({
        rule: "typecheck",
        problem: `${path} does not extend ${target}, so the harness compiler options do not apply`,
        remedy: `set "extends": "${target}"`,
      })
    }
    const options = field({ value: config, key: "compilerOptions" })
    const loosened = STRICT_FLAGS.filter((flag) => field({ value: options, key: flag }) === false)
    if (loosened.length > 0) {
      findings.push({
        rule: "typecheck",
        problem: `${path} turns off ${loosened.join(", ")}, which the harness turns on`,
        remedy: "remove the override and fix the type errors it was hiding",
      })
    }
    return findings
  })

/**
 * The gates CI must run as must-pass steps. A lite repo has no worker to smoke, deploy or open in a
 * browser (e2e), but the secret scan and the PR body contract are not app-shaped: `axioms adopt`
 * stamps both jobs.
 */
const CI_GATES: Record<HarnessProfile, ReadonlyArray<string>> = {
  app: ["check", "smoke", "deploy --dry-run", "lint-workflows", "secret-scan", "pr-body", "e2e"],
  lite: ["check", "secret-scan", "pr-body"],
}
const PINNED_USES = /^([^\s@]+@[0-9a-f]{40}|\.\/.*)$/

/** A step or job that may be skipped, or may fail without failing CI, does not count as a gate. */
const optional = (node: Record<string, unknown>) =>
  node.if !== undefined || (node["continue-on-error"] ?? false) !== false

/** A `run:` line that is exactly the gate, so `|| true` or an `echo` does not count. */
const runsGate = (input: { readonly run: string; readonly gate: string }) =>
  input.run
    .split("\n")
    .map((line) => line.trim().replace(/^(bunx|bun x)\s+/, ""))
    .includes(`axioms ${input.gate}`)

const checkCi = (input: { readonly ci: unknown; readonly profile: HarnessProfile }): Finding[] => {
  const ci = input.ci
  if (ci === null || ci === undefined) {
    return [
      {
        rule: "ci",
        problem: `.github/workflows/ci.yml is ${ci === null ? "missing" : "not valid YAML"}`,
        remedy:
          input.profile === "lite"
            ? "restore the workflow `axioms adopt` stamped: the check, secret-scan and pr-body jobs"
            : "copy it from the factory template",
      },
    ]
  }
  const jobsField = field({ value: ci, key: "jobs" })
  const jobs = isRecord(jobsField) ? Object.values(jobsField).filter(isRecord) : []
  const steps = jobs.flatMap((job) =>
    (Array.isArray(job.steps) ? job.steps : [])
      .filter(isRecord)
      .map((step) => ({ step, counts: !optional(job) && !optional(step) })),
  )
  const findings: Finding[] = CI_GATES[input.profile]
    .filter(
      (gate) =>
        !steps.some(
          ({ step, counts }) =>
            counts && typeof step.run === "string" && runsGate({ run: step.run, gate }),
        ),
    )
    .map((gate) => ({
      rule: "ci",
      problem: `ci.yml never runs \`axioms ${gate}\` as a step that must pass`,
      remedy: `add a step \`run: bunx axioms ${gate}\` with no if: or continue-on-error:`,
    }))
  for (const [name, job] of isRecord(jobsField) ? Object.entries(jobsField) : []) {
    const jobSteps = isRecord(job) && Array.isArray(job.steps) ? job.steps.filter(isRecord) : []
    if (jobSteps.some((step) => step.id === HARNESS_ACCESS_ID)) {
      findings.push({
        rule: "ci",
        problem: `job ${name} still has the \`${HARNESS_ACCESS_ID}\` step from when the harness was private, which fails without the HARNESS_TOKEN secret`,
        remedy: `delete the \`id: ${HARNESS_ACCESS_ID}\` step, then the secret: gh secret delete HARNESS_TOKEN`,
      })
    }
  }
  const uses = [...jobs, ...steps.map(({ step }) => step)].flatMap((node) =>
    typeof node.uses === "string" ? [node.uses] : [],
  )
  for (const action of uses.filter((u) => !PINNED_USES.test(u))) {
    findings.push({
      rule: "ci",
      problem: `action not pinned to a commit SHA: ${action}`,
      remedy: "pin it to a full 40-character SHA with the version in a comment",
    })
  }
  return findings
}

const checkSmokeCoverage = (input: DoctorInput): Finding[] => {
  const smoke = new Set(input.smokeFiles)
  return input.featureNames
    .filter((name) => !smoke.has(`${name}.smoke.test.ts`))
    .map((name) => ({
      rule: "smoke",
      problem: `feature "${name}" has no smoke test, so nothing checks it over real HTTP`,
      remedy: `add apps/server/smoke/${name}.smoke.test.ts`,
    }))
}

/** The file that holds STATUS_BY_TAG, relative to apps/server/src. */
export const HTTP_BOUNDARY = "platform/http.ts"

const ALLOWLIST_LITERAL = /STATUS_BY_TAG[^=]*=\s*\{[^}]*\}/

/**
 * The code that can create a tag: every non-test file, platform/http.ts included, minus the
 * STATUS_BY_TAG literal itself, so an allowlist key never counts as its own definition.
 */
const tagSource = (sources: DoctorInput["serverSources"]): string =>
  sources
    .filter((file) => !file.path.endsWith(".test.ts"))
    .map((file) =>
      file.path === HTTP_BOUNDARY ? file.text.replace(ALLOWLIST_LITERAL, "") : file.text,
    )
    .join("\n")

const checkAllowlist = (input: DoctorInput): Finding[] => {
  const source = tagSource(input.serverSources)
  return input.allowlistedTags
    .filter((tag) => !source.includes(`"${tag}"`))
    .map((tag) => ({
      rule: "errors",
      problem: `STATUS_BY_TAG allowlists "${tag}", but no code under apps/server/src creates it`,
      remedy: allowlistRemedy({ tag, featureNames: input.featureNames }),
    }))
}

/**
 * `axioms slice <name>` registers `Invalid<Name>Id` for its stub core. Once that tag is orphaned,
 * the fix is to remove it, so say which slice left it. Any other orphan may be a tag still to write.
 */
const allowlistRemedy = (input: {
  readonly tag: string
  readonly featureNames: ReadonlyArray<string>
}): string => {
  const remove = `remove ${input.tag} from STATUS_BY_TAG in ${HTTP_BOUNDARY}`
  const slice = input.featureNames.find((name) => input.tag === `Invalid${pascalCase(name)}Id`)
  return slice === undefined
    ? `create the tag ({ _tag: "${input.tag}" }) where that failure happens, or ${remove}`
    : `${remove}: \`axioms slice ${slice}\` added it for the stub core, which no longer uses it`
}

/** The canon and the generated code are written for this Effect major (Result, Context.Service). */
export const EFFECT_MAJOR = 4

const checkEffectMajor = (input: DoctorInput): Finding[] =>
  input.effectRanges
    .filter(({ range }) => !new RegExp(`^[~^]?${EFFECT_MAJOR}\\.`).test(range))
    .map(({ workspace, range }) => ({
      rule: "effect",
      problem: `${workspace} depends on effect ${range}, but the harness targets Effect ${EFFECT_MAJOR}`,
      remedy: `set "effect": "^${EFFECT_MAJOR}.x" and migrate (Either -> Result, Context.Tag -> Context.Service)`,
    }))

export const runDoctor = (input: DoctorInput): Finding[] => {
  const profile = harnessProfile(input.pkg)
  const app = profile === "app"
  return [
    ...checkBiome({ biome: input.biome, nestedConfigs: input.nestedBiomeConfigs }),
    ...checkLefthook(input.lefthook),
    ...checkPrePush(input),
    ...checkAgentDocs(input),
    ...checkClaudeConfig(input),
    ...checkPackage(input),
    ...(app ? checkTypecheckGraph(input) : []),
    ...(app ? checkTsconfigs(input.tsconfigs) : []),
    ...checkCi({ ci: input.ciWorkflow, profile }),
    ...(app ? checkSmokeCoverage(input) : []),
    ...(app ? checkAllowlist(input) : []),
    ...(app ? checkEffectMajor(input) : []),
    ...(app ? checkDeploy({ workflow: input.deployWorkflow, mode: deployMode(input.pkg) }) : []),
  ]
}

/** Pull the tag names out of `const STATUS_BY_TAG ... = { Tag: 400, ... }`. */
export const parseAllowlistedTags = (httpSource: string): string[] => {
  const block = httpSource.match(/STATUS_BY_TAG[^=]*=\s*\{([^}]*)\}/)
  if (!block?.[1]) return []
  return [...block[1].matchAll(/"?(\w+)"?\s*:\s*\d{3}/g)].flatMap((m) => (m[1] ? [m[1]] : []))
}

/** The events a workflow's `on:` names, in its string, list or mapping form. */
const triggers = (workflow: unknown): string[] => {
  const on = field({ value: workflow, key: "on" })
  if (typeof on === "string") return [on]
  return isRecord(on) ? Object.keys(on) : strings(on)
}

const triggerFinding = (input: {
  readonly events: ReadonlyArray<string>
  readonly mode: DeployMode
}): Finding[] => {
  const push = input.events.includes("push")
  const remedy = 'set `on:` as the template does, or change "axioms": { "deploy" } in package.json'
  if (input.mode === "push" && !push) {
    return [
      {
        rule: "deploy",
        problem: "package.json declares deploy on push, but deploy.yml has no push trigger",
        remedy: `${remedy} to "manual"`,
      },
    ]
  }
  if (input.mode === "manual" && push) {
    return [
      {
        rule: "deploy",
        problem: 'package.json declares "deploy": "manual", but deploy.yml deploys on push',
        remedy: `remove \`push:\` from \`on:\` in deploy.yml, or delete "deploy" from "axioms" in package.json`,
      },
    ]
  }
  if (input.mode === "manual" && !input.events.includes("workflow_dispatch")) {
    return [
      {
        rule: "deploy",
        problem:
          "deploy.yml is manual-only but has no workflow_dispatch trigger, so nothing starts it",
        remedy: "add `workflow_dispatch:` under `on:` in deploy.yml",
      },
    ]
  }
  return []
}

/**
 * deploy.yml must run `axioms deploy` as a step that cannot be skipped or fail quietly, with the
 * trigger package.json declares: on push to main by default, by hand only for `"deploy": "manual"`.
 */
const checkDeploy = (input: {
  readonly workflow: unknown
  readonly mode: DeployMode
}): Finding[] => {
  const workflow = input.workflow
  if (workflow === null || workflow === undefined) {
    return [
      {
        rule: "deploy",
        problem:
          workflow === null
            ? `${DEPLOY_WORKFLOW} is missing, so nothing deploys main`
            : `${DEPLOY_WORKFLOW} is not valid YAML`,
        remedy:
          workflow === null
            ? "run `bunx axioms sync`"
            : "fix it, or delete it and run `bunx axioms sync`",
      },
    ]
  }
  const jobsField = field({ value: workflow, key: "jobs" })
  const jobs = isRecord(jobsField) ? Object.values(jobsField).filter(isRecord) : []
  const deploys = jobs.some(
    (job) =>
      !optional(job) &&
      (Array.isArray(job.steps) ? job.steps : [])
        .filter(isRecord)
        .some(
          (step) =>
            !optional(step) &&
            typeof step.run === "string" &&
            runsGate({ run: step.run, gate: "deploy" }),
        ),
  )
  const gate: Finding[] = deploys
    ? []
    : [
        {
          rule: "deploy",
          problem: "deploy.yml never runs `axioms deploy` as a step that must pass",
          remedy: "add a step `run: bunx axioms deploy` with no if: or continue-on-error:",
        },
      ]
  return [...gate, ...triggerFinding({ events: triggers(workflow), mode: input.mode })]
}

/** Every string a parsed workflow holds, depth first, in document order. */
const allStrings = (value: unknown): string[] => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(allStrings)
  return isRecord(value) ? Object.values(value).flatMap(allStrings) : []
}

/** `GITHUB_TOKEN` is provided by Actions on every run; nobody sets it. */
const SECRET_REF = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** The secrets deploy.yml reads (`${{ secrets.NAME }}`), so the doctor checks what it uses. */
export const deploySecretNames = (workflow: unknown): string[] => [
  ...new Set(
    allStrings(workflow)
      .flatMap((text) => [...text.matchAll(SECRET_REF)].map((match) => match[1] ?? ""))
      .filter((name) => name !== "" && name !== "GITHUB_TOKEN"),
  ),
]

/** The environments deploy.yml's jobs run in (`environment: x` or `environment: { name: x }`). */
export const deployEnvironments = (workflow: unknown): string[] => {
  const jobs = field({ value: workflow, key: "jobs" })
  const names = (isRecord(jobs) ? Object.values(jobs) : []).map((job) => {
    const env = field({ value: job, key: "environment" })
    return typeof env === "string" ? env : field({ value: env, key: "name" })
  })
  return [...new Set(names.filter((n): n is string => typeof n === "string" && !n.includes("${{")))]
}

/** What the shell could read of the repo's secret names through `gh secret list`, or why not. */
export type SecretsState =
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "live"
      readonly repository: ReadonlyArray<string>
      /** `secrets` is `null` for an environment GitHub does not have yet (it 404s until created). */
      readonly environments: ReadonlyArray<{
        readonly name: string
        readonly secrets: ReadonlyArray<string> | null
      }>
    }

/** Advice the doctor prints without failing: warnings, and what it could not verify. */
export interface Advisory {
  readonly warnings: ReadonlyArray<Finding>
  readonly unverified: ReadonlyArray<string>
}

/**
 * A missing deploy secret warns and never fails: a new project has none until its first deploy,
 * and the doctor runs in every `check`, pre-commit hook and CI run. Unreadable secrets (no remote,
 * no gh, no permission) are reported as not verified, as the branch-protection check does.
 */
export const checkDeploySecrets = (input: {
  readonly required: ReadonlyArray<string>
  readonly state: SecretsState
}): Advisory => {
  if (input.required.length === 0) return { warnings: [], unverified: [] }
  const state = input.state
  if (state.kind === "unavailable") {
    return {
      warnings: [],
      unverified: [`– [secrets] ${input.required.join(", ")} not verified: ${state.reason}`],
    }
  }
  const present = new Set([
    ...state.repository,
    ...state.environments.flatMap((env) => env.secrets ?? []),
  ])
  const where = [
    "a repository secret",
    ...state.environments.map((env) => `a secret of environment ${env.name}`),
  ].join(" or ")
  return {
    warnings: input.required
      .filter((name) => !present.has(name))
      .map((name) => ({
        rule: "secrets",
        problem: `${name} is not ${where}, so \`axioms deploy\` in deploy.yml cannot authenticate`,
        remedy: `gh secret set ${name}`,
      })),
    unverified: [],
  }
}

/** `axioms doctor --json`: failures fail the doctor; warnings and unverified checks never do. */
export const doctorReport = (
  input: { readonly failures: ReadonlyArray<Finding> } & Advisory,
): { readonly pass: boolean; readonly failures: ReadonlyArray<Finding> } & Advisory => ({
  pass: input.failures.length === 0,
  failures: input.failures,
  warnings: input.warnings,
  unverified: input.unverified,
})

export const DOCTOR_USAGE = "usage: axioms doctor [--json]"

export const parseDoctorArgs = (
  args: ReadonlyArray<string>,
):
  | { readonly ok: true; readonly json: boolean }
  | { readonly ok: false; readonly error: string } => {
  const unknown = args.find((arg) => arg !== "--json")
  return unknown === undefined
    ? { ok: true, json: args.length > 0 }
    : { ok: false, error: `unexpected argument ${unknown}\n${DOCTOR_USAGE}` }
}
