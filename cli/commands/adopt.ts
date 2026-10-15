/**
 * `axioms adopt [--harness <spec>] [--no-install]`: bring the lite harness to an existing git
 * repository that did not start from the app template. Stamps the skeleton the core planned
 * (package.json with the pinned harness and the `lite` profile, a CI workflow running check,
 * secret-scan and pr-body, the template's PR template, .fallowrc.json, .gitignore entries), then
 * hands every synced copy to `axioms sync`: once before the install so the files exist either
 * way, and once after it so sync's own formatting and hook installation run with the harness in
 * node_modules.
 */
import { existsSync } from "node:fs"
import { basename, join } from "node:path"
import { parseAdoptArgs, planAdopt } from "../adopt.core"
import { releaseSpec } from "../new.core"
import { fail, harnessVersion, readJson, readText, run, runTool, TEMPLATE_DIR } from "../shell"
import { PR_TEMPLATE_PATH } from "./pr-body"
import { sync } from "./sync"

/** The branch the stamped CI triggers on: the current one, or `main` when HEAD is detached. */
const defaultBranch = (root: string): string => {
  const proc = Bun.spawnSync(["git", "symbolic-ref", "--short", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const name = proc.stdout.toString().trim()
  return proc.exitCode === 0 && name !== "" ? name : "main"
}

export const adopt = async (input: {
  readonly root: string
  readonly args: ReadonlyArray<string>
}): Promise<void> => {
  const parsed = parseAdoptArgs(input.args)
  if (!parsed.ok) return fail(parsed.error)
  const { harness, install } = parsed.args
  const root = input.root

  const plan = planAdopt({
    pkgText: readText(join(root, "package.json")),
    pkg: readJson(join(root, "package.json")),
    gitignore: readText(join(root, ".gitignore")),
    hasCiWorkflow: existsSync(join(root, ".github", "workflows", "ci.yml")),
    hasPrTemplate: existsSync(join(root, PR_TEMPLATE_PATH)),
    hasFallowrc: existsSync(join(root, ".fallowrc.json")),
    hasGitDir: existsSync(join(root, ".git")),
    dirName: basename(root),
    harnessSpec: harness ?? releaseSpec(harnessVersion()),
    defaultBranch: defaultBranch(root),
    prTemplate:
      readText(join(TEMPLATE_DIR, PR_TEMPLATE_PATH)) ??
      fail(`the installed harness has no template/${PR_TEMPLATE_PATH}; reinstall it`),
  })
  if (!plan.ok) return fail(plan.error)
  const writes = plan.writes

  await Bun.write(join(root, "package.json"), writes.pkg)
  if (writes.gitignore !== null) await Bun.write(join(root, ".gitignore"), writes.gitignore)
  if (writes.ciWorkflow !== null) {
    await Bun.write(join(root, ".github", "workflows", "ci.yml"), writes.ciWorkflow)
  }
  if (writes.prTemplate !== null) await Bun.write(join(root, PR_TEMPLATE_PATH), writes.prTemplate)
  if (writes.fallowrc !== null) await Bun.write(join(root, ".fallowrc.json"), writes.fallowrc)

  // Everything synced (AGENTS.md canon, CLAUDE.md, notes rules, .claude settings and skills,
  // biome.json, lefthook.yml) comes from sync, so adopt and a later upgrade write the exact same
  // copies.
  await sync(root)
  if (install) {
    if ((await run({ cmd: ["bun", "install"], cwd: root })) !== 0) {
      fail(`bun install failed in ${root}`)
    }
    await sync(root)
    // sync formats only its own biome.json; the files adopt stamped get the same treatment.
    await runTool({
      tool: "biome",
      args: ["format", "--write", "package.json", ".fallowrc.json"],
      cwd: root,
    })
  }

  for (const warning of writes.warnings) console.error(`! ${warning}`)
  console.error(`
✓ adopted the lite harness (pinned ${harness ?? releaseSpec(harnessVersion())})

next:${install ? "" : "\n  bun install && bunx axioms sync   # install the harness, then let sync format and install the hooks"}
  bun run check   # lint, co-location, suppressions, notes, doctor, dead code, duplication
                  # (+ typecheck when tsconfig.json exists, + bun test when there are test files)
  git add -A && git commit -m "chore: adopt the axioms harness"`)
}
