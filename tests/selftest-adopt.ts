#!/usr/bin/env bun
/**
 * End-to-end test of `axioms adopt`: build a plain git repository the factory never saw, adopt the
 * lite harness into it, and prove the lite gates run there — `check` with typecheck skipped (no
 * tsconfig.json), the notes gate, live git hooks — with no wrangler anywhere, so this scenario is
 * safe to run in parallel with the app selftest.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PKG_ROOT } from "../cli/shell"

// The adopted repo pins this unreleased checkout with an absolute file: path on purpose.
process.env.AXIOMS_ALLOW_LOCAL_HARNESS = "1"

const workdir = mkdtempSync(join(tmpdir(), "axioms-adopt-selftest-"))
const repo = join(workdir, "legacy-repo")
const cli = join(PKG_ROOT, "cli", "main.ts")

const step = async (input: {
  readonly name: string
  readonly cmd: string[]
  readonly cwd: string
  /** The step passes when the command fails, e.g. adopt refusing a second run. */
  readonly expectFailure?: boolean
}) => {
  console.error(`\n━━ adopt selftest: ${input.name} ━━`)
  const code = await Bun.spawn(input.cmd, {
    cwd: input.cwd,
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
  }).exited
  if ((code !== 0) !== (input.expectFailure ?? false)) {
    console.error(`✖ adopt selftest failed at: ${input.name} (repo kept at ${repo})`)
    process.exit(1)
  }
}

// A plain repository with a few files: TypeScript but no tsconfig, no package.json, its own
// .gitignore. Exactly what adopt must cope with.
mkdirSync(join(repo, "src"), { recursive: true })
await Bun.write(
  join(repo, "src", "greet.ts"),
  `export const greet = (name: string): string => \`hello \${name}\`\n`,
)
await Bun.write(
  join(repo, "src", "greet.test.ts"),
  'import { expect, test } from "bun:test"\nimport { greet } from "./greet"\n\ntest("greet", () => {\n  expect(greet("factory")).toBe("hello factory")\n})\n',
)
await Bun.write(join(repo, "README.md"), "# legacy-repo\n\nA repo that predates the harness.\n")
await Bun.write(join(repo, ".gitignore"), "dist/\n")
await step({ name: "git init", cmd: ["git", "init", "-q", "-b", "main"], cwd: repo })
await step({
  name: "git identity",
  cmd: ["git", "config", "user.email", "selftest@example.com"],
  cwd: repo,
})
await step({
  name: "git identity name",
  cmd: ["git", "config", "user.name", "selftest"],
  cwd: repo,
})
await step({ name: "first commit: stage", cmd: ["git", "add", "-A"], cwd: repo })
await step({
  name: "first commit",
  cmd: ["git", "commit", "-qm", "chore: life before the harness"],
  cwd: repo,
})

const notARepo = join(workdir, "not-a-repo")
mkdirSync(notARepo, { recursive: true })
await step({
  name: "adopt refuses outside a git repository",
  cmd: ["bun", cli, "adopt", "--harness", `file:${PKG_ROOT}`],
  cwd: notARepo,
  expectFailure: true,
})

await step({
  name: "adopt",
  cmd: ["bun", cli, "adopt", "--harness", `file:${PKG_ROOT}`],
  cwd: repo,
})
await step({
  name: "adopting twice refuses and points to sync",
  cmd: ["bun", cli, "adopt", "--harness", `file:${PKG_ROOT}`],
  cwd: repo,
  expectFailure: true,
})

// The hooks sync installed are live: the commit-msg hook rejects a free-form message.
await step({
  name: "commit-msg hook rejects a free-form message",
  cmd: ["git", "commit", "--allow-empty", "-m", "wip stuff"],
  cwd: repo,
  expectFailure: true,
})
await step({ name: "stage the adoption", cmd: ["git", "add", "-A"], cwd: repo })
await step({
  name: "commit the adoption",
  cmd: ["git", "commit", "-qm", "chore: adopt the axioms harness"],
  cwd: repo,
})

await step({ name: "sync", cmd: ["bun", cli, "sync"], cwd: repo })
await step({
  name: "sync right after adopt changes nothing",
  cmd: ["git", "diff", "--exit-code"],
  cwd: repo,
})

// The lite set: typecheck is skipped (no tsconfig.json), every other gate runs, doctor runs the
// lite profile, and nothing needs wrangler.
await step({ name: "check (lite)", cmd: ["bun", cli, "check"], cwd: repo })

// The notes gate works in the adopted repo: it rejects a proposal promoted by its status word
// only, then accepts the rewritten note.
const notePath = join(repo, ".agents", "notes", "implemented", "process", "2026-01-01-use-bun.md")
const note = (body: string) =>
  `# Agent Note: Use bun\n\nStatus: implemented\n\n## Problem\n\nThe repo needs a runtime.\n\n${body}`
await Bun.write(notePath, note("## Proposal\n\nUse bun.\n\n## Alternatives considered\n\nNone.\n"))
await step({
  name: "notes rejects a proposal promoted by its status word only",
  cmd: ["bun", cli, "notes"],
  cwd: repo,
  expectFailure: true,
})
await Bun.write(
  notePath,
  note(
    "## Decision\n\nThe repo runs on bun.\n\n## Alternatives considered\n\nNone.\n\n## Consequences\n\nOne runtime.\n",
  ),
)
await step({ name: "notes accepts the rewritten note", cmd: ["bun", cli, "notes"], cwd: repo })

rmSync(workdir, { recursive: true, force: true })
console.error(
  "\n✓ adopt selftest: adopt, refusals, live hooks, sync stability, the lite check and the notes gate all behaved",
)
