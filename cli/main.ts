#!/usr/bin/env bun
/**
 * `axioms`: the harness as a command. Projects depend on this package; the commands below replace
 * the per-project scripts the template used to copy (and then drift from).
 */

import { check } from "./commands/check"
import { deploy } from "./commands/deploy"
import { dev } from "./commands/dev"
import { doctor } from "./commands/doctor"
import { ciDryRun } from "./commands/dryrun"
import { newProject } from "./commands/new"
import { notes } from "./commands/notes"
import { slice } from "./commands/slice"
import { smoke } from "./commands/smoke"
import { sync } from "./commands/sync"
import { lintWorkflows } from "./commands/workflows"
import { commitSubjectProblem } from "./commit-msg.core"
import { parseDeployArgs } from "./deploy.core"
import { fail, harnessVersion, projectRoot, readText, runTool } from "./shell"

const HELP = `axioms ${harnessVersion()}

  axioms new <dir> [--harness <spec>] [--no-install]
                                        create a project from the template (pins the release tag)
  axioms slice <feature> [--door]       add a feature slice
  axioms dev                            wrangler dev (:8787) + vite (:5173)
  axioms check                          lint, typecheck, co-location, suppressions, notes, doctor, tests, dead code, dupes
  axioms notes [--seal]                 check .agents/notes; --seal freezes newly archived notes
  axioms smoke                          run smoke/ against a local wrangler dev
  axioms deploy [--dry-run]             bundle + migrate locally; without --dry-run, deploy for real
  axioms ci-dry-run [--all]             replay ci.yml on a clean clone (pre-push, when CI/CD files change)
  axioms lint-workflows                 actionlint + zizmor on .github/workflows
  axioms doctor                         check that every harness gate is wired
  axioms sync                           rewrite AGENTS.md, CLAUDE.md, notes rules, .claude settings + skills, biome.json, lefthook.yml
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
  case "dev":
    exit(await dev(root))
    break
  case "smoke":
    exit(await smoke(root))
    break
  case "deploy": {
    const parsed = parseDeployArgs(args)
    if (!parsed.ok) fail(parsed.error)
    else exit(await deploy({ root, dryRun: parsed.dryRun }))
    break
  }
  case "ci-dry-run":
    exit(await ciDryRun({ root, all: args.includes("--all") }))
    break
  case "lint-workflows":
    exit(await lintWorkflows(root))
    break
  case "notes":
    exit(await notes({ root, seal: args.includes("--seal") }))
    break
  case "doctor":
    exit(await doctor(root))
    break
  case "sync":
    await sync(root)
    break
  case "commit-msg": {
    const message = readText(args[0] ?? "") ?? fail("usage: axioms commit-msg <file>")
    const problem = commitSubjectProblem(message)
    if (problem !== undefined) fail(problem)
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
