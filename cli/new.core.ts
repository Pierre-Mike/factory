/**
 * `axioms new` argument handling, pure. Flags may come before or after the folder, and the harness
 * defaults to the release tag of the running version, so a generated project passes `axioms doctor`
 * (which rejects local paths) whether the CLI ran from node_modules or from a checkout.
 */

export const NEW_USAGE = "usage: axioms new <dir> [--harness <spec>] [--no-install]"

export interface NewArgs {
  readonly dir: string
  /** The harness spec to pin; undefined means the release tag (see `releaseSpec`). */
  readonly harness: string | undefined
  readonly install: boolean
}

export type ParsedNewArgs =
  | { readonly ok: true; readonly args: NewArgs }
  | { readonly ok: false; readonly error: string }

const failure = (error: string): ParsedNewArgs => ({ ok: false, error: `${error}\n${NEW_USAGE}` })

export const parseNewArgs = (args: ReadonlyArray<string>): ParsedNewArgs => {
  const positional: string[] = []
  let harness: string | undefined
  let install = true
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ""
    if (arg === "--harness") {
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
  return { ok: true, args: { dir, harness, install } }
}

/**
 * The GitHub tag a project pins by default: the version of the CLI that generated it. The factory
 * repo is private and bun sends no credentials for `github:` or `git+https://github.com` specs (it
 * fetches an API tarball anonymously), so the spec is `git+ssh`, which bun hands to `git`. Git then
 * authenticates: locally through an `insteadOf` rewrite to HTTPS and the gh credential helper, in
 * CI through the template's `harness-access` step.
 */
export const releaseSpec = (version: string): string =>
  `git+ssh://git@github.com/Pierre-Mike/factory.git#v${version}`
