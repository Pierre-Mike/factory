/**
 * Harness doctor, pure. The shell (commands/doctor.ts) reads the project's files and passes plain
 * data in. Each check returns findings; an empty list means every gate is present and wired.
 * Deleting a gate becomes a visible failure instead of silent drift.
 */
import { extractCanon } from "./canon.core"

export const HARNESS_PACKAGE = "@pierre-mike/axioms"
export const HARNESS_BIOME = `${HARNESS_PACKAGE}/biome`
export const HARNESS_LEFTHOOK = `node_modules/${HARNESS_PACKAGE}/harness/lefthook.yml`

export interface Finding {
  readonly rule: string
  readonly problem: string
  readonly remedy: string
}

export interface DoctorInput {
  readonly canon: string
  readonly biome: unknown
  readonly lefthook: unknown
  readonly agentsMd: string | null
  readonly claudeMd: string | null
  readonly pkg: unknown
  readonly workspaceDirs: ReadonlyArray<string>
  readonly tsconfigReferences: ReadonlyArray<string>
  readonly ciWorkflow: string | null
  readonly featureNames: ReadonlyArray<string>
  readonly smokeFiles: ReadonlyArray<string>
  readonly allowlistedTags: ReadonlyArray<string>
  readonly featureSource: string
  /** The `effect` version range each workspace declares, e.g. `{ workspace: "shared", range: "^4.0.4" }`. */
  readonly effectRanges: ReadonlyArray<{ readonly workspace: string; readonly range: string }>
  /** Set by the factory's own self-test (AXIOMS_ALLOW_LOCAL_HARNESS=1), which tests an unreleased harness. */
  readonly allowLocalHarness: boolean
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const field = (input: { readonly value: unknown; readonly key: string }): unknown =>
  isRecord(input.value) ? input.value[input.key] : undefined

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

const BIOME_KEYS_ALLOWED = new Set(["$schema", "extends", "files", "vcs"])

const checkBiome = (biome: unknown): Finding[] => {
  if (!isRecord(biome)) {
    return [
      {
        rule: "biome",
        problem: "biome.json is missing or not valid JSON",
        remedy: "run `bunx axioms sync`",
      },
    ]
  }
  const findings: Finding[] = []
  if (!strings(biome.extends).includes(HARNESS_BIOME)) {
    findings.push({
      rule: "biome",
      problem: `biome.json does not extend ${HARNESS_BIOME}`,
      remedy: "run `bunx axioms sync`",
    })
  }
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

const checkLefthook = (lefthook: unknown): Finding[] =>
  strings(field({ value: lefthook, key: "extends" })).includes(HARNESS_LEFTHOOK)
    ? []
    : [
        {
          rule: "hooks",
          problem: `lefthook.yml does not extend ${HARNESS_LEFTHOOK}`,
          remedy: "run `bunx axioms sync`",
        },
      ]

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
  return findings
}

const LOCAL_SPEC = /^(file|link|portal|workspace):/

const checkPackage = (input: {
  readonly pkg: unknown
  readonly allowLocalHarness: boolean
}): Finding[] => {
  const findings: Finding[] = []
  const devDeps = field({ value: input.pkg, key: "devDependencies" })
  const spec = field({ value: devDeps, key: HARNESS_PACKAGE })
  if (spec === undefined) {
    findings.push({
      rule: "package",
      problem: `${HARNESS_PACKAGE} is not a devDependency`,
      remedy: `bun add -d ${HARNESS_PACKAGE}`,
    })
  } else if (typeof spec === "string" && LOCAL_SPEC.test(spec) && !input.allowLocalHarness) {
    findings.push({
      rule: "package",
      problem: `${HARNESS_PACKAGE} is pinned to a local path (${spec}), which a CI runner cannot install`,
      remedy: `pin a released tag: "github:Pierre-Mike/factory#vX.Y.Z"`,
    })
  }
  const scripts = field({ value: input.pkg, key: "scripts" })
  for (const [name, command] of [
    ["check", "axioms check"],
    ["smoke", "axioms smoke"],
  ] as const) {
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

const PINNED_USES = /uses:\s*[^\s@]+@[0-9a-f]{40}\b/
const checkCi = (ci: string | null): Finding[] => {
  if (ci === null) {
    return [
      {
        rule: "ci",
        problem: ".github/workflows/ci.yml is missing",
        remedy: "copy it from the factory template",
      },
    ]
  }
  const findings: Finding[] = []
  for (const command of [
    "axioms check",
    "axioms smoke",
    "axioms deploy --dry-run",
    "axioms lint-workflows",
  ]) {
    if (!ci.includes(command)) {
      findings.push({
        rule: "ci",
        problem: `ci.yml never runs \`${command}\``,
        remedy: `add a job that runs \`bunx ${command}\``,
      })
    }
  }
  const unpinned = ci
    .split("\n")
    .filter((line) => /^\s*-?\s*uses:/.test(line) && !PINNED_USES.test(line))
  for (const line of unpinned) {
    findings.push({
      rule: "ci",
      problem: `action not pinned to a commit SHA: ${line.trim()}`,
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

const checkAllowlist = (input: DoctorInput): Finding[] =>
  input.allowlistedTags
    .filter((tag) => !input.featureSource.includes(`"${tag}"`))
    .map((tag) => ({
      rule: "errors",
      problem: `STATUS_BY_TAG allowlists "${tag}", but no feature code defines it`,
      remedy: `remove ${tag} from platform/http.ts`,
    }))

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

export const runDoctor = (input: DoctorInput): Finding[] => [
  ...checkBiome(input.biome),
  ...checkLefthook(input.lefthook),
  ...checkAgentDocs(input),
  ...checkPackage(input),
  ...checkTypecheckGraph(input),
  ...checkCi(input.ciWorkflow),
  ...checkSmokeCoverage(input),
  ...checkAllowlist(input),
  ...checkEffectMajor(input),
]

/** Pull the tag names out of `const STATUS_BY_TAG ... = { Tag: 400, ... }`. */
export const parseAllowlistedTags = (httpSource: string): string[] => {
  const block = httpSource.match(/STATUS_BY_TAG[^=]*=\s*\{([^}]*)\}/)
  if (!block?.[1]) return []
  return [...block[1].matchAll(/(\w+)\s*:\s*\d{3}/g)].flatMap((m) => (m[1] ? [m[1]] : []))
}
