#!/usr/bin/env bun
/**
 * End-to-end test of the factory: generate a project, run every gate, add a slice, run every gate
 * again, then smoke-test the real worker and run two `axioms dev` servers side by side. If this
 * passes, `axioms new` hands out a project that is green from its first commit, and
 * `axioms slice` keeps it green.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PKG_ROOT } from "../cli/shell"
import { collectOutput, pollStatus, survivors, watchTree } from "./processes"

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
  /** Text the command's combined output must contain. */
  readonly expectOutput?: ReadonlyArray<string>
}) => {
  console.error(`\n━━ selftest: ${input.name} ━━`)
  const capture = input.expectOutput !== undefined
  const proc = Bun.spawn(input.cmd, {
    cwd: input.cwd,
    env: { ...process.env },
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  })
  const output = capture
    ? (
        await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      ).join("")
    : ""
  process.stderr.write(output)
  const code = await proc.exited
  const missing = (input.expectOutput ?? []).filter((text) => !output.includes(text))
  if ((code !== 0) !== (input.expectFailure ?? false) || missing.length > 0) {
    for (const text of missing) console.error(`✖ output does not mention: ${text}`)
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
// A slice that owns no data gets no io file and leaves runtime.ts alone.
await step({ name: "slice --no-io", cmd: ["bun", cli, "slice", "search", "--no-io"], cwd: app })
await step({
  name: "slice --no-io leaves runtime.ts unchanged",
  cmd: ["git", "diff", "--exit-code", "--", "apps/server/src/platform/runtime.ts"],
  cwd: app,
})
// Replace the stub core with a real one that fails with its own tag. The stub's InvalidSearchId
// is now orphaned in http.ts: doctor must name it and the slice that left it.
const searchDir = join(app, "apps", "server", "src", "features", "search")
for (const file of readdirSync(searchDir)) {
  const path = join(searchDir, file)
  await Bun.write(
    path,
    (await Bun.file(path).text()).replaceAll("InvalidSearchId", "InvalidSearchQuery"),
  )
}
await step({
  name: "doctor names the stub tag a replaced core left behind",
  cmd: ["bun", cli, "doctor"],
  cwd: app,
  expectFailure: true,
  expectOutput: ["InvalidSearchId", "`axioms slice search`"],
})
const httpPath = join(app, "apps", "server", "src", "platform", "http.ts")
await Bun.write(
  httpPath,
  (await Bun.file(httpPath).text()).replace("InvalidSearchId: 400", "InvalidSearchQuery: 400"),
)
await step({ name: "slice", cmd: ["bun", cli, "slice", "widgets"], cwd: app })
// Point the stub io at a real table: the generated route test (id "abc" answers 200) now passes
// only if testApp() applied the migration, and the smoke test only if wrangler's D1 did.
await Bun.write(
  join(app, "apps", "server", "migrations", "0001_widgets.sql"),
  "CREATE TABLE widgets (id TEXT PRIMARY KEY);\nINSERT INTO widgets (id) VALUES ('abc');\n",
)
const widgetsIo = join(app, "apps", "server", "src", "features", "widgets", "widgets.io.ts")
const stubIo = await Bun.file(widgetsIo).text()
if (!stubIo.includes('FIND_BY_ID = "SELECT ? AS id"')) {
  console.error(`✖ selftest: widgets.io.ts has no stub query to replace (project kept at ${app})`)
  process.exit(1)
}
await Bun.write(widgetsIo, stubIo.replace("SELECT ? AS id", "SELECT id FROM widgets WHERE id = ?"))
await step({ name: "check (with slice)", cmd: ["bun", cli, "check"], cwd: app })
await step({ name: "smoke", cmd: ["bun", cli, "smoke"], cwd: app })

// Two `axioms dev --port 0` runs side by side in one project (issue #14): each picks its own
// ports, applies the migrations to its own state (so /api/widgets finds the migrated row), and
// answers on its own URL. Both are then stopped, and every process they started must be gone.
console.error("\n━━ selftest: two axioms dev runs at once, each on its own port and state ━━")
const devRuns = ["a", "b"].map((name) => {
  const persistTo = join(workdir, `dev-state-${name}`)
  const proc = Bun.spawn(["bun", cli, "dev", "--port", "0", "--persist-to", persistTo], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { name, proc, tree: watchTree(proc.pid), output: collectOutput(proc) }
})
const devUrls = await Promise.all(
  devRuns.map(async (run) => (await run.output.waitFor(/app on (http:\/\/127\.0\.0\.1:\d+)/))?.[1]),
)
const devProblems: string[] = []
for (const [index, run] of devRuns.entries()) {
  const url = devUrls[index]
  if (url === undefined) {
    devProblems.push(`dev ${run.name} never printed its URL`)
    continue
  }
  for (const path of ["/api/health", "/api/widgets?id=abc"]) {
    const status = await pollStatus(`${url}${path}`)
    if (status !== 200) devProblems.push(`dev ${run.name}: ${url}${path} answered ${status}`)
  }
}
if (devUrls[0] !== undefined && devUrls[0] === devUrls[1]) {
  devProblems.push(`both runs share ${devUrls[0]}`)
}
for (const run of devRuns) run.proc.kill("SIGTERM")
for (const run of devRuns) {
  await run.proc.exited
  await run.output.done
  const left = await survivors(await run.tree.stop())
  if (left !== "") devProblems.push(`dev ${run.name} left processes running:\n${left}`)
}
if (devProblems.length > 0) {
  for (const run of devRuns) process.stderr.write(run.output.text())
  console.error(`✖ selftest failed at: parallel dev (${devProblems.join("; ")})`)
  process.exit(1)
}
console.error(`✓ two dev runs answered on ${devUrls.join(" and ")} and stopped cleanly`)
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
