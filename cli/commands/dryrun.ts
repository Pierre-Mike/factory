/**
 * `axioms ci-dry-run [--all]`: run the CI workflow before GitHub does.
 *
 * Runs on pre-push. When the push touches CI/CD files (workflows, manifests, the lockfile, wrangler
 * config, migrations), it lints the workflows, then replays every job of ci.yml in its own fresh
 * clone of HEAD, outside the project folder, so nothing local leaks in: no `../factory` sibling,
 * no untracked files, no node_modules. That is what a runner sees. Other pushes skip it; --all
 * forces it.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ciCdChanges, type PlannedJob, planWorkflow } from "../dryrun.core"
import { readText, run } from "../shell"
import { lintWorkflows } from "./workflows"

const git = async (input: { readonly args: ReadonlyArray<string>; readonly cwd: string }) => {
  const proc = Bun.spawn(["git", ...input.args], { cwd: input.cwd, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  return { ok: (await proc.exited) === 0, out: out.trim() }
}

/** The files this push changes, or undefined when the branch has no upstream yet (first push). */
const changedFiles = async (root: string): Promise<string[] | undefined> => {
  const upstream = await git({ args: ["rev-parse", "--abbrev-ref", "@{upstream}"], cwd: root })
  if (!upstream.ok) return undefined
  const diff = await git({ args: ["diff", "--name-only", `${upstream.out}...HEAD`], cwd: root })
  return diff.out.split("\n").filter(Boolean)
}

const runJob = async (input: {
  readonly root: string
  readonly sha: string
  readonly job: PlannedJob
}) => {
  const dir = mkdtempSync(join(tmpdir(), `axioms-ci-${input.job.name}-`))
  console.error(`\n━━ job ${input.job.name} (clean clone in ${dir}) ━━`)
  const cloned =
    (await git({ args: ["clone", "-q", "--no-checkout", input.root, dir], cwd: input.root })).ok &&
    (await git({ args: ["checkout", "-q", "--detach", input.sha], cwd: dir })).ok
  if (!cloned) {
    console.error(`✖ could not clone ${input.sha}`)
    return false
  }
  for (const step of input.job.steps) {
    if (step.kind === "provided") {
      console.error(`· ${step.name}: skipped, ${step.reason}`)
      continue
    }
    console.error(`▶ ${step.name}`)
    const code = await run({
      cmd: ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", step.run],
      cwd: join(dir, step.cwd),
      env: { CI: "true" },
    })
    if (code !== 0) {
      console.error(`✖ job ${input.job.name} failed at "${step.name}" (clone kept at ${dir})`)
      return false
    }
  }
  rmSync(dir, { recursive: true, force: true })
  console.error(`✓ job ${input.job.name}`)
  return true
}

export const ciDryRun = async (input: { readonly root: string; readonly all: boolean }) => {
  const changed = input.all ? undefined : await changedFiles(input.root)
  if (changed !== undefined) {
    const relevant = ciCdChanges(changed)
    if (relevant.length === 0) {
      console.error("✓ ci-dry-run: no CI/CD files changed in this push, skipped")
      return true
    }
    console.error(`ci-dry-run: CI/CD files changed: ${relevant.join(", ")}`)
  }
  const dirty = await git({ args: ["status", "--porcelain"], cwd: input.root })
  if (dirty.out !== "") {
    console.error("! uncommitted changes are not part of the dry run (CI only sees commits)")
  }

  console.error("── lint workflows ──")
  if (!(await lintWorkflows(input.root))) return false

  const workflow = readText(join(input.root, ".github", "workflows", "ci.yml"))
  const plan = planWorkflow({
    workflow: workflow === null ? null : Bun.YAML.parse(workflow),
    localBun: Bun.version,
  })
  for (const warning of plan.warnings) console.error(`! ${warning}`)
  if (plan.unsupported.length > 0) {
    console.error("✖ ci-dry-run cannot reproduce these steps, so it cannot vouch for CI:")
    for (const u of plan.unsupported) console.error(`  ✖ ${u}`)
    return false
  }

  const sha = (await git({ args: ["rev-parse", "HEAD"], cwd: input.root })).out
  const failed: string[] = []
  for (const job of plan.jobs) {
    if (!(await runJob({ root: input.root, sha, job }))) failed.push(job.name)
  }
  console.error(
    failed.length === 0
      ? `\n✓ ci-dry-run: every CI job passed on a clean clone of ${sha.slice(0, 7)}`
      : `\n✖ ci-dry-run: failed jobs: ${failed.join(", ")}`,
  )
  return failed.length === 0
}
