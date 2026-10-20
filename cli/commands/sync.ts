/**
 * `axioms sync`: make the project's copies of the harness match the installed version. Rewrites
 * the canon block in AGENTS.md and the Agent Note rules in .agents/notes/README.md, points
 * CLAUDE.md at AGENTS.md, installs the Claude Code settings and skills under .claude/, and makes
 * biome.json and lefthook.yml extend the harness. In an app project it also adds
 * .github/workflows/deploy.yml when there is none, for the mode package.json declares; an existing
 * one is the project's (it may carry an environment url) and is left alone, as ci.yml is.
 * Run after `bun update @pierre-mike/axioms`.
 */
import { join } from "node:path"
import { writeCanon } from "../canon.core"
import {
  BIOME_FILE_INCLUDES,
  CLAUDE_SETTINGS,
  CLAUDE_SKILLS_DIR,
  DEPLOY_WORKFLOW,
  HARNESS_BIOME,
  HARNESS_LEFTHOOK,
  harnessProfile,
} from "../doctor.core"
import { deployMode, renderDeployWorkflow } from "../new.core"
import { NOTES_DIR } from "../notes.core"
import {
  fail,
  HARNESS_DIR,
  harnessSkillFiles,
  readJson,
  readText,
  run,
  TEMPLATE_DIR,
  toolPath,
} from "../shell"

/** Write deploy.yml if the app project has none. Returns whether it did. */
const addDeployWorkflow = async (root: string): Promise<boolean> => {
  const pkg = readJson(join(root, "package.json"))
  const path = join(root, DEPLOY_WORKFLOW)
  if (harnessProfile(pkg) === "lite" || readText(path) !== null) return false
  const template =
    readText(join(TEMPLATE_DIR, DEPLOY_WORKFLOW)) ??
    fail(`the installed harness has no template/${DEPLOY_WORKFLOW}; reinstall it`)
  await Bun.write(path, renderDeployWorkflow({ template, mode: deployMode(pkg) }))
  return true
}

export const sync = async (root: string): Promise<void> => {
  const canon = readText(join(HARNESS_DIR, "canon.md")) ?? ""

  const agentsPath = join(root, "AGENTS.md")
  await Bun.write(agentsPath, writeCanon({ agentsMd: readText(agentsPath) ?? "", canon }))

  // Bun.write creates .agents/notes/; the lifecycle folders appear with the first note in them.
  await Bun.write(join(root, NOTES_DIR, "README.md"), readText(join(HARNESS_DIR, "notes.md")) ?? "")

  const claudePath = join(root, "CLAUDE.md")
  const claude = readText(claudePath) ?? ""
  if (!claude.includes("@AGENTS.md")) {
    await Bun.write(claudePath, `@AGENTS.md\n${claude === "" ? "" : `\n${claude}`}`)
  }

  // The Claude Code settings and skills are harness copies too: the permission allowlist for the
  // project's own gate commands, and the shared skills directory with its README. Personal
  // settings belong in .claude/settings.local.json, which sync never touches.
  await Bun.write(
    join(root, CLAUDE_SETTINGS),
    readText(join(HARNESS_DIR, "claude.settings.json")) ?? "",
  )
  for (const file of await harnessSkillFiles()) {
    await Bun.write(join(root, CLAUDE_SKILLS_DIR, file.path), file.text)
  }

  // `files` is rewritten too: a project-specific include list could hide code from the linter.
  await Bun.write(
    join(root, "biome.json"),
    `${JSON.stringify(
      {
        $schema: "./node_modules/@biomejs/biome/configuration_schema.json",
        extends: [HARNESS_BIOME],
        vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
        files: { includes: BIOME_FILE_INCLUDES },
      },
      null,
      2,
    )}\n`,
  )

  await Bun.write(
    join(root, "lefthook.yml"),
    `# Hooks come from the harness. Run \`bunx axioms sync\` after upgrading it.\nextends:\n  - ${HARNESS_LEFTHOOK}\n`,
  )

  const addedDeploy = await addDeployWorkflow(root)

  // Both steps need the harness in node_modules: Biome loads the shared config (and its plugins)
  // from there, and lefthook resolves `extends` at install time, so before `bun install` it would
  // silently install no hooks. `axioms new` formats and installs hooks itself after installing.
  const harnessInstalled = readText(join(root, HARNESS_LEFTHOOK)) !== null
  if (harnessInstalled) {
    // JSON.stringify's layout differs from Biome's; format so `sync` leaves the project lint-clean.
    await run({ cmd: ["bun", toolPath("biome"), "format", "--write", "biome.json"], cwd: root })
  }
  if (readText(join(root, ".git", "HEAD")) !== null && harnessInstalled) {
    await run({ cmd: ["bun", toolPath("lefthook"), "install"], cwd: root })
  }
  console.error(
    `✓ synced AGENTS.md, CLAUDE.md, .agents/notes/README.md, .claude/settings.json, .claude/skills, biome.json and lefthook.yml with the harness${addedDeploy ? `, and added ${DEPLOY_WORKFLOW}` : ""}`,
  )
}
