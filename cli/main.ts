#!/usr/bin/env bun
import { check } from "./commands/check"
import { doctor } from "./commands/doctor"
import { newProject } from "./commands/new"
import { slice } from "./commands/slice"
import { smoke } from "./commands/smoke"
import { sync } from "./commands/sync"
/**
 * `axioms`: the harness as a command. Projects depend on this package; the commands below replace
 * the per-project scripts the template used to copy (and then drift from).
 */
import { isConventionalSubject } from "./commit-msg.core"
import { fail, harnessVersion, projectRoot, readText, runTool } from "./shell"

const HELP = `axioms ${harnessVersion()}

  axioms new <dir> [--harness <spec>]   create a project from the template
  axioms slice <feature> [--door]       add a feature slice
  axioms check                          lint, typecheck, co-location, doctor, tests, dead code, dupes
  axioms smoke                          run smoke/ against a local wrangler dev
  axioms doctor                         check that every harness gate is wired
  axioms sync                           rewrite AGENTS.md, CLAUDE.md, biome.json, lefthook.yml
  axioms hooks                          install the git hooks (runs on bun install)
  axioms commit-msg <file>              conventional-commit check (git hook)
  axioms biome|tsc <args>               run the pinned tool`

const [command, ...args] = process.argv.slice(2)
const root = projectRoot(process.cwd())

const exit = (ok: boolean) => process.exit(ok ? 0 : 1)

switch (command) {
  case "new":
    await newProject(args)
    break
  case "slice":
    await slice({ root, args })
    break
  case "check":
    exit(await check(root))
    break
  case "smoke":
    exit(await smoke(root))
    break
  case "doctor":
    exit(await doctor(root))
    break
  case "sync":
    await sync(root)
    break
  case "commit-msg": {
    const message = readText(args[0] ?? "") ?? fail("usage: axioms commit-msg <file>")
    if (!isConventionalSubject(message)) {
      fail(`not a conventional commit subject: "${message.split("\n")[0]}"
  expected: type(scope)?: subject   (<=72 chars)
  types: feat fix docs chore refactor perf test build ci style revert`)
    }
    break
  }
  case "hooks":
    process.exit(await runTool({ tool: "lefthook", args: ["install"], cwd: root }))
    break
  case "biome":
  case "tsc":
    process.exit(await runTool({ tool: command, args, cwd: process.cwd() }))
    break
  default:
    console.error(HELP)
    exit(command === undefined || command === "help" || command === "--help")
}
