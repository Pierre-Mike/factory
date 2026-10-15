/**
 * `axioms sync`: make the project's copies of the harness match the installed version. Rewrites
 * the canon block in AGENTS.md and the Agent Note rules in .agents/notes/README.md, points
 * CLAUDE.md at AGENTS.md, and makes biome.json and lefthook.yml extend the harness. Run after `bun update @pierre-mike/axioms`.
 */
import { join } from "node:path"
import { writeCanon } from "../canon.core"
import { BIOME_FILE_INCLUDES, HARNESS_BIOME, HARNESS_LEFTHOOK } from "../doctor.core"
import { NOTES_DIR } from "../notes.core"
import { HARNESS_DIR, readText, run, toolPath } from "../shell"

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
    "✓ synced AGENTS.md, CLAUDE.md, .agents/notes/README.md, biome.json and lefthook.yml with the harness",
  )
}
