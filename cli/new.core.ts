/**
 * `axioms new` argument handling, pure. Flags may come before or after the folder, and the harness
 * defaults to the release tag of the running version, so a generated project passes `axioms doctor`
 * (which rejects local paths) whether the CLI ran from node_modules or from a checkout.
 */

export const NEW_USAGE =
  "usage: axioms new <dir> [--harness <spec>] [--deploy push|manual] [--no-install]"

/**
 * When .github/workflows/deploy.yml runs: on every push to main (the default), or only when started
 * by hand (`workflow_dispatch`). Recorded in package.json as `"axioms": { "deploy": "manual" }`,
 * next to `profile`; push is the default and is not recorded. `axioms sync` reads it to write a
 * missing deploy.yml, and `axioms doctor` checks the workflow's trigger against it.
 */
export type DeployMode = "push" | "manual"

const DEPLOY_MODES: ReadonlyArray<DeployMode> = ["push", "manual"]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const deployMode = (pkg: unknown): DeployMode => {
  const settings = isRecord(pkg) ? pkg.axioms : undefined
  return isRecord(settings) && settings.deploy === "manual" ? "manual" : "push"
}

/** package.json with the mode recorded: `axioms.deploy` for manual, nothing for the push default. */
export const withDeployMode = (input: {
  readonly pkg: Record<string, unknown>
  readonly mode: DeployMode
}): Record<string, unknown> => {
  const { deploy: _, ...settings } = isRecord(input.pkg.axioms) ? input.pkg.axioms : {}
  const { axioms: __, ...rest } = input.pkg
  const next = input.mode === "manual" ? { ...settings, deploy: "manual" } : settings
  return Object.keys(next).length === 0 ? rest : { ...rest, axioms: next }
}

/** The template's trigger block; the manual variant keeps only its last line. */
const PUSH_TRIGGER = "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n"

/** template/.github/workflows/deploy.yml for the mode: as shipped for push, minus `push:` for manual. */
export const renderDeployWorkflow = (input: {
  readonly template: string
  readonly mode: DeployMode
}): string =>
  input.mode === "push"
    ? input.template
    : input.template.replace(PUSH_TRIGGER, "on:\n  workflow_dispatch:\n")

export interface NewArgs {
  readonly dir: string
  /** The harness spec to pin; undefined means the release tag (see `releaseSpec`). */
  readonly harness: string | undefined
  readonly install: boolean
  readonly deploy: DeployMode
}

export type ParsedNewArgs =
  | { readonly ok: true; readonly args: NewArgs }
  | { readonly ok: false; readonly error: string }

const failure = (error: string): ParsedNewArgs => ({ ok: false, error: `${error}\n${NEW_USAGE}` })

export const parseNewArgs = (args: ReadonlyArray<string>): ParsedNewArgs => {
  const positional: string[] = []
  let harness: string | undefined
  let install = true
  let deploy: DeployMode = "push"
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ""
    if (arg === "--deploy" || arg.startsWith("--deploy=")) {
      const value = arg === "--deploy" ? args[++i] : arg.slice("--deploy=".length)
      const mode = DEPLOY_MODES.find((m) => m === value)
      if (mode === undefined) return failure("--deploy needs push or manual")
      deploy = mode
    } else if (arg === "--harness") {
      const value = args[i + 1]
      if (value === undefined || value.startsWith("-")) return failure("--harness needs a value")
      harness = value
      i++
    } else if (arg === "--no-install") install = false
    else if (arg.startsWith("-")) return failure(`unknown flag ${arg}`)
    else positional.push(arg)
  }
  const [dir, ...extra] = positional
  if (dir === undefined) return failure("missing <dir>")
  if (extra.length > 0) return failure(`unexpected argument ${extra[0]}`)
  return { ok: true, args: { dir, harness, install, deploy } }
}

/**
 * The GitHub tag a project pins by default: the version of the CLI that generated it. The factory
 * repo is public, so bun fetches the tag's tarball with no credentials, locally and in CI.
 */
export const releaseSpec = (version: string): string => `github:Pierre-Mike/factory#v${version}`
