#!/usr/bin/env bun

/**
 * `axioms`: the harness as a command. Projects depend on this package; the commands below replace
 * the per-project scripts the template used to copy (and then drift from).
 */

import { BASELINE_USAGE } from "./baseline.core"
import { adopt } from "./commands/adopt"
import { baseline } from "./commands/baseline"
import { check } from "./commands/check"
import { deploy } from "./commands/deploy"
import { dev } from "./commands/dev"
import { doctor, doctorJson } from "./commands/doctor"
import { ciDryRun } from "./commands/dryrun"
import type { GateRun } from "./commands/gates"
import { newProject } from "./commands/new"
import { notes } from "./commands/notes"
import { prBody } from "./commands/pr-body"
import { rules } from "./commands/rules"
import { secretScan } from "./commands/secrets"
import { slice } from "./commands/slice"
import { smoke } from "./commands/smoke"
import { sync } from "./commands/sync"
import { lintWorkflows } from "./commands/workflows"
import { commitSubjectProblem } from "./commit-msg.core"
import { parseDeployArgs } from "./deploy.core"
import { parseDoctorArgs } from "./doctor.core"
import { buildReport, parseReportArgs, renderReport } from "./report.core"
import { parseRulesArgs } from "./rules.core"
import { fail, harnessVersion, projectRoot, readText, runTool } from "./shell"

const HELP = `axioms ${harnessVersion()}

  axioms new <dir> [--harness <spec>] [--deploy push|manual] [--no-install]
                                        create a project from the template (pins the release tag;
                                        --deploy manual: deploy.yml runs only when started by hand)
  axioms adopt [--harness <spec>] [--no-install]
                                        bring the lite harness to an existing repo (no app template)
  axioms slice <feature> [--door] [--no-io]
                                        add a feature slice (--no-io: one that owns no data)
  axioms dev                            wrangler dev (:8787) + vite (:5173)
  axioms check [--json] [--report <path>]
                                        lint, typecheck, co-location, suppressions, notes, doctor, tests, dead code, dupes
  axioms notes [--seal]                 check .agents/notes; --seal freezes newly archived notes
  axioms pr-body [file|-]               check a PR body fills every PR-template section (no arg: the CI pull_request event)
  axioms smoke [--json] [--report <path>]
                                        run smoke/ against a local wrangler dev
                                        (--json: one JSON evidence document on stdout; --report: the same to a file)
  axioms deploy [--dry-run]             bundle + migrate locally; without --dry-run, deploy for real
  axioms ci-dry-run [--all]             replay ci.yml on a clean clone (pre-push, when CI/CD files change)
  axioms lint-workflows                 actionlint + zizmor on .github/workflows
  axioms secret-scan [--staged]         gitleaks on the committed history, or the staged changes
  axioms baseline [--update]            fail when a gate reports fewer checks than gate-baseline.json (--update rewrites it)
  axioms doctor [--json]                check that every harness gate is wired (--json: one JSON
                                        document with failures, warnings and what was not verified)
  axioms rules [--apply]                branch protection from harness/github.rules.json (--apply writes it via gh)
  axioms sync                           rewrite AGENTS.md, CLAUDE.md, notes rules, .claude settings + skills, biome.json, lefthook.yml;
                                        add .github/workflows/deploy.yml when missing
  axioms hooks                          install the git hooks (runs on bun install)
  axioms commit-msg <file>              conventional-commit check (git hook)
  axioms biome|tsc <args>               run the pinned tool`

const [command, ...args] = process.argv.slice(2)
const root = projectRoot(process.cwd())

const exit = (ok: boolean) => process.exit(ok ? 0 : 1)

/** check and smoke: run the gates, honor `--json` / `--report <path>`, exit with the verdict. */
const gatedReport = async (input: {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly gather: (collect: boolean) => Promise<GateRun>
}): Promise<void> => {
  const parsed = parseReportArgs(input.args)
  if (!parsed.ok) return fail(parsed.error)
  const collect = parsed.json || parsed.report !== undefined
  const result = await input.gather(collect)
  if (collect) {
    const text = renderReport(buildReport({ command: input.command, gates: result.gates }))
    if (parsed.report !== undefined) await Bun.write(parsed.report, text)
    if (parsed.json) await Bun.write(Bun.stdout, text)
  }
  exit(result.ok)
}

switch (command) {
  case "new":
    await newProject(args)
    break
  case "adopt":
    await adopt({ root, args })
    break
  case "slice":
    await slice({ root, args })
    break
  case "check":
    await gatedReport({ command: "check", args, gather: (collect) => check({ root, collect }) })
    break
  case "dev":
    exit(await dev(root))
    break
  case "smoke":
    await gatedReport({ command: "smoke", args, gather: (collect) => smoke({ root, collect }) })
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
  case "secret-scan":
    exit(await secretScan({ root, staged: args.includes("--staged") }))
    break
  case "baseline":
    if (args.some((arg) => arg !== "--update")) fail(BASELINE_USAGE)
    else exit(await baseline({ root, update: args.includes("--update") }))
    break
  case "notes":
    exit(await notes({ root, seal: args.includes("--seal") }))
    break
  case "pr-body":
    exit(await prBody({ root, args }))
    break
  case "doctor": {
    const parsed = parseDoctorArgs(args)
    if (!parsed.ok) fail(parsed.error)
    else exit(await (parsed.json ? doctorJson(root) : doctor(root)))
    break
  }
  case "rules": {
    const parsed = parseRulesArgs(args)
    if (!parsed.ok) fail(parsed.error)
    else exit(rules({ root, apply: parsed.apply }))
    break
  }
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
