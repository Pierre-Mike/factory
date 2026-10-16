/**
 * CI dry run, pure. Decides whether a push touches CI/CD, and turns a GitHub Actions workflow into
 * a plan the shell can replay in a clean clone: `run:` steps execute as written, the few actions
 * the clean clone already stands in for are skipped with a reason, and anything else makes the
 * plan unsimulatable. An unsimulatable step fails the dry run: a gate that cannot run must not pass.
 */
import { isRecord } from "./doctor.core"

/** Files whose change can break CI or a deploy without breaking `axioms check` locally. */
const CI_CD_FILES = [
  /^\.github\//,
  /(^|\/)package\.json$/,
  /^bun\.lock$/,
  /^\.bun-version$/,
  /^lefthook\.yml$/,
  /^biome\.json$/,
  /(^|\/)tsconfig(\.base)?\.json$/,
  /(^|\/)wrangler\.jsonc?$/,
  /(^|\/)migrations\//,
  /(^|\/)vite\.config\.ts$/,
  /^\.fallowrc\.json$/,
]

/** The changed files that require a dry run; empty means the push can skip it. */
export const ciCdChanges = (changedFiles: ReadonlyArray<string>): string[] =>
  changedFiles.filter((file) => CI_CD_FILES.some((pattern) => pattern.test(file)))

/**
 * What a replayed job keeps from the local environment: only what the tools need to start. A
 * runner has none of the developer's other variables, so a step that passes only because of one
 * (a token, a debug flag) must fail here too. AXIOMS_ALLOW_LOCAL_HARNESS passes through for the
 * factory's selftest, whose project pins an unreleased checkout that real CI could not install
 * anyway.
 */
const JOB_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "AXIOMS_ALLOW_LOCAL_HARNESS",
]

export const jobEnv = (
  local: Readonly<Record<string, string | undefined>>,
): Record<string, string> => ({
  ...Object.fromEntries(
    JOB_ENV_KEYS.flatMap((key) => {
      const value = local[key]
      return value === undefined ? [] : [[key, value] as const]
    }),
  ),
  CI: "true",
})

export type PlannedStep =
  | { readonly kind: "run"; readonly name: string; readonly run: string; readonly cwd: string }
  | { readonly kind: "provided"; readonly name: string; readonly reason: string }

export interface PlannedJob {
  readonly name: string
  readonly steps: ReadonlyArray<PlannedStep>
}

export interface Plan {
  readonly jobs: ReadonlyArray<PlannedJob>
  /** Steps the dry run cannot reproduce. Non-empty means the dry run fails. */
  readonly unsupported: ReadonlyArray<string>
  /** Differences worth reporting that do not fail the dry run. */
  readonly warnings: ReadonlyArray<string>
}

/** Actions the clean clone stands in for, with the reason the dry run may skip them. */
const PROVIDED: ReadonlyArray<readonly [RegExp, string]> = [
  [/^actions\/checkout@/, "the clean clone of HEAD is the checkout"],
  [/^oven-sh\/setup-bun@/, "uses the local bun"],
  [/^actions\/cache@/, "a cache only changes speed"],
]

/**
 * Keys that change how a `run:` step executes but that the replay does not apply. Ignoring them
 * would run the step in the wrong folder, shell or environment, and report a result CI would not.
 */
const IGNORED_KEYS = ["env", "shell", "defaults"] as const

/**
 * The keys of `node` the replay would ignore. `shell: bash` is not one: every step is replayed
 * with `bash --noprofile --norc -eo pipefail`, which is what GitHub runs for it.
 */
const ignoredKeys = (node: Record<string, unknown>): string[] =>
  IGNORED_KEYS.filter(
    (key) => node[key] !== undefined && !(key === "shell" && node[key] === "bash"),
  )

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const planStep = (input: {
  readonly job: string
  readonly index: number
  readonly step: unknown
  readonly localBun: string
}): { step?: PlannedStep; unsupported?: string; warning?: string } => {
  const step = isRecord(input.step) ? input.step : {}
  const uses = text(step.uses)
  const run = text(step.run)
  const name = text(step.name) ?? uses ?? run?.split("\n")[0] ?? `step ${input.index + 1}`
  const where = `${input.job} › ${name}`
  if (step.if !== undefined)
    return { unsupported: `${where}: conditional steps (if:) are not simulated` }
  if (uses !== undefined) {
    const provided = PROVIDED.find(([pattern]) => pattern.test(uses))
    if (provided === undefined)
      return { unsupported: `${where}: action ${uses} cannot be simulated` }
    const wanted = isRecord(step.with) ? text(step.with["bun-version"]) : undefined
    return {
      step: { kind: "provided", name, reason: provided[1] },
      ...(wanted !== undefined && wanted !== input.localBun
        ? { warning: `${where}: CI pins bun ${wanted}, local bun is ${input.localBun}` }
        : {}),
    }
  }
  if (run === undefined) return { unsupported: `${where}: step has neither run: nor uses:` }
  // Only run steps: a provided step is skipped, so its env: changes nothing.
  const ignored = ignoredKeys(step)
  if (ignored.length > 0)
    return {
      unsupported: `${where}: ${ignored.join(", ")} would be ignored, so it is not simulated`,
    }
  if (run.includes("${{")) return { unsupported: `${where}: \${{ }} expressions are not simulated` }
  return { step: { kind: "run", name, run, cwd: text(step["working-directory"]) ?? "." } }
}

export const planWorkflow = (input: {
  readonly workflow: unknown
  readonly localBun: string
}): Plan => {
  const jobs = isRecord(input.workflow) && isRecord(input.workflow.jobs) ? input.workflow.jobs : {}
  const unsupported: string[] = []
  const workflow = isRecord(input.workflow) ? input.workflow : {}
  const ignoredTop = ignoredKeys(workflow)
  if (ignoredTop.length > 0) {
    unsupported.push(`workflow: ${ignoredTop.join(", ")} would be ignored, so it is not simulated`)
  }
  const warnings: string[] = []
  const planned = Object.entries(jobs).map(([name, job]) => {
    const steps = isRecord(job) && Array.isArray(job.steps) ? job.steps : []
    if (isRecord(job) && (job.strategy !== undefined || job.services !== undefined)) {
      unsupported.push(`${name}: matrix strategies and services are not simulated`)
    }
    const ignoredJob = isRecord(job) ? ignoredKeys(job) : []
    if (ignoredJob.length > 0) {
      unsupported.push(`${name}: ${ignoredJob.join(", ")} would be ignored, so it is not simulated`)
    }
    return {
      name,
      steps: steps.flatMap((step, index) => {
        const result = planStep({ job: name, index, step, localBun: input.localBun })
        if (result.unsupported) unsupported.push(result.unsupported)
        if (result.warning) warnings.push(result.warning)
        return result.step ? [result.step] : []
      }),
    }
  })
  if (planned.length === 0) unsupported.push("the workflow has no jobs")
  return { jobs: planned, unsupported, warnings }
}
