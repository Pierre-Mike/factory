/**
 * Deploy readiness, pure. Reads the parsed wrangler config and lists what would make a real deploy
 * fail or ship something broken. `axioms deploy --dry-run` reports these as warnings (a fresh
 * project has placeholders until its first deploy); `axioms deploy` refuses while any remain.
 */
import { isRecord } from "./doctor.core"

export const DEPLOY_USAGE = "usage: axioms deploy [--dry-run]"

/**
 * Only `--dry-run` is accepted. Anything else (`--help`, `--dryrun`) is refused instead of read as
 * "no --dry-run", which would deploy for real.
 */
export const parseDeployArgs = (
  args: ReadonlyArray<string>,
):
  | { readonly ok: true; readonly dryRun: boolean }
  | { readonly ok: false; readonly error: string } => {
  const unknown = args.find((arg) => arg !== "--dry-run")
  return unknown === undefined
    ? { ok: true, dryRun: args.length > 0 }
    : { ok: false, error: `unexpected argument ${unknown}\n${DEPLOY_USAGE}` }
}

const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/
const PLACEHOLDER_VALUE = /REPLACE-ME/

export const deployBlockers = (wrangler: unknown): string[] => {
  if (!isRecord(wrangler)) return ["wrangler.jsonc is missing or not valid JSONC"]
  const blockers: string[] = []
  if (typeof wrangler.main !== "string") blockers.push("wrangler.jsonc has no `main` entry")
  const databases = Array.isArray(wrangler.d1_databases) ? wrangler.d1_databases : []
  for (const db of databases.filter(isRecord)) {
    const id = typeof db.database_id === "string" ? db.database_id : ""
    if (PLACEHOLDER_ID.test(id) || id === "") {
      blockers.push(
        `D1 binding ${String(db.binding)} still has the placeholder database_id; run \`wrangler d1 create ${String(db.database_name)}\` and paste the id`,
      )
    }
  }
  const vars = isRecord(wrangler.vars) ? wrangler.vars : {}
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value === "string" && PLACEHOLDER_VALUE.test(value)) {
      blockers.push(`var ${name} is still a placeholder (${value})`)
    }
  }
  return blockers
}
