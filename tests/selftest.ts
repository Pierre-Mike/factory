#!/usr/bin/env bun
/**
 * End-to-end test of the factory: generate a project, run every gate, add a slice, run every gate
 * again, then smoke-test the real worker. If this passes, `axioms new` hands out a project that is
 * green from its first commit, and `axioms slice` keeps it green.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PKG_ROOT } from "../cli/shell"

const workdir = mkdtempSync(join(tmpdir(), "axioms-selftest-"))
const app = join(workdir, "selftest-app")
const cli = join(PKG_ROOT, "cli", "main.ts")

const step = async (input: {
  readonly name: string
  readonly cmd: string[]
  readonly cwd: string
  /** The step passes when the command fails, e.g. a hook rejecting a bad commit. */
  readonly expectFailure?: boolean
}) => {
  console.error(`\n━━ selftest: ${input.name} ━━`)
  const code = await Bun.spawn(input.cmd, { cwd: input.cwd, stdout: "inherit", stderr: "inherit" })
    .exited
  if ((code !== 0) !== (input.expectFailure ?? false)) {
    console.error(`✖ selftest failed at: ${input.name} (project kept at ${app})`)
    process.exit(1)
  }
}

await step({
  name: "new",
  cmd: ["bun", cli, "new", app, "--harness", `file:${PKG_ROOT}`],
  cwd: workdir,
})
await step({
  name: "commit-msg hook rejects a free-form message",
  cmd: ["git", "commit", "--allow-empty", "-m", "wip stuff"],
  cwd: app,
  expectFailure: true,
})
await step({ name: "sync", cmd: ["bun", cli, "sync"], cwd: app })
await step({
  name: "sync on a fresh project changes nothing",
  cmd: ["git", "diff", "--exit-code"],
  cwd: app,
})
await step({ name: "check (fresh)", cmd: ["bun", cli, "check"], cwd: app })
await step({ name: "slice", cmd: ["bun", cli, "slice", "widgets"], cwd: app })
await step({ name: "check (with slice)", cmd: ["bun", cli, "check"], cwd: app })
await step({ name: "smoke", cmd: ["bun", cli, "smoke"], cwd: app })

rmSync(workdir, { recursive: true, force: true })
console.error("\n✓ selftest: new → check → slice → check → smoke all passed")
