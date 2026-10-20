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

// The generated project pins this unreleased checkout with an absolute file: path on purpose.
process.env.AXIOMS_ALLOW_LOCAL_HARNESS = "1"

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
  const code = await Bun.spawn(input.cmd, {
    cwd: input.cwd,
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
  }).exited
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

// A formatting-only change: check names the file and the fix command, never Biome's diff (issue
// #10). The lint section must stay a few lines; Biome's diff of this one file is 62 lines (29 KB
// with color). The whole run, every gate included, has a looser budget.
const MAX_LINT_LINES = 10
const MAX_CHECK_LINES = 200
const reflowed = join("apps", "server", "src", "features", "health", "health.core.ts")
const reflowedPath = join(app, reflowed)
const formatted = await Bun.file(reflowedPath).text()
await Bun.write(reflowedPath, formatted.replaceAll("\n  ", "\n      "))
console.error("\n━━ selftest: check names a formatting-only change and the fix command ━━")
const formatRun = Bun.spawn(["bun", cli, "check"], { cwd: app, stdout: "pipe", stderr: "pipe" })
const [formatOut, formatErr] = await Promise.all([
  new Response(formatRun.stdout).text(),
  new Response(formatRun.stderr).text(),
])
const formatOutput = formatOut + formatErr
console.error(formatOutput)
const checkLines = formatOutput.split("\n").length
const lintLines = (formatOutput.split("── lint ──")[1] ?? "")
  .split("\n── ")[0]
  ?.trim()
  .split("\n").length
const formatProblems = [
  (await formatRun.exited) === 0 ? "check passed" : null,
  formatOutput.includes(reflowed) ? null : `the output does not name ${reflowed}`,
  formatOutput.includes("run `bun run lint` to fix") ? null : "the output has no fix command",
  lintLines !== undefined && lintLines <= MAX_LINT_LINES
    ? null
    : `the lint section has ${lintLines} lines, over ${MAX_LINT_LINES}`,
  checkLines < MAX_CHECK_LINES ? null : `${checkLines} lines, over ${MAX_CHECK_LINES}`,
].filter((problem) => problem !== null)
if (formatProblems.length > 0) {
  console.error(`✖ selftest failed at: formatting-only check (${formatProblems.join("; ")})`)
  process.exit(1)
}
await Bun.write(reflowedPath, formatted)

// A promotion that only flips the status word: the notes gate must reject it, then accept the fix.
const notePath = join(app, ".agents", "notes", "implemented", "process", "2026-01-01-use-d1.md")
const note = (body: string) =>
  `# Agent Note: Use D1\n\nStatus: implemented\n\n## Problem\n\nThe app needs storage.\n\n${body}`
await Bun.write(notePath, note("## Proposal\n\nUse D1.\n\n## Alternatives considered\n\nNone.\n"))
await step({
  name: "notes rejects a proposal promoted by its status word only",
  cmd: ["bun", cli, "notes"],
  cwd: app,
  expectFailure: true,
})
await Bun.write(
  notePath,
  note(
    "## Decision\n\nThe app stores data in D1.\n\n## Alternatives considered\n\nNone.\n\n## Consequences\n\nOne vendor.\n",
  ),
)
await step({ name: "notes accepts the rewritten note", cmd: ["bun", cli, "notes"], cwd: app })
rmSync(join(app, ".agents", "notes", "implemented"), { recursive: true })
await step({ name: "slice", cmd: ["bun", cli, "slice", "widgets"], cwd: app })
await step({ name: "check (with slice)", cmd: ["bun", cli, "check"], cwd: app })
await step({ name: "smoke", cmd: ["bun", cli, "smoke"], cwd: app })
await step({ name: "deploy dry run", cmd: ["bun", cli, "deploy", "--dry-run"], cwd: app })
await step({
  name: "deploy refuses placeholders",
  cmd: ["bun", cli, "deploy"],
  cwd: app,
  expectFailure: true,
})
await step({ name: "stage the slice", cmd: ["git", "add", "-A"], cwd: app })
await step({ name: "commit the slice", cmd: ["git", "commit", "-qm", "feat: widgets"], cwd: app })

// A staged secret must never reach a commit. The fake token is assembled at runtime so the
// factory's own history never contains a string its own secret scan would flag.
const secretsPath = join(app, "secrets.txt")
const fakeToken = ["ghp", "Zk9pQ4rT8wY3nB6vC1mD5sF0hJ2aL4eX7Gq2"].join("_")
await Bun.write(secretsPath, `github_token = "${fakeToken}"\n`)
await step({ name: "stage a fake secret", cmd: ["git", "add", "secrets.txt"], cwd: app })
await step({
  name: "secret-scan flags the staged secret",
  cmd: ["bun", cli, "secret-scan", "--staged"],
  cwd: app,
  expectFailure: true,
})
await step({
  name: "pre-commit hook blocks the staged secret",
  cmd: ["git", "commit", "-qm", "feat: add config"],
  cwd: app,
  expectFailure: true,
})
await step({ name: "unstage the fake secret", cmd: ["git", "reset", "-q"], cwd: app })
rmSync(secretsPath)

await step({
  name: "ci dry run (every CI job on a clean clone)",
  cmd: ["bun", cli, "ci-dry-run", "--all"],
  cwd: app,
})

// Break CI on purpose: the dry run must catch it before a push would.
const ciPath = join(app, ".github", "workflows", "ci.yml")
await Bun.write(
  ciPath,
  (await Bun.file(ciPath).text()).replace(
    "      - run: bunx axioms check",
    "      - run: bunx axioms check\n      - run: bun run no-such-script",
  ),
)
await step({
  name: "commit a broken workflow",
  cmd: ["git", "commit", "-qam", "ci: break it"],
  cwd: app,
})
await step({
  name: "ci dry run catches the broken workflow",
  cmd: ["bun", cli, "ci-dry-run", "--all"],
  cwd: app,
  expectFailure: true,
})

rmSync(workdir, { recursive: true, force: true })
console.error(
  "\n✓ selftest: new, check, slice, check, smoke, secret scan, deploy dry run and CI dry run all behaved",
)
